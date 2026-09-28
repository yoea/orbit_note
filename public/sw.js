// Service Worker：仅缓存「带内容指纹或极少变化」的静态资源，绝不缓存日记密文（日记数据走 IndexedDB）
// v4：导航请求 fetch 加 cache:'reload'（绕过 HTTP 缓存）——WKWebView（iOS PWA）的 HTTP
//     缓存对无新鲜度信息的页面会启发式缓存且杀进程不清除，部署新版后 PWA 一直吐旧页
//     （真实事故：v1.15.11 的 no-cache 头 Safari 生效但 PWA 仍陈旧，因为旧缓存副本里
//     存的还是旧头）。SW 的 fetch 用 cache:'reload' 可强制绕过。
const CACHE = 'qo-static-v4'
const STATIC = ['/', '/manifest.webmanifest', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png']

// 缓存优先的白名单。**不能对所有同源 GET 都缓存优先**：
// App Router 的客户端软导航会请求 '/xxx?_rsc=<hash>'（不是 navigate 模式），
// 若被缓存，部署新版后会命中旧响应，表现为「改了但页面没变、硬刷才好」。
// 这里只放带内容指纹（/_next/static/ 的 chunk 名含 hash，内容变了文件名就变）
// 或极少变化的资源。
const CACHE_FIRST_PREFIX = ['/_next/static/', '/icons/']
const CACHE_FIRST_EXACT = ['/manifest.webmanifest']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting()))
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
  // 失败回退缓存（离线可打开）
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request, { cache: 'reload' }).catch(() => caches.match('/')))
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
