// 极简 Promise 化 IndexedDB 封装（单库单表，key-value）。
//
// 存什么：
//   · 密文——离线条目缓存（`offline:entries`）、密钥 wrapper（离线解锁用）；
//   · 不可逆的派生元数据——统计（字数等）、打开次数（`entry-views`）；
//   · 地名反查缓存（`geo-cache`：模糊到 ≈1km 的坐标 → 区/市名，**明文**）。
// ★ 最后一项是刻意的例外：区/市名不足以定位到具体地址，而缓存它能把向第三方
//   （BigDataCloud）的请求减少约 3/4（实测命中率 74.8%，见 geocode.ts）。
//
// 为什么这些都放 IndexedDB 而不是 localStorage：`idbClearAll()` 是「设置 → 删除所有
// 数据」的清理入口，放在这里的都会被清掉；而 localStorage 的 `qo-*` 键在那个流程与
// 登出时都不会被清。「我去过哪 / 我常看哪几篇」属于行为痕迹，应当能被一次清干净。
const DB_NAME = 'quiet-orbit'
const STORE = 'kv'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function idbDelete(key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function idbClearAll(): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
