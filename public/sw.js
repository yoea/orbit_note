// Service Worker：仅缓存「带内容指纹或极少变化」的静态资源，绝不缓存日记密文（日记数据走 IndexedDB）
// v4：导航请求 fetch 加 cache:'reload'（绕过 HTTP 缓存）——WKWebView（iOS PWA）的 HTTP
//     缓存对无新鲜度信息的页面会启发式缓存且杀进程不清除，部署新版后 PWA 一直吐旧页
//     （真实事故：v1.15.11 的 no-cache 头 Safari 生效但 PWA 仍陈旧，因为旧缓存副本里
//     存的还是旧头）。SW 的 fetch 用 cache:'reload' 可强制绕过。
// v5：修「response served by service worker has redirections」（离线打开 PWA 直接报错）。
//     根因：安装期 addAll('/') 在无会话 cookie 时会拿到 307→/login 的**跟随重定向响应**
//     （redirected 标记为真），WebKit 拒绝把它作为导航响应。改为：
//     ① 安装期只缓存干净 200（res.ok && !res.redirected），逐个缓存、单个失败不拖垮安装；
//     ② 在线导航成功时运行时补缓存外壳页；
//     ③ 离线兜底逐级回退：精确匹配 → '/' 外壳 → '/login' 外壳 → 网络错误。
const CACHE = 'qo-static-v5'
const STATIC = ['/manifest.webmanifest', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png']
// 离线外壳页（document 级 200 响应，可用于离线导航兜底）。
// '/' 在无 cookie 时会被 proxy 307 → /login，所以只能在带有效会话时缓存到干净副本。
const SHELLS = ['/', '/login']

// 缓存优先的白名单。**不能对所有同源 GET 都缓存优先**：
// App Router 的客户端软导航会请求 '/xxx?_rsc=<hash>'（不是 navigate 模式），
// 若被缓存，部署新版后会命中旧响应，表现为「改了但页面没变、硬刷才好」。
// 这里只放带内容指纹（/_next/static/ 的 chunk 名含 hash，内容变了文件名就变）
// 或极少变化的资源。
const CACHE_FIRST_PREFIX = ['/_next/static/', '/icons/']
const CACHE_FIRST_EXACT = ['/manifest.webmanifest']

// 把一个 URL 的响应缓存进 CACHE（只在干净 200 时写入）。
// 键传 URL 字符串（会被规范化为完整 URL）：运行时缓存用 pathname，
// 这样 PWA start_url / 深链带 query 时也能命中同一份外壳。
async function precache(url, res) {
  if (res.ok && !res.redirected) {
    try {
      const c = await caches.open(CACHE)
      await c.put(url, res)
    } catch { /* 缓存写入失败不影响主流程 */ }
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    // 逐个请求 + 独立容错：addAll 任一失败会整体 reject，导致整个安装失败
    //（此前 '/' 307 时 addAll 虽能跟随重定向存入，但那正是 v5 要修的毒缓存）。
    for (const u of [...STATIC, ...SHELLS]) {
      try {
        const res = await fetch(u, { cache: 'reload' })
        // redirected 响应（307 跟随后的最终响应）绝不入缓存：
        // WebKit 拿它响应导航请求会直接抛「response served by service worker has redirections」
        if (res.ok && !res.redirected) await precache(u, res)
      } catch { /* 安装期网络失败：跳过，运行时导航成功时还会补缓存 */ }
    }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET') return
  if (url.pathname.startsWith('/api/')) return // API 永不缓存
  if (url.origin !== self.location.origin) return
  // 导航请求：网络优先（cache:'reload' 绕过 HTTP 缓存——HTML 体积小且带 ETag 协商，
  // 但 WKWebView 对启发式缓存的旧副本连协商都不发，必须在 SW 层强制走网络），
  // 成功时顺手把外壳页补进缓存；失败（离线）回退缓存（离线可打开）。
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request, { cache: 'reload' })
        // 只缓存外壳页的干净 200：redirected 响应（如会话过期时 '/' → /login）不碰，
        // 防止覆盖已有的好外壳。键用 pathname（剥离 query）。
        if (res.ok && !res.redirected && SHELLS.includes(url.pathname)) {
          void precache(url.pathname, res.clone())
        }
        return res
      } catch {
        // 离线兜底：精确匹配 → '/' 外壳 → '/login' 外壳 → 网络错误。
        // 带 redirected 标记的缓存条目（理论上 v5 起不会产生）一律跳过。
        for (const u of [url.pathname, '/', '/login']) {
          const hit = await caches.match(u)
          if (hit && !hit.redirected) return hit
        }
        return Response.error()
      }
    })())
    return
  }
  // 其余同源 GET（含 RSC 软导航请求）一律不介入，交给浏览器按 HTTP 缓存语义处理
  const cacheFirst = CACHE_FIRST_EXACT.includes(url.pathname)
    || CACHE_FIRST_PREFIX.some((p) => url.pathname.startsWith(p))
  if (!cacheFirst) return
  // 静态资源：缓存优先
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone()
      // 仅缓存成功响应，坏响应（404/500 等）不入缓存
      if (res.ok) {
        caches.open(CACHE).then((c) => c.put(e.request, copy))
      }
      return res
    }))
  )
})
