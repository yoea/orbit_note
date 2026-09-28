// 离线能力核心模块：密文缓存 + 离线写队列。
//
// 设计原则（网络优先、缓存兜底）：
// - 所有缓存在「在线请求成功后」顺手写入；读取只在「请求失败（网络不可达）」时兜底。
//   在线路径的行为与无此模块时逐字节相同，仅多一次 idb 写（异步、不阻塞渲染）。
// - 缓存内容全部是密文（与服务器存的字节相同）——不新增任何明文暴露面，
//   E2EE 不变量（明文只在内存、DEK 不落盘）不被触碰。清缓存 = idbDelete 对应键。
// - 偏好 qo-offline-cache 关闭后：所有写入短路、读取视为无缓存、本地数据可一键清除。
import { idbDelete, idbGet, idbSet } from './idb'
import { isOfflineCacheEnabled } from './prefs'
import type { EncryptedEntry } from './entries'
import type { WrappedKeyRow } from './types'

// 离线创建的日记入队项（POST /api/diary 的 body 子集 + 客户端生成的 UUID）
export interface QueuedEntry {
  id: string
  ciphertext: string
  iv: string
  wordCount: number
  timezone: string | null
  queuedAt: number
}

const WRAPPERS_KEY = 'offline:wrappers'
const ENTRIES_KEY = 'offline:entries'
const STATS_KEY = 'offline:stats'
const OTD_KEY = 'offline:on-this-day'
const QUEUE_KEY = 'offline:queue'
const PROFILE_KEY = 'offline:profile'

// 用户名密文缓存：/api/profile 成功时顺手写入（与服务器存的字节相同——名字本就
// 是 DEK 加密后才上送的）。网络不可达时兜底解密显示，否则设置页离线永远「加载中…」。
export interface CachedProfile {
  nameCiphertext: string
  nameIv: string
  createdAt: string | null
}

export async function cacheProfile(profile: CachedProfile): Promise<void> {
  if (!isOfflineCacheEnabled()) return
  await idbSet(PROFILE_KEY, profile)
}

export async function getCachedProfile(): Promise<CachedProfile | null> {
  return (await idbGet<CachedProfile>(PROFILE_KEY)) ?? null
}

export interface CachedStats {
  count: number
  days: number
  byDay: Record<string, { count: number; words: number }>
}

// ---- 纯函数（可单测）----

// 按 id 合并（后写覆盖同 id）——分页/搜索/详情各路径都可能写缓存，天然去重
export function mergeEntriesById(existing: EncryptedEntry[], incoming: EncryptedEntry[]): EncryptedEntry[] {
  const map = new Map(existing.map((e) => [e.id, e]))
  for (const e of incoming) map.set(e.id, e)
  return [...map.values()]
}

// 队列重传后的保留决策：把「已确认完成」的从队列里剔除。
// 401 特殊——未认证时应整段停止（后面的也会 401），保留剩余全部。
export function remainingAfterFlush(queue: QueuedEntry[], confirmedIds: Set<string>, stopAtIndex: number): QueuedEntry[] {
  if (stopAtIndex >= 0) return queue.slice(stopAtIndex)
  return queue.filter((q) => !confirmedIds.has(q.id))
}

// ---- wrappers（离线解锁用）----

export async function cacheWrappersForOffline(wrappers: WrappedKeyRow[]): Promise<void> {
  if (!isOfflineCacheEnabled() || !wrappers.length) return
  await idbSet(WRAPPERS_KEY, wrappers)
}

export async function getCachedWrappers(): Promise<WrappedKeyRow[] | null> {
  return (await idbGet<WrappedKeyRow[]>(WRAPPERS_KEY)) ?? null
}

// 离线解锁可用性：偏好开启 + 缓存里有 passkey_prf wrapper（登录页/守卫据此决定
// 网络失败时是给出「离线解锁」路径还是直接报连接错误）
export async function isOfflineUnlockAvailable(): Promise<boolean> {
  if (!isOfflineCacheEnabled()) return false
  const wrappers = await getCachedWrappers()
  return Boolean(wrappers?.some((w) => w.wrapperType === 'passkey_prf'))
}

// ---- 日记密文缓存（离线读用）----

export async function cacheEntriesPage(entries: EncryptedEntry[]): Promise<void> {
  if (!isOfflineCacheEnabled() || !entries.length) return
  const existing = (await idbGet<EncryptedEntry[]>(ENTRIES_KEY)) ?? []
  await idbSet(ENTRIES_KEY, mergeEntriesById(existing, entries))
}

// 读取时按 createdAt 倒序（与 GET /api/diary 的排序一致——缓存来自多条路径的合并，顺序不可信）
export async function getCachedEntries(): Promise<EncryptedEntry[]> {
  const cached = (await idbGet<EncryptedEntry[]>(ENTRIES_KEY)) ?? []
  return cached.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export async function getCachedEntryById(id: string): Promise<EncryptedEntry | null> {
  const cached = await getCachedEntries()
  return cached.find((e) => e.id === id) ?? null
}

// ---- 统计 / 去年的今天 ----

export async function cacheStats(stats: CachedStats): Promise<void> {
  if (!isOfflineCacheEnabled()) return
  await idbSet(STATS_KEY, stats)
}

export async function getCachedStats(): Promise<CachedStats | null> {
  return (await idbGet<CachedStats>(STATS_KEY)) ?? null
}

// OTD 缓存带日期：离线只展示「同一天」的回忆（跨天缓存无意义，宁可不出卡片）
export async function cacheOnThisDay(entry: EncryptedEntry): Promise<void> {
  if (!isOfflineCacheEnabled()) return
  const today = new Date().toISOString().slice(0, 10)
  await idbSet(OTD_KEY, { date: today, entry })
}

export async function getCachedOnThisDay(): Promise<EncryptedEntry | null> {
  const cached = await idbGet<{ date: string; entry: EncryptedEntry }>(OTD_KEY)
  if (!cached) return null
  const today = new Date().toISOString().slice(0, 10)
  return cached.date === today ? cached.entry : null
}

// ---- 离线写队列 ----

export async function enqueueOfflineEntry(item: QueuedEntry): Promise<void> {
  const queue = (await idbGet<QueuedEntry[]>(QUEUE_KEY)) ?? []
  queue.push(item)
  await idbSet(QUEUE_KEY, queue)
}

export async function getQueuedCount(): Promise<number> {
  return ((await idbGet<QueuedEntry[]>(QUEUE_KEY)) ?? []).length
}

// 队列项 → 列表/详情可直接消费的条目形态（与 EncryptedEntry 同构）。
// createdAt/updatedAt 都取 queuedAt（创建时刻）；timezone 之外的定位/天气字段离线拿不到，
// 置 null（这些字段的补写本来就是保存成功后的服务端异步操作）。
export function queuedToEntry(item: QueuedEntry): import('./entries').EncryptedEntry {
  const iso = new Date(item.queuedAt).toISOString()
  return {
    id: item.id,
    ciphertext: item.ciphertext,
    iv: item.iv,
    createdAt: iso,
    updatedAt: iso,
    wordCount: item.wordCount,
    latitude: null,
    longitude: null,
    locationAccuracy: null,
    locationName: null,
    weather: null,
    timezone: item.timezone,
  }
}

// 队列里的全部条目（离线列表合并用；按 queuedAt 新→旧）。
// 在线时队列通常为空（解锁即冲刷），离线时是「新增且未同步」的那批。
export async function getQueuedEntries(): Promise<import('./entries').EncryptedEntry[]> {
  const queue = (await idbGet<QueuedEntry[]>(QUEUE_KEY)) ?? []
  return queue
    .slice()
    .sort((a, b) => b.queuedAt - a.queuedAt)
    .map(queuedToEntry)
}

export async function getQueuedEntryById(id: string): Promise<import('./entries').EncryptedEntry | null> {
  const queue = (await idbGet<QueuedEntry[]>(QUEUE_KEY)) ?? []
  const item = queue.find((q) => q.id === id)
  return item ? queuedToEntry(item) : null
}

// 离线编辑「未同步笔记」：更新队列项的密文/字数（id/queuedAt 不变——创建时刻稳定，
// 编辑时刻由调用方在 UI 层表达为 updatedAt）。条目不在队列中时静默忽略（返回 false）。
export async function updateQueuedEntry(id: string, patch: { ciphertext: string; iv: string; wordCount: number }): Promise<boolean> {
  const queue = (await idbGet<QueuedEntry[]>(QUEUE_KEY)) ?? []
  const idx = queue.findIndex((q) => q.id === id)
  if (idx < 0) return false
  queue[idx] = { ...queue[idx], ...patch }
  await idbSet(QUEUE_KEY, queue)
  return true
}

// 离线删除「未同步笔记」：直接移出队列（还没上过服务器，无需服务端删除）。
export async function removeQueuedEntry(id: string): Promise<boolean> {
  const queue = (await idbGet<QueuedEntry[]>(QUEUE_KEY)) ?? []
  const next = queue.filter((q) => q.id !== id)
  if (next.length === queue.length) return false
  await idbSet(QUEUE_KEY, next)
  return true
}

// 冲刷离线写队列：逐条 POST（客户端 UUID 幂等——重复重传命中已有 id 时服务器返回 200 原条目）。
// 返回本次成功同步的条数。遇网络错误 / 401 即停止（后续大概率同样失败），保留剩余队列。
export async function flushOfflineQueue(): Promise<number> {
  const queue = (await idbGet<QueuedEntry[]>(QUEUE_KEY)) ?? []
  if (!queue.length) return 0
  const confirmed = new Set<string>()
  let stopAtIndex = -1
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]
    try {
      const res = await fetch('/api/diary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          ciphertext: item.ciphertext,
          iv: item.iv,
          encryptionVersion: 1,
          wordCount: item.wordCount,
          latitude: null,
          longitude: null,
          locationAccuracy: null,
          timezone: item.timezone,
        }),
      })
      if (res.ok) { confirmed.add(item.id); continue }
      if (res.status === 401 || res.status === 403) { stopAtIndex = i; break }
      // 400（数据校验失败，重传也不会好）/ 429（稍后再试）都不算完成，但可继续尝试后续条目
      if (res.status === 429 || res.status >= 500) { stopAtIndex = i; break }
      // 其它 4xx：视为该条永久失败？——保守起见保留在队列里（用户可见「待同步 N 条」）
    } catch {
      stopAtIndex = i
      break
    }
  }
  if (confirmed.size === 0 && stopAtIndex === -1) return 0
  const remaining = remainingAfterFlush(queue, confirmed, stopAtIndex)
  await idbSet(QUEUE_KEY, remaining)
  return confirmed.size
}

// ---- 清除 / 初始化 ----

// 清除全部离线数据（偏好关闭 / 用户手动清除时调用）。不含草稿——草稿是独立的
// 「本地优先」功能（draft-sync），一直有意保留。
export async function clearOfflineData(): Promise<void> {
  await Promise.all([
    idbDelete(WRAPPERS_KEY),
    idbDelete(ENTRIES_KEY),
    idbDelete(STATS_KEY),
    idbDelete(OTD_KEY),
    idbDelete(QUEUE_KEY),
    idbDelete(PROFILE_KEY),
  ])
}

// ---- 离线导航预热 ----

// Tab 目的地页面（'/' 不需要——冷启动本身就是对它的硬导航）。
// /entry/[id] 是动态路径、数量不可枚举，但详情页是纯客户端组件（id 取自 URL）——
// 预热一个「占位 id」的外壳，离线时 SW 把占位 id 替换成真实 id 后即可服务任意
// /entry/* 导航（见 sw.js navigate 兜底的 ENTRY_FALLBACK 说明）。
// 占位 UUID 必须与 public/sw.js 的 ENTRY_PLACEHOLDER 保持一致（合法 UUID 才不会被
// 任何校验层拦下；全零格式肉眼可辨，绝不与真实条目冲突）。
const ENTRY_PLACEHOLDER = '00000000-0000-0000-0000-000000000000'
const PREWARM_PATHS = ['/diary', '/settings', `/entry/${ENTRY_PLACEHOLDER}`]
// 与 public/sw.js 的预热分支约定同一请求头（普通 GET + 此头 ⇒ SW 网络优先并缓存 HTML 外壳）
const PREWARM_HEADER = { 'x-qo-prewarm': '1' }

// 预热离线导航外壳：对 tab 目的地页面发普通 GET（带会话 cookie），SW 拦截后把干净
// 200 的 HTML 写进 CacheStorage（与离线硬导航兜底同一键空间）。
// 为什么必须预热：tab 页在线时只被**软导航**访问（RSC fetch，不产生 HTML 外壳缓存）；
// 离线点 tab 时 RSC 失败 → Next 自动 fallback 到浏览器硬导航 → 没有外壳就只能逐级
// 回退到 '/' 外壳（表现为「图标高亮但显示主页」，v1.16.0-rc3 真机事故）。
// 幂等（在线时每次调用都拿最新页覆盖旧外壳，顺带解决部署后外壳陈旧问题）；
// 离线/失败静默——下次 online 事件由 initOfflineSync 重试。
export async function prewarmOfflineShells(): Promise<void> {
  if (!isOfflineCacheEnabled()) return
  for (const p of PREWARM_PATHS) {
    try {
      await fetch(p, { headers: PREWARM_HEADER })
    } catch { /* 离线/网络失败：跳过，下次 online 再试 */ }
  }
}

// 申请持久化存储：iOS WKWebView 在存储压力下可能回收 IndexedDB，缓存会悄悄消失。
// 申请成功后系统不再自动清除（配额仍有限但优先保住）。失败静默——最坏情况等于没有缓存。
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist()
  } catch { /* 不支持则忽略 */ }
}

// 模块级单例：注册 online 监听 + 启动时冲刷一次队列。在 (app) layout 解锁完成后调用。
// online 时除冲刷队列外还重跑导航外壳预热：网络恢复的瞬间正是补种缓存的机会
// （上次启动若离线，预热是失败的）。
let syncInited = false
export function initOfflineSync(): void {
  if (syncInited || typeof window === 'undefined') return
  syncInited = true
  window.addEventListener('online', () => {
    void flushOfflineQueue()
    void prewarmOfflineShells()
  })
  void flushOfflineQueue()
  void prewarmOfflineShells()
}
