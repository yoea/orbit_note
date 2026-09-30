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

// ---- 列表数据源一致性（在线列表与离线列表必须给出同一批笔记）----
//
// 这两份副本的语义此前是不对称的：在线列表 = 服务器真值，离线列表 = 本地缓存 ∪ 队列。
// 而本地缓存**只增不减**（此前没有任何代码从 offline:entries 里移除条目），于是
// 「服务器上已删除的条目」会永远留在本地 —— 表现为「离线模式能看到的笔记，在线模式看不到」。
// 下面这组函数让本地缓存重新成为服务器的镜像：服务器的每页返回都是删除的证据，
// 用它把已删条目从缓存里剔除。

// 服务器某页（按 createdAt 倒序的一段连续窗口）能证明「已删除」的缓存 id：
// - 落在本页窗口内（含边界）却不在本页 ⇒ 服务器已经没有这条
// - 首页（offset 0，服务器最新的一条就在本页）⇒ 比本页最新的还新的，服务器没有
//   （最常见的场景：刚在手机上删掉了最新那条，服务器最新时间随之退回，缓存里那条反而「比最新还新」）
// - 末页（返回不足一页 ⇒ 服务器没有更旧的条目）⇒ 比本页最旧的还旧的也算已删除
// 页为空时不做任何判断（避免一次异常的空响应就把缓存清空）。
export function staleCachedIds(
  cached: EncryptedEntry[],
  page: EncryptedEntry[],
  opts: { isFirstPage: boolean; isLastPage: boolean },
): string[] {
  if (!page.length) return []
  const ids = new Set(page.map((e) => e.id))
  const times = page.map((e) => e.createdAt).sort()
  const oldest = times[0]
  const newest = times[times.length - 1]
  return cached
    .filter((e) => {
      if (ids.has(e.id)) return false // 服务器还有这条
      if (e.createdAt >= oldest && e.createdAt <= newest) return true // 窗口内却不在本页 ⇒ 已删
      if (opts.isFirstPage && e.createdAt > newest) return true // 比服务器最新还新 ⇒ 已删
      return opts.isLastPage && e.createdAt < oldest // 末页之外 ⇒ 服务器更旧的都没有了
    })
    .map((e) => e.id)
}

// 按服务器真值清理缓存（列表页每页、全量拉取后都可调用）。
// 队列里的条目不受影响（它们是「还没上服务器」，不是「已删除」）。
export async function pruneCachedEntries(
  page: EncryptedEntry[],
  opts: { isFirstPage: boolean; isLastPage: boolean },
): Promise<void> {
  if (!isOfflineCacheEnabled() || !page.length) return
  // 读-改-写整段进锁：否则会和并发的 cacheEntriesPage 互相覆盖（见 withEntriesLock 注释）
  return withEntriesLock(async () => {
    const cached = (await idbGet<EncryptedEntry[]>(ENTRIES_KEY)) ?? []
    if (!cached.length) return
    const stale = new Set(staleCachedIds(cached, page, opts))
    if (!stale.size) return
    const queueIds = new Set(((await idbGet<QueuedEntry[]>(QUEUE_KEY)) ?? []).map((q) => q.id))
    const next = cached.filter((e) => !stale.has(e.id) || queueIds.has(e.id))
    if (next.length !== cached.length) await idbSet(ENTRIES_KEY, next)
  })
}

// 单条从缓存里剔除（在线删除成功后调用）——否则这条会在离线模式里「复活」。
export async function removeCachedEntry(id: string): Promise<void> {
  return withEntriesLock(async () => {
    const cached = (await idbGet<EncryptedEntry[]>(ENTRIES_KEY)) ?? []
    const next = cached.filter((e) => e.id !== id)
    if (next.length !== cached.length) await idbSet(ENTRIES_KEY, next)
  })
}

// 列表数据源 = 服务器真值 ∪ 未同步队列（两端一致：离线刚写的笔记在在线列表也可见，
// 带「未同步」徽标）。同 id 以服务器行为准——冲刷已成功、队列尚未清空的竞态下，
// 服务器那份才是权威内容。返回按 createdAt 倒序（与 GET /api/diary 排序一致）。
export function unionWithPending(server: EncryptedEntry[], queued: EncryptedEntry[]): EncryptedEntry[] {
  const ids = new Set(server.map((e) => e.id))
  return [...queued.filter((q) => !ids.has(q.id)), ...server].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

// ---- 详情页数据来源判定（纯函数，可单测）----
//
// ★ 为什么值得单独抽出来（2026-09-30「离线点开部分笔记无反应」的定位结果）：
// 这个判定决定「点开一篇笔记会发生什么」，而它原来的失败模式是**完全静默的**——
// 网络不可达且本地没有副本时直接 `router.replace('/diary')`，用户看到的就是
// 「点了没反应、打不开」，既没有报错也没有诊断信息，线上无法归因。
// 抽成纯函数后五种情形各有名字，组件只负责按名字渲染，测试能逐一钉住真值表
// （tests/entry-load.test.ts），以后不再出现「某种组合没人处理」。
//
// 与正文格式**无关**：本地缓存里存的是密文，解密与渲染全在客户端完成，
// 不依赖网络、不依赖 Markdown 解析结果——所以「在线写的 markdown 笔记离线打不开」
// 这个猜想在数据链路上不成立（详见 tests/entry-load.test.ts 的不变量断言）。
export type EntryLoadPlan =
  /** 服务器 200：以服务器为准（顺手写回本地缓存） */
  | { kind: 'server' }
  /** 服务器没有这条 / 网络不可达，但本地写队列里有（离线新增、尚未同步） */
  | { kind: 'local-queue' }
  /** 网络不可达，用本地密文缓存兜底（离线只读：PATCH/DELETE 发不出去） */
  | { kind: 'local-cache' }
  /** 服务器明确 404 且本地也没有：这篇已经不在了（别处删过） */
  | { kind: 'deleted' }
  /** 网络不可达且本地没有缓存：这篇还没缓存到本机 */
  | { kind: 'offline-missing' }
  /** 其它服务器错误（401/5xx…）：按加载失败处理 */
  | { kind: 'error' }

export function resolveEntryLoad(input: {
  /** 服务器响应状态码；网络不可达时为 null */
  serverStatus: number | null
  hasQueued: boolean
  hasCached: boolean
}): EntryLoadPlan {
  const { serverStatus, hasQueued, hasCached } = input
  if (serverStatus === 200) return { kind: 'server' }
  // 404 优先信队列（服务器没这条 ⇒ 它就是「未同步」那批），再退缓存
  if (serverStatus === 404) {
    if (hasQueued) return { kind: 'local-queue' }
    return hasCached ? { kind: 'local-cache' } : { kind: 'deleted' }
  }
  // 网络不可达：优先信缓存（服务器那份可能就是拿不到），再退队列
  if (serverStatus === null) {
    if (hasCached) return { kind: 'local-cache' }
    return hasQueued ? { kind: 'local-queue' } : { kind: 'offline-missing' }
  }
  return { kind: 'error' }
}

// 队列内容变化（冲刷成功、离线删除未同步笔记等）→ 通知界面刷新「未同步」标记，
// 不必整表重取（列表保持滚动位置，只更新徽标）。
export const QUEUE_EVENT = 'qo-offline-queue'

function notifyQueueChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEUE_EVENT))
}

// ---- 离线缓存写入的串行化（ENTRIES_KEY 的写锁）----
//
// ★ 为什么必须串行（2026-09-30 定位到的真缺陷）：
// 本模块对 `offline:entries` 的操作**全是「读-改-写」**——cacheEntriesPage 合并、
// pruneCachedEntries 过滤、removeCachedEntry 删除——而调用方清一色是
// `void cacheEntriesPage(...)` / `void pruneCachedEntries(...)` 这种**不等待的并发调用**
// （DiaryListView.fetchPage 每次分页都同时发这两个）。
//
// 两个 RMW 交叠的后果是**丢失更新**：后提交的那次拿的是自己读到的旧快照，
// 整表覆盖时会抹掉另一次刚写进去的条目。fetchPage 的现场尤其典型——
// pruneCachedEntries 读到的 cached 里没有本页新条目，它一旦真的判定出 stale
// （stale.size > 0 才写），写回的就是「本页之前」的整张表。
//
// 为什么这条不能只当成「少缓存了一条」：**列表是能看见这些条目的**（条目来自组件内存里的
// items），而离线点开一篇笔记要在本地缓存里按 id 取密文（EntryView 的 getCachedEntryById）。
// 缓存里没有 ⇒ 详情页拿不到数据 ⇒ 用户看到的是「点了没反应、打不开」。
// 也就是说：缓存的完整性 = 离线可读性，必须当成不变量来守。
//
// 实现：模块级 promise 链，把每次读-改-写排成串行。失败不阻塞后续（链上吞掉异常）。
let entriesLock: Promise<unknown> = Promise.resolve()

/** 把一次对 ENTRIES_KEY 的读-改-写排进串行队列（内部用；测试里通过公开函数间接验证） */
export function withEntriesLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = entriesLock.then(fn, fn)
  entriesLock = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

// ---- 日记密文缓存（离线读用）----

export async function cacheEntriesPage(entries: EncryptedEntry[]): Promise<void> {
  if (!isOfflineCacheEnabled() || !entries.length) return
  return withEntriesLock(async () => {
    const existing = (await idbGet<EncryptedEntry[]>(ENTRIES_KEY)) ?? []
    await idbSet(ENTRIES_KEY, mergeEntriesById(existing, entries))
  })
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
  notifyQueueChanged()
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
      if (res.ok) {
        // 服务器已接收：把它返回的整行写进缓存。两个作用——
        // ① 本地副本带上服务器认定的 createdAt（队列里只有 queuedAt 估算值）；
        // ② 冲刷后立刻断网也不会「两边都看不到」（队列已清空，缓存里还没有）。
        const data = await res.json().catch(() => null) as { entry?: EncryptedEntry } | null
        if (data?.entry) void cacheEntriesPage([data.entry])
        confirmed.add(item.id)
        continue
      }
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
  if (confirmed.size > 0) notifyQueueChanged()
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
