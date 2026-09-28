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
// v6：修「离线时底部 TabBar 点了高亮但页面不切」。根因：App Router 客户端软导航是
//     RSC:1 请求头的 fetch（非 navigate 模式），此前一律不介入 ⇒ 离线直接失败。
//     改为对 RSC 导航请求同样「网络优先、缓存兜底」：在线成功时把载荷缓存进独立的
//     RSC_CACHE（键 = pathname；HTML 外壳与 RSC 载荷同键会互相污染，必须分库），
//     离线时回退缓存载荷 ⇒ 软导航照常工作。同时 HTML 外壳改为运行时缓存**所有**
//     干净 200 导航响应（不止固定清单），离线硬导航/冷启动可精确命中任意在线访问过的页面。
//     预取请求（next-router-prefetch / next-router-segment-prefetch 头）不介入：
//     其载荷是部分内容，缓存了会污染完整导航载荷。
const CACHE = 'qo-static-v6'
const RSC_CACHE = 'qo-rsc-v6'
const KEEP_CACHES = [CACHE, RSC_CACHE]
const STATIC = ['/manifest.webmanifest', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png']
// 离线兜底外壳（冷启动离线时至少能给出应用壳）。
// '/'、'/diary'、'/settings' 在无 cookie 时会被 proxy 307 → /login，安装期拿不到干净副本，
// 靠运行时（带 cookie 的在线导航）补缓存。
const SHELLS = ['/', '/login']

// 缓存优先的白名单。**不能对所有同源 GET 都缓存优先**：
// 只放带内容指纹（/_next/static/ 的 chunk 名含 hash，内容变了文件名就变）或极少变化的资源。
const CACHE_FIRST_PREFIX = ['/_next/static/', '/icons/']
const CACHE_FIRST_EXACT = ['/manifest.webmanifest']

// 把响应缓存进指定 Cache（只在干净 200 时写入）。
// 键传 pathname 字符串：运行时缓存用 pathname（剥 query），
// 这样 PWA start_url / 深链带 query 时也能命中同一份外壳/载荷。
async function cachePut(cacheName, pathname, res) {
  if (res.ok && !res.redirected) {
    try {
      const c = await caches.open(cacheName)
      await c.put(pathname, res)
    } catch { /* 缓存写入失败不影响主流程 */ }
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    // 逐个请求 + 独立容错：addAll 任一失败会整体 reject，且重定向响应会入缓存（v5 修的毒缓存）。
    for (const u of [...STATIC, ...SHELLS]) {
      try {
        const res = await fetch(u, { cache: 'reload' })
        // redirected 响应（307 跟随后的最终响应）绝不入缓存：
        // WebKit 拿它响应导航请求会直接抛「response served by service worker has redirections」
        await cachePut(CACHE, u, res)
      } catch { /* 安装期网络失败：跳过，运行时导航成功时还会补缓存 */ }
    }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP_CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET') return
  if (url.pathname.startsWith('/api/')) return // API 永不缓存
  if (url.origin !== self.location.origin) return
  const headers = e.request.headers

  // 导航请求（HTML 文档）：网络优先（cache:'reload' 绕过 HTTP 缓存——WKWebView 对启发式
  // 缓存的旧副本连协商都不发），成功时顺手把页面外壳补进缓存（任意路径，不限 SHELLS）；
  // 失败（离线）回退缓存：精确匹配 → '/' 外壳 → '/login' 外壳。
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request, { cache: 'reload' })
        // redirected 响应（如会话过期时 '/' → /login）不碰，防止覆盖已有的好外壳
        void cachePut(CACHE, url.pathname, res.clone())
        return res
      } catch {
        // 带 redirected 标记的缓存条目（理论上不会产生）一律跳过
        for (const u of [url.pathname, '/', '/login']) {
          const hit = await caches.match(u)
          if (hit && !hit.redirected) return hit
        }
        return Response.error()
      }
    })())
    return
  }

  // RSC 软导航请求（客户端路由 fetch，带 RSC:1 头）：同样网络优先、缓存兜底。
  // 预取请求（部分载荷）不介入，避免污染完整导航载荷缓存。
  if (headers.get('rsc') === '1' && !headers.has('next-router-prefetch') && !headers.has('next-router-segment-prefetch')) {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request, { cache: 'reload' })
        void cachePut(RSC_CACHE, url.pathname, res.clone())
        return res
      } catch {
        const hit = await caches.open(RSC_CACHE).then((c) => c.match(url.pathname))
        if (hit && !hit.redirected) return hit
        return Response.error()
      }
    })())
    return
  }

  // 其余同源 GET（含 RSC 预取请求）一律不介入，交给浏览器按 HTTP 缓存语义处理
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
