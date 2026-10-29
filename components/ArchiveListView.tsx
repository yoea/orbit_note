'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { getDek } from '@/lib/client/session'
import { decryptText } from '@/lib/client/crypto/encryption'
import { cacheEntriesPage, getCachedEntries, getQueuedEntries, patchCachedEntries, removeCachedEntries, removeQueuedEntry, unionWithPending, updateQueuedEntry } from '@/lib/client/offline'
import { bulkErrorText, postArchiveAll, postBulkArchive, postBulkDelete } from '@/lib/client/bulk-ops'
import { displayLocationName } from '@/lib/client/location'
import { deriveTitlePreview, toPlainText } from '@/lib/client/markdown'
import { daysAgoLabel } from '@/lib/client/archive'
import { useOffline } from '@/lib/client/use-offline'
import Toast from './Toast'
import ConfirmDialog from './ConfirmDialog'
import BulkActionBar from './BulkActionBar'
import SelectDot from './SelectDot'

// 归档列表（/settings/archive）。
//
// 为什么是独立页而不是列表页的第二种视图模式（方案阶段 2 的定稿）：
// 列表页背着一整套「固定区（标题栏+统计+热力图）+ 内部滚动 + 滚动位置恢复 + 会话快照」，
// 再塞一个视图模式进去，每个都要变成两份分支。归档页是需要时才进的子页面，
// 组件可以彻底重新挂载、从头加载。
//
// ★ 五条与列表页刻意不同的地方，改之前先读：
//   1. **绝不调用 pruneCachedEntries**。prune 的语义是「服务器全量清单里没有的 ⇒ 已删除」，
//      而这里拿到的是**全表的一个子集**（archived=only）。照抄列表页那行会把所有未归档条目
//      当成「已删除」从缓存里清掉 —— 表现为「去了趟归档页，离线列表全空了」，且零报错。
//   2. **不显示字数、改显示「归档于 X 天前」**。字数在阅读场景有用；归档页是回溯场景，
//      「什么时候收进来的」才是要找的信息。
//   3. **不做滚动位置恢复 / 会话快照**。归档条目预期是「几十条」量级，
//      真到成百上千再补，那时与列表页同一套（`qo-diary-scroll` + 深度重取）。
//   4. **不显示收藏星标**。`tests/entry-star.test.ts` 的 S1 把星图标限定在
//      「列表页 / 详情页」两处（收藏是「这一篇的状态」，处处都画会让人以为它们各自独立）。
//      归档页是回溯场景，星标帮不上忙 —— 与其放宽那条守卫，不如这里不画。
//   5. **行不打开日记**（2026-10-29 用户要求）：这里是"回收站"，只能「取消归档 / 彻底删除」。
//      点一下 = 进选择态并选中（等同 iOS 相册），因此也不需要长按那套绕路机制。
//      副作用（正是要的）：在归档页删一篇不会再走详情页那条流程
//      —— 那条流程删完没有提示、还会跳到"全部日记"（详情页只知道回列表）。

const PAGE_SIZE = 20

// 与 API 返回同构的整行（离线缓存按整行存取，字段少一个就会在写缓存时丢值）
interface Entry {
  id: string
  ciphertext: string
  iv: string
  createdAt: string
  updatedAt: string
  wordCount: number
  latitude: number | null
  longitude: number | null
  locationAccuracy: number | null
  locationProvince: string | null
  locationCity: string | null
  locationDistrict: string | null
  locationName: string | null
  weather: string | null
  timezone: string | null
  starred: boolean
  archivedAt: string | null
  viewCount: number
}

interface DecryptedItem {
  id: string
  createdAt: Date
  /** 归档时间（ISO）。本页只会有非空值，但类型保持可空——离线缓存里可能混进脏数据 */
  archivedAt: string | null
  title: string
  preview: string
  locationName: string | null
  pending: boolean
}

/** 游标 = 「已经取过的最旧一条」。与列表页同一套：(createdAt, id) 全序，同秒不会整批跳过 */
interface Cursor {
  at: string
  id: string
}


// 行内的「创建日期 + 时刻」：`2026年10月12日 17:26`。
// 只用 toLocaleDateString 会丢掉时刻，而归档列表里同一天可能有好几篇。
function fmtDateTime(d: Date): string {
  const day = d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${day} ${time}`
}

export default function ArchiveListView() {
  const [items, setItems] = useState<DecryptedItem[]>([])
  // 这一档的总篇数（服务端 `total`，与游标/offset 无关）。
  // null = 还不知道（离线 / 首帧未到）——此时候口只显示「已加载 N 篇」，不编一个总数。
  const [total, setTotal] = useState<number | null>(null)
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const offline = useOffline()

  // —— 批量取消归档（2026-10-29，阶段 4）——
  // 与列表页的批量归档对称：那边收进去，这边放出来。
  // 没有它的话，用户要把几十篇从归档里放回日常，只能一篇篇点进去再点取消。
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [confirmBulk, setConfirmBulk] = useState(false)
  // 彻底删除走**两段**确认（2026-10-29 用户要求「多次确认」）：0=没弹 / 1=第一问 / 2=最后一问。
  // 归档页是「回收站」语义，在这里删 = 彻底清掉，所以比列表页的删除多一道。
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0)

  // —— 归档所有日记（2026-10-29）——
  // `restCount` = **还没归档**的篇数（服务端 total，limit=1 顺手带回来，不拉正文）。
  //   · 它决定那一行**存不存在**：没有可归档的日记时整个入口消失（既不误导，也不占地方）；
  //   · 它决定确认框里能不能说出篇数 —— 一次清空日常列表的操作，不说清影响多少篇不能让人点。
  //   · null = 不知道（离线 / 请求失败），此时候口不出现。
  const [restCount, setRestCount] = useState<number | null>(null)
  const [archiveAllOpen, setArchiveAllOpen] = useState(false)
  const [archiveAllBusy, setArchiveAllBusy] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null)
  const cursorRef = useRef<Cursor | null>(null)
  const hasMoreRef = useRef(true)
  const fetchingRef = useRef(false)
  // ★ 这里**没有长按机制**，也不需要（2026-10-29）：整行本来就是按钮，点一下就进选择态。
  //   长按是"整行是链接、但想长按选它"的绕路方案 —— 行不再是链接，绕路自然消失。
  //   `-webkit-touch-callout` / suppressNavRef 那一套只留给列表页（那里行仍是 Link）。

  useEffect(() => { cursorRef.current = cursor }, [cursor])
  useEffect(() => { hasMoreRef.current = hasMore }, [hasMore])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  function exitSelect() {
    setSelectMode(false)
    setSelected(new Set())
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))))
  }

  // 点行 = 选它（2026-10-29）：没在选择态就顺带进去，已在选择态就切换。
  // ★ 这是进入选择态的**唯一**入口（2026-10-29：页头那个「选择」按钮已删）——
  //   行本身就是按钮，点一下同时完成"进选择态"和"选中它"，读屏也能到（`aria-pressed`）。
  //   想"先全选"的人进选择态后走底部工具栏的「全选」。
  function toggleFromRow(id: string) {
    if (!selectMode) {
      setSelectMode(true)
      setSelected(new Set([id]))
      return
    }
    toggleItem(id)
  }

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 批量取消归档：当前视图是「已归档」⇒ 成功的要从本页移除，
  // 同时把本地缓存里的 archivedAt 改回 null（否则离线进归档页它们还在）。
  async function submitBulkUnarchive() {
    if (bulkBusy || selected.size === 0) return
    setBulkBusy(true)
    const ids = [...selected]
    try {
      const res = await postBulkArchive(ids, false)
      const gone = new Set(ids)
      setItems((prev) => prev.filter((i) => !gone.has(i.id)))
      const stillThere = ids.filter((id) => !res.missing.includes(id))
      await patchCachedEntries(stillThere, { archivedAt: null })
      // 「未归档篇数」要跟着加：顶部那行的「归档其余 N 篇」用的就是它，
      // 不更新的话取消归档之后数字还停在旧值（乃至停在 0，整个入口凭空消失）
      setRestCount((prev) => (prev === null ? null : prev + res.updated))
      if (res.missing.length) setToast(`已取消归档 ${res.updated} 篇，另有 ${res.missing.length} 篇已不存在`)
      else if (res.updated === 0) setToast('选中的日记没有归档状态')
      else setToast(`已取消归档 ${res.updated} 篇`)
      setConfirmBulk(false)
      exitSelect()
    } catch (e) {
      setToast(bulkErrorText(e, '取消归档'))
    } finally {
      setBulkBusy(false)
    }
  }

  // 彻底删除。删除后这一屏与本地缓存、离线队列都要清 —— 少清任何一处，
  // 断网再进来它们都还在（列表读缓存、徽标读队列）。
  async function submitBulkDelete() {
    if (bulkBusy || selected.size === 0) return
    setBulkBusy(true)
    const ids = [...selected]
    try {
      const res = await postBulkDelete(ids)
      const gone = new Set(ids)
      setItems((prev) => prev.filter((i) => !gone.has(i.id)))
      await removeCachedEntries(ids)
      await Promise.all(ids.map((id) => removeQueuedEntry(id))).catch(() => {})
      if (res.missing.length) setToast(`已删除 ${res.deleted} 篇，另有 ${res.missing.length} 篇本就不存在`)
      else setToast(`已彻底删除 ${res.deleted} 篇`)
      setDeleteStep(0)
      exitSelect()
    } catch (e) {
      setToast(bulkErrorText(e, '删除'))
    } finally {
      setBulkBusy(false)
    }
  }

  // 归档所有日记（2026-10-29）。三件事必须一起做完，少一件都会留下"假象"：
  //   ① 服务器：一句 UPDATE 收掉所有未归档的（见 /api/diary/archive/all）；
  //   ② 本地密文缓存：不改的话，断网后列表页读缓存 ⇒ 那些日记在"全部日记"里**复活**；
  //   ③ 离线写队列：还没上服务器的笔记，服务端那句 UPDATE 根本碰不到它们 ——
  //      不一起改，同步上去之后它们仍站在日常列表里，等于"所有"里漏了几篇。
  // ④ 最后整页重取：这一页的条目从 12 篇变成几十篇，游标/总数/hasMore 全部作废。
  async function submitArchiveAll() {
    if (archiveAllBusy) return
    setArchiveAllBusy(true)
    try {
      const res = await postArchiveAll()
      await patchCachedEntries(res.ids, { archivedAt: res.archivedAt })
      const queued = await getQueuedEntries()
      await Promise.all(
        queued.filter((q) => q.archivedAt == null).map((q) => updateQueuedEntry(q.id, { archivedAt: res.archivedAt })),
      ).catch(() => { /* 队列写失败不回滚：服务器已经改了，回滚只会更不一致 */ })
      setArchiveAllOpen(false)
      setRestCount(0)
      await loadFirst()
      scrollRef.current?.scrollTo({ top: 0 })
      setToast(res.updated === 0 ? '没有需要归档的日记' : `已归档 ${res.updated} 篇`)
    } catch (e) {
      setToast(bulkErrorText(e, '归档'))
    } finally {
      setArchiveAllBusy(false)
    }
  }

  // 取一页并解密。数据源：在线 = 服务器(archived=only) ∪ 队列里已归档的未同步笔记；
  // 离线 = 本地缓存里 archivedAt 非空的 ∪ 队列里已归档的。
  const fetchPage = useCallback(async (from: Cursor | null): Promise<{ items: DecryptedItem[]; serverCount: number; total: number | null; cursor: Cursor | null }> => {
    const dek = getDek()
    if (!dek) return { items: [], serverCount: 0, total: null, cursor: null }
    let entries: Entry[]
    let serverCount: number
    // 服务端给的这一档总数；离线时保持 null（详见 total state 的注释）
    let total: number | null = null
    let nextCursor: Cursor | null = null
    const queued = await getQueuedEntries()
    // 离线归档过的笔记（队列里带 archivedAt）也属于「已归档」——不并进来，
    // 用户会以为「刚归档的那篇不见了」。
    const queuedArchived = queued.filter((q) => q.archivedAt != null)
    let pendingIds = new Set<string>()

    const qs = from
      ? `&before=${encodeURIComponent(from.at)}&beforeId=${encodeURIComponent(from.id)}`
      : ''
    const res = await fetch(`/api/diary?archived=only&limit=${PAGE_SIZE}${qs}`).catch(() => null)
    if (res) {
      if (!res.ok) throw new Error('加载失败')
      const payload = (await res.json()) as { entries: Entry[]; total?: number }
      const server = payload.entries
      serverCount = server.length
      total = typeof payload.total === 'number' ? payload.total : null
      // await：与列表页同一条不变量——**列表里出现过的，本地必须已有密文**（离线可读性）
      await cacheEntriesPage(server)
      // ★ 这里**没有** pruneCachedEntries，而且不能加（见文件头第 1 条）
      const serverIds = new Set(server.map((e) => e.id))
      pendingIds = new Set(queuedArchived.filter((q) => !serverIds.has(q.id)).map((q) => q.id))
      // 未同步条目只可能落在第一页（时间戳都是「现在」）
      entries = from === null ? unionWithPending(server, queuedArchived) : server
      const last = server[server.length - 1]
      nextCursor = last ? { at: last.createdAt, id: last.id } : null
    } else {
      // 网络不可达：只有本地缓存能看。**这不是错误状态**——能读到几条就先给几条。
      const cached = (await getCachedEntries()).filter((e) => e.archivedAt != null)
      const union = unionWithPending(cached, queuedArchived)
      let startIdx = 0
      if (from) {
        const byId = union.findIndex((e) => e.id === from.id)
        if (byId >= 0) startIdx = byId + 1
        else {
          const byTime = union.findIndex((e) => e.createdAt < from.at)
          startIdx = byTime >= 0 ? byTime : union.length
        }
      }
      const slice = union.slice(startIdx, startIdx + PAGE_SIZE)
      entries = slice
      serverCount = slice.length
      // 离线：不知道服务器上有多少，别编数字（total 保持 null）
      if (!slice.length && from === null) return { items: [], serverCount: 0, total: null, cursor: null }
      pendingIds = new Set(queuedArchived.map((q) => q.id))
      const last = slice[slice.length - 1]
      nextCursor = slice.length && startIdx + slice.length < union.length
        ? { at: last.createdAt, id: last.id }
        : null
    }

    const decrypted: DecryptedItem[] = []
    for (const e of entries) {
      try {
        const plain = await decryptText(dek, e.ciphertext, e.iv)
        const text = toPlainText(plain)
        const { title, preview } = deriveTitlePreview(text)
        decrypted.push({
          id: e.id,
          createdAt: new Date(e.createdAt),
          archivedAt: e.archivedAt,
          title,
          preview,
          locationName: displayLocationName(e),
          pending: pendingIds.has(e.id),
        })
      } catch {
        // 单条解密失败跳过（数据损坏不阻塞整页）
      }
    }
    return { items: decrypted, serverCount, total, cursor: nextCursor }
  }, [])

  // ★ 抽成函数而不是只写在挂载 effect 里：「归档所有日记」之后要**整页重取**
  //   （这一页的条目从 12 篇变成 46 篇，游标、总数、hasMore 全部作废，只插几条是不对的）。
  //   失败**向上抛**，由调用方决定是整页报错还是静默（重取失败不该弹整页错误）。
  const loadFirst = useCallback(async () => {
    const first = await fetchPage(null)
    setItems(first.items)
    setTotal(first.total)
    setCursor(first.cursor)
    setHasMore(first.serverCount === PAGE_SIZE)
  }, [fetchPage])

  useEffect(() => {
    // ★ boot 必须**定义在 effect 内部**再调用（2026-10-29 实测）：写成外部函数
    //   （哪怕包了 useCallback）会被 react-hooks/set-state-in-effect 判成级联渲染。
    async function boot() {
      try {
        await loadFirst()
      } catch {
        setError('连接失败，请检查网络后重试')
      } finally {
        setLoading(false)
      }
      // 顺带问一次「还有多少篇没归档」（limit=1，只取 total，不拉正文）。
      // ★ 这是**独立的一问**：它失败只影响「归档所有日记」那个入口，
      //   不该把整页打成错误态；取不到就置 null（离线时条数本就只是本机缓存的口径）。
      const res = await fetch('/api/diary?archived=exclude&limit=1').then((r) => (r.ok ? r.json() : null)).catch(() => null)
      const n = (res as { total?: number } | null)?.total
      setRestCount(typeof n === 'number' ? n : null)
    }
    void boot()
  }, [loadFirst])

  const loadOlder = useCallback(async () => {
    if (fetchingRef.current || !hasMoreRef.current) return
    const from = cursorRef.current
    if (!from) return
    fetchingRef.current = true
    setLoadingMore(true)
    try {
      const page = await fetchPage(from)
      setItems((prev) => [...prev, ...page.items])
      setCursor(page.cursor)
      setHasMore(page.serverCount === PAGE_SIZE)
    } catch {
      // 触底失败不整页报错（可能只是网络抖动），给一次性提示
      setToast('离线状态无法继续加载更早的归档日记')
      setHasMore(false)
    } finally {
      fetchingRef.current = false
      setLoadingMore(false)
    }
  }, [fetchPage])

  // 触底自动加载：root 必须是本页的滚动容器（本页不是 window 滚动，用默认 root 永不触发）
  useEffect(() => {
    const root = scrollRef.current
    if (!sentinelEl || !root || !hasMore) return
    const io = new IntersectionObserver((ent) => {
      if (ent.some((e) => e.isIntersecting)) void loadOlder()
    }, { root, rootMargin: '400px 0px' })
    io.observe(sentinelEl)
    return () => io.disconnect()
  }, [sentinelEl, hasMore, loadOlder])

  // 行内容：**标题 + 创建日期 + 归档日期**（2026-10-29 用户要求：不要正文预览）。
  //
  // 去掉预览后一行只有两段信息 —— 列表更短，也更能"数"清归档了多少篇。
  // 按天分组同时取消：既然每行都带完整日期，组头就只是把同一串再写一遍。
  function rowBody(item: DecryptedItem) {
    return (
      <>
        <span className="flex items-baseline gap-2">
          <span className="line-clamp-1 font-medium text-neutral-800 dark:text-neutral-200">
            {item.title || '(无标题)'}
          </span>
          {item.pending && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden>
                <path d="M17.5 19a4.5 4.5 0 1 0 0-9h-1.8A7 7 0 1 0 4 14.7" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
              未同步
            </span>
          )}
        </span>
        <span className="text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400">
          {fmtDateTime(item.createdAt)} · 归档于 {daysAgoLabel(item.archivedAt ?? '') || '已归档'}
        </span>
      </>
    )
  }


  if (error) {
    return (
      <main className="mx-auto flex h-full w-full max-w-md items-center justify-center px-5">
        <div className="text-center">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-3 text-sm font-medium text-white">重试</button>
        </div>
      </main>
    )
  }

  // 未同步的归档条目（离线归档、还没上服务器）：它们不在服务端 total 里，
  // 单独加进「共 N 篇」才对得上眼前看到的行数。
  const pendingCount = items.filter((i) => i.pending).length

  return (
    /* 布局与列表页同构（固定页头 + 总数行 + 内部滚动区），但**没有**热力图：
       归档条目不参与统计（stats 与 on-this-day 默认都已排除），热力图放这里会自相矛盾。 */
    <main className="mx-auto flex h-full w-full max-w-md flex-col">
      <header className="page-header relative flex shrink-0 items-center justify-between px-5 py-3">
        {/* 返回设置页（本页从设置页进）。标题绝对居中、右侧留等宽占位保持行高 */}
        <Link href="/settings" aria-label="返回" scroll={false} className="-ml-1 px-1 text-3xl leading-none text-neutral-500 dark:text-neutral-400">
          ‹
        </Link>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">已归档</h1>
        {selectMode ? (
          <button onClick={exitSelect} className="px-1 text-sm font-medium text-neutral-500 active:opacity-60 dark:text-neutral-400">退出多选</button>
        ) : (
          /* ★ 非选择态这里**只有占位块**（2026-10-29 用户要求：右上角「选择」两个字是多余的）。
             去掉它的理由：点任意一行就会进选择态并选中那一行（与 iOS 相册 / 文件一致），
             「选择」把一件本来就在手势里的事又说了一遍。
             ★ 占位块**不能删**：页头标题是 `absolute` 居中，流内只剩左右两个元素，
               少一个 `justify-between` 就没了对手，返回箭头会被推到中间。 */
          <span className="w-8" aria-hidden />
        )}
      </header>
      {/* 总数行（2026-10-29 用户要求「顶部显示一个共多少篇之类的信息」）：
          本页原先只有页头 + 列表，空得像没加载完。这一行与列表页的统计行同构
          （`shrink-0` 固定、`text-xs tabular-nums`），但**只有篇数**——归档条目不参与
          热力图/连续天数，这里再摆一堆统计会自相矛盾。
          ★ 数字来自服务端 `total`（与游标无关的总量），不是已加载条数；
            离线时 total 为 null，退化成「已加载 N 篇」，不编造总数。

          ★★ 2026-10-29 起这一行**兼作「归档所有日记」的落点**（用户定稿：同一行右对齐）：
            · 为什么在这一行：它是本页唯一的"页级信息区"，在固定区里 —— 列表滚多远都点得到，
              而不像"放在列表底部"那样要滚到几百条的最后；
            · 渲染条件从 `items.length > 0` 放宽成 `items.length > 0 || restCount > 0`：
              归档列表**为空**时（还没有任何归档）恰恰是最可能需要它的时刻，
              若仍挂在"有归档条目才显示"上，那一行会连入口一起消失；
            · 右侧用 violet（与「已归档」那扇门的图标底同色）表示"这里是归档类操作"，
              也让它在一行灰色小字里显得可点。 */}
      {(items.length > 0 || (restCount ?? 0) > 0) && (
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-2">
          <p className="min-w-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
            {items.length > 0 && (total !== null ? `共 ${total + pendingCount} 篇` : `已加载 ${items.length} 篇`)}
            {items.length > 0 && pendingCount > 0 && <span className="opacity-70">（含 {pendingCount} 篇未同步）</span>}
          </p>
          {/* 选择态不给它：那时底部工具栏才是操作区，两个地方同时能"动全部"会让人分不清 */}
          {!selectMode && restCount !== null && restCount > 0 && (
            <button
              onClick={() => setArchiveAllOpen(true)}
              disabled={archiveAllBusy}
              className="shrink-0 text-xs font-medium text-violet-600 active:opacity-60 disabled:opacity-50 dark:text-violet-400"
            >
              {items.length > 0 ? `归档其余 ${restCount} 篇` : `归档全部 ${restCount} 篇`}
            </button>
          )}
        </div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5">
        <div className="flex flex-col gap-6 pb-4">
          <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
            {items.map((item) => (
              <li key={item.id}>
                {/* ★ 归档页的行**不打开日记**（2026-10-29 用户要求：这里只能取消归档 / 彻底删除）。
                    原来整行是 `<Link href="/entry/…?from=archive">`，点一下进详情页，
                    于是"在归档页删掉一篇"会走详情页的删除流程 —— 删完没有 toast、还跳到全部日记
                    （详情页只知道"回列表"）。归档页是"回收站"，进去就只该能挑出来处理。
                    ⇒ 行改成按钮：点一下进入选择态并选中它；已在选择态则切换选中。
                    这与 iOS 相册 / 文件的行为一致，也让「取消归档 / 彻底删除」成为唯一的去向。 */}
                <button
                  onClick={() => toggleFromRow(item.id)}
                  aria-pressed={selected.has(item.id)}
                  className="flex w-full items-start gap-2.5 py-3 text-left active:opacity-60"
                >
                  <SelectDot checked={selected.has(item.id)} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">{rowBody(item)}</span>
                </button>
              </li>
            ))}
          </ul>
          {/* 空态。离线时要说清楚「这只是本机缓存」——否则用户会以为归档的日记丢了 */}
          {!loading && items.length === 0 && (
            <div className="pt-16 text-center">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">还没有归档的日记</p>
              <p className="mt-2 px-6 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                {offline
                  ? '离线模式下只能看到本机已缓存的归档日记，联网后再看看。'
                  : '在日记详情页点底部的归档图标（收纳盒），它就会收进这里。'}
              </p>
            </div>
          )}
          {items.length > 0 && (
            <div className="pt-2">
              {hasMore ? (
                <>
                  <div ref={setSentinelEl} aria-hidden className="h-1" />
                  <p className="py-3 text-center text-xs text-neutral-500 dark:text-neutral-400">
                    {loadingMore ? '加载中…' : ''}
                  </p>
                </>
              ) : (
                <p className="py-3 text-center text-xs text-neutral-500 dark:text-neutral-400">已显示全部</p>
              )}
            </div>
          )}
        </div>
      </div>
      {selectMode && (
        <BulkActionBar
          count={selected.size}
          total={items.length}
          busy={bulkBusy}
          label="取消归档"
          busyLabel="处理中…"
          dangerLabel="彻底删除"
          onToggleAll={toggleSelectAll}
          onAction={() => setConfirmBulk(true)}
          onDanger={() => setDeleteStep(1)}
        />
      )}

      {toast && <Toast message={toast} />}
      {/* 「归档所有日记」只要**一道**确认（2026-10-29 用户定稿）：它可逆 —— 随时能在这页
          取消归档还原 —— 所以不该与「彻底删除」用同一套两段确认（那会分不出轻重）。
          但**篇数必须写进标题**：这是本页影响面最大的操作，不能让人盲点。 */}
      {archiveAllOpen && restCount !== null && restCount > 0 && (
        <ConfirmDialog
          title={items.length > 0 ? `把其余 ${restCount} 篇日记全部归档？` : `把 ${restCount} 篇日记全部归档？`}
          message="它们会从日常列表、搜索和统计里移出，收进「已归档」。随时可以在这里取消归档还原。"
          confirmText="归档"
          cancelText="取消"
          onConfirm={() => void submitArchiveAll()}
          onCancel={() => setArchiveAllOpen(false)}
        />
      )}
      {confirmBulk && (
        <ConfirmDialog
          title={`取消归档这 ${selected.size} 篇日记？`}
          message="它们会回到列表、搜索与统计里。"
          confirmText="取消归档"
          cancelText="取消"
          onConfirm={() => void submitBulkUnarchive()}
          onCancel={() => setConfirmBulk(false)}
        />
      )}
      {/* 第一问：说清"删的是什么、能不能恢复" */}
      {deleteStep === 1 && (
        <ConfirmDialog
          title={`彻底删除这 ${selected.size} 篇日记？`}
          message="删除后无法恢复，也会从「已归档」里消失。"
          confirmText="继续"
          cancelText="取消"
          destructive
          onConfirm={() => setDeleteStep(2)}
          onCancel={() => setDeleteStep(0)}
        />
      )}
      {/* 第二问：把"不可撤销"再说一遍，并给一个不像按钮的拒绝词 */}
      {deleteStep === 2 && (
        <ConfirmDialog
          title="确定吗？这一步不可撤销"
          message={`这 ${selected.size} 篇日记的密文会从服务器上删掉，你自己也恢复不了。`}
          confirmText="永久删除"
          cancelText="我再想想"
          destructive
          onConfirm={() => void submitBulkDelete()}
          onCancel={() => setDeleteStep(0)}
        />
      )}
    </main>
  )
}
