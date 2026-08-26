// Service Worker：仅缓存静态资源，绝不缓存日记密文（日记数据走 IndexedDB）
const CACHE = 'qo-static-v1'
const STATIC = ['/', '/manifest.webmanifest', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png']

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
  // 导航请求：网络优先，失败回退缓存（离线可打开）
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')))
    return
  }
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
