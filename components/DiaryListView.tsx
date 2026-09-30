'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { getDek } from '@/lib/client/session'
import { decryptText } from '@/lib/client/crypto/encryption'
import { useUserName } from '@/lib/client/use-user-name'
import { cacheEntriesPage, cacheStats, getCachedEntries, getCachedStats, getQueuedEntries, pruneCachedEntries, QUEUE_EVENT, unionWithPending } from '@/lib/client/offline'
import SearchDialog from './SearchDialog'
import SearchIcon from './SearchIcon'
import ContributionHeatmap from './ContributionHeatmap'
import { deriveTitlePreview, toPlainText } from '@/lib/client/markdown'

const PAGE_SIZE = 10

// 行结构 = 服务端整行的超集需求（wordCount/updatedAt 等字段列表页不直接用，
// 但离线缓存按整行存取——与 EncryptedEntry 同构）
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
  locationName: string | null
  weather: string | null
  timezone: string | null
}

interface DecryptedItem {
  id: string
  createdAt: Date
  title: string // 首行非空行（加粗标题）
  preview: string // 去除标题行后的剩余正文
  wordCount: number // 解密时计算（trim 后长度，与详情页/编辑器口径一致）
  lat: number | null
  locationName: string | null
  pending: boolean // 离线新增、尚未同步到服务器的笔记（列表显示「未同步」徽标）
}

interface Group {
  key: string // yyyy-mm-dd（本地时区）
  label: string // 今天 / 昨天 / 2026年8月25日 · 星期二
  items: { id: string; time: string; title: string; preview: string; wordCount: number; lat: number | null; locationName: string | null; pending: boolean }[]
  // 组头统计（服务端全量聚合——分页只加载了部分，不能从已加载条目统计）
  statCount: number
  statWords: number
}

interface Stats {
  count: number
  days: number
  byDay: Record<string, { count: number; words: number }>
}

// 会话级内存快照（stale-while-revalidate 里的 "stale" 那一半）。
//
// 为什么需要（2026-09-30 用户反馈「切到列表页白屏闪一下、疑似从服务器全量刷新」）：
// TabBar 的三个目的地是三个独立的 page 组件，切走再切回时本组件会**重新挂载**——
// 没有快照就要重跑一遍「两个请求 + 逐条 AES-GCM 解密」，这段时间页面只有页头，
// 内容稍后才突然出现。有了快照就先渲染上一次的内容（零延迟、无闪动），
// 同时在后台照常重取并整体覆盖——**服务器始终是权威**，快照只影响首帧。
//
// 刻意只放内存（模块级变量，不落 sessionStorage / IndexedDB）：
//   · 刷新与冷启动自然清空，不会留下跨会话的过期数据；列表内容是**解密后的明文**，
//     落盘就违背了本项目的立场；
//   · 也就不需要任何失效逻辑——每次挂载都会重取一遍。
// 唯一的"陈旧窗口"是「刚保存完一篇就切到列表」：新条目要等这次后台重取回来才出现，
// 也就是一个请求往返（此时列表是**有内容的**，不会白屏）；代价远小于每次进来都空一下。
let snapshot: { items: DecryptedItem[]; stats: Stats | null; offset: number; hasMore: boolean } | null = null

// 本地日期 key（分组与"今天/昨天"判断同口径）
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 组头：今天/昨天人性化显示，其余显示 日期 + 星期
function dayLabel(key: string): string {
  const today = dayKey(new Date())
  if (key === today) return '今天'
  const y = new Date()
  y.setDate(y.getDate() - 1)
  if (key === dayKey(y)) return '昨天'
  const d = new Date(`${key}T00:00:00`)
  return `${d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })} · ${d.toLocaleDateString('zh-CN', { weekday: 'long' })}`
}

// 全部日记视图（原生路由页 /diary 渲染；DEK 会话级持久化，导航/重载自动恢复）
export default function DiaryListView() {
  // 首帧直接用会话快照（上一次离开本页时的内容）：切 tab 回来时立刻有内容，
  // 不再经历「空列表 → 数据到齐」那段可感知的空白。随后照常重取覆盖。
  const [items, setItems] = useState<DecryptedItem[]>(() => snapshot?.items ?? [])
  const [stats, setStats] = useState<Stats | null>(() => snapshot?.stats ?? null)
  const [offset, setOffset] = useState(() => snapshot?.offset ?? 0)
  const [hasMore, setHasMore] = useState(() => snapshot?.hasMore ?? true)
  const [loadingMore, setLoadingMore] = useState(false)
  // 首次进入（无快照可渲染）时列表本来就是空的——那不是「没有日记」，是数据还在路上。
  // 原先没有这个标志，于是会先闪一行「还没有日记」再被真实列表顶掉。
  const [loading, setLoading] = useState(() => snapshot == null)
  const [error, setError] = useState<string | null>(null)
  // 挂载时的既有深度：重取时至少要补齐到这里，否则后台刷新一回来列表会「缩水」、
  // 滚动位置跟着跳（快照深度可能大于 sessionStorage 里记的上次浏览深度）。
  const seededDepthRef = useRef(snapshot ? snapshot.items.length : 0)
  const userName = useUserName()
  const [searchOpen, setSearchOpen] = useState(false)
  // 滚动位置保持：sessionStorage 存 { y: 滚动值, count: 已加载条数 }
  // ——返回时先加载到足够深度再恢复滚动（否则内容高度不足被钳制）
  const SCROLL_KEY = 'qo-diary-scroll'
  const restoredScrollRef = useRef(false)
  const itemsRef = useRef<DecryptedItem[]>([])
  // 滚动容器（本页是容器滚动，见下方 main 的注释）
  const scrollRef = useRef<HTMLElement | null>(null)

  // 同步给 ref：itemsRef 只被「滚动保存」回调异步读取，因此在 effect 里赋值。
  // 不要写回渲染期赋值（itemsRef.current = items）——渲染期写 ref 会在并发渲染下读到
  // 尚未提交的值，也是 react-hooks/refs 明确禁止的。
  useEffect(() => { itemsRef.current = items }, [items])

  // 快照回写：状态一变就覆盖（组件随后被卸载也无妨——模块级变量本就该继续持有最后的内容）。
  // 卸载时不需要清理：下一次挂载要的就是这份「上次离开时的样子」。
  useEffect(() => { snapshot = { items, stats, offset, hasMore } }, [items, stats, offset, hasMore])

  // 读取恢复状态：{ y, count } 或 null
  const readScrollState = (): { y: number; count: number } | null => {
    try {
      const raw = sessionStorage.getItem(SCROLL_KEY)
      if (!raw) return null
      const d = JSON.parse(raw) as { y?: unknown; count?: unknown }
      if (typeof d.y === 'number' && Number.isFinite(d.y) && typeof d.count === 'number') return { y: d.y, count: d.count }
    } catch { /* 忽略 */ }
    return null
  }

  // 保存滚动位置：滚动防抖写入 sessionStorage；页面隐藏/卸载时兜底保存
  // （监听对象是容器元素而非 window——本页已改为容器滚动）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let t: ReturnType<typeof setTimeout> | null = null
    const save = () => {
      try {
        sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ y: el.scrollTop, count: itemsRef.current.length }))
      } catch { /* 忽略 */ }
    }
    const onScroll = () => {
      if (t) clearTimeout(t)
      t = setTimeout(save, 150)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', save)
    return () => {
      if (t) clearTimeout(t)
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', save)
      save() // 卸载前保存（进入详情页时）
    }
  }, [])

  // 内容加载完成后恢复滚动位置（仅首次；数据异步解密完成后再滚动，否则高度未定）
  useEffect(() => {
    if (restoredScrollRef.current) return
    if (items.length === 0 && (stats == null || (stats && stats.count === 0))) return
    restoredScrollRef.current = true
    try {
      const state = readScrollState()
      if (state && state.y > 0) {
        requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = state.y })
      }
    } catch { /* 忽略 */ }
  }, [items, stats])

  // 请求一页（服务器偏移 offset 起 10 条）并解密。
  // 两端数据源保持一致：在线 = 服务器真值 ∪ 未同步队列（首页），离线 = 缓存 ∪ 未同步队列。
  // 「未同步」的笔记在任何模式都可见（带徽标），不会出现「离线看得见、在线看不见」。
  // 返回值带 serverCount（本页消耗的服务器条目数）——队列条目并进首页后列表条数
  // 会多于 PAGE_SIZE，分页游标必须按服务器条目数推进，不能用 items.length。
  const fetchPage = useCallback(async (pageOffset: number): Promise<{ items: DecryptedItem[]; serverCount: number }> => {
    const dek = getDek()
    if (!dek) return { items: [], serverCount: 0 }
    let entries: Entry[]
    let serverCount: number
    let pendingIds = new Set<string>()
    const queued = await getQueuedEntries()
    const res = await fetch(`/api/diary?limit=${PAGE_SIZE}&offset=${pageOffset}`).catch(() => null)
    if (res) {
      if (!res.ok) throw new Error('加载失败')
      const server = ((await res.json()) as { entries: Entry[] }).entries
      serverCount = server.length
      // ★ 必须 await：这是「离线可读性」的不变量——**列表里出现过的条目，本地必须已有密文**。
      // 原文是 `void cacheEntriesPage(server)`（不等待），于是存在一个窗口：列表已经渲染出
      // 这些条目，而密文还没落 IndexedDB。用户此时断网（或 iOS 把页面挂起、写入再也没提交）
      // 再点开这篇，详情页在本地找不到密文 ⇒ 表现为「点了没反应」（2026-09-30 定位）。
      // 代价是每页一次 IndexedDB 写（几毫秒），换的是离线可读性的确定性。
      // prune 同理：串行化 + 等它结束，避免它在渲染后又改动缓存（并发 RMW 会互相覆盖，
      // 见 lib/client/offline.ts 的 withEntriesLock）。
      await cacheEntriesPage(server)
      await pruneCachedEntries(server, { isFirstPage: pageOffset === 0, isLastPage: server.length < PAGE_SIZE })
      // 未同步 = 队列里有、且服务器本页没有。服务器本页已有 ⇒ 冲刷已完成，
      // 不该再打「未同步」（徽标取自这次请求的实时状态，不依赖队列事件的时序）
      const serverIds = new Set(server.map((e) => e.id))
      pendingIds = new Set(queued.filter((q) => !serverIds.has(q.id)).map((q) => q.id))
      // 首页并入未同步队列（同 id 以服务器为准）；后续页只来自服务器
      entries = pageOffset === 0 ? unionWithPending(server, queued) : server
    } else {
      // 网络不可达：缓存（getCachedEntries 已按 createdAt 倒序）+ 队列（未同步，新→旧），
      // 合并后统一按创建时间倒序再切片（分页语义与在线一致）
      const cached = await getCachedEntries()
      pendingIds = new Set(queued.map((q) => q.id))
      const union = unionWithPending(cached, queued)
      entries = union.slice(pageOffset, pageOffset + PAGE_SIZE)
      serverCount = entries.length
      if (!entries.length) throw new Error('加载失败')
    }
    const decrypted: DecryptedItem[] = []
    for (const e of entries) {
      try {
        const plain = await decryptText(dek, e.ciphertext, e.iv)
        // 标题 = 首行非空行；预览 = 其后剩余正文（列表两行截断）。
        // 输入换成**纯文本派生**（而非 Markdown 源码），否则列表里会直接露出 `# ` 与 `**`。
        // 这里对同一篇只解析一次，标题/预览/字数全部从同一个纯文本串上取。
        const text = toPlainText(plain)
        const { title, preview } = deriveTitlePreview(text)
        decrypted.push({
          id: e.id,
          createdAt: new Date(e.createdAt),
          title,
          preview,
          wordCount: text.length,
          lat: e.latitude,
          locationName: e.locationName,
          pending: pendingIds.has(e.id),
        })
      } catch {
        // 单条解密失败跳过（数据损坏不阻塞列表）
      }
    }
    return { items: decrypted, serverCount }
  }, [])

  // 初始加载：统计 + 第一页（有滚动恢复状态 / 会话快照时循环加载到对应深度）
  // 统计离线兜底：请求失败（.catch → null）时回退缓存值。
  useEffect(() => {
    void (async () => {
      try {
        const restore = readScrollState()
        const [statsRes, first] = await Promise.all([
          fetch('/api/diary/stats')
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          fetchPage(0),
        ])
        const stats = statsRes ?? (await getCachedStats())
        if (statsRes) void cacheStats(statsRes)
        let loaded = first.items
        // 分页游标按服务器条目数推进（首页可能并入未同步队列的多余条目）
        let serverOffset = first.serverCount
        let lastServerCount = first.serverCount
        // 目标深度 = max(上次浏览深度, 本次挂载时快照已有条数)：既要覆盖滚动恢复，
        // 也不能让列表比首帧渲染出来的更短。
        const target = Math.max(restore?.count ?? 0, seededDepthRef.current)
        if (target > loaded.length) {
          // 继续加载直到覆盖目标深度（分页循环）
          while (loaded.length < target) {
            const more = await fetchPage(serverOffset)
            if (more.serverCount === 0) break
            serverOffset += more.serverCount
            lastServerCount = more.serverCount
            loaded = loaded.concat(more.items)
          }
        }
        if (stats) setStats(stats)
        setItems(loaded)
        setOffset(serverOffset)
        setHasMore(lastServerCount === PAGE_SIZE)
      } catch {
        setError('连接失败，请检查网络后重试')
      } finally {
        // 无论成功失败都要收掉 loading：失败会走 error 分支（整页提示），
        // 成功则不再有「数据还在路上」的阶段。
        setLoading(false)
      }
    })()
  }, [fetchPage])

  // 队列变化（冲刷成功 / 离线删除未同步笔记）→ 只刷新「未同步」标记，不重取整表
  // （保持滚动位置与已加载深度）。同步成功后徽标立即消失。
  useEffect(() => {
    const onQueueChanged = () => {
      void (async () => {
        const queued = await getQueuedEntries()
        const ids = new Set(queued.map((q) => q.id))
        setItems((prev) => prev.map((i) => (i.pending === ids.has(i.id) ? i : { ...i, pending: ids.has(i.id) })))
      })()
    }
    window.addEventListener(QUEUE_EVENT, onQueueChanged)
    return () => window.removeEventListener(QUEUE_EVENT, onQueueChanged)
  }, [])

  // 加载更多（点击按钮）
  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const page = await fetchPage(offset)
      setItems((prev) => [...prev, ...page.items])
      setOffset((o) => o + page.serverCount)
      setHasMore(page.serverCount === PAGE_SIZE)
    } catch {
      setError('连接失败，请检查网络后重试')
    } finally {
      setLoadingMore(false)
    }
  }

  // 按本地日期分组（基于已加载条目）；组头统计取服务端全量聚合
  // （byDay 按笔记时区归日，与列表本地时区分组在跨时区边缘可能差一天——单用户场景忽略）。
  const groups: Group[] = (() => {
    const sorted = [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    const grouped = new Map<string, DecryptedItem[]>()
    for (const item of sorted) {
      const key = dayKey(item.createdAt)
      grouped.set(key, [...(grouped.get(key) ?? []), item])
    }
    return [...grouped.entries()].map(([key, list]) => {
      // 服务端全量统计（当天所有条目，不受分页影响）；stats 未加载时退回已加载统计。
      // 离线时叠加队列里的未同步篇数/字数——服务端统计（或其缓存）不含这批；
      // 无统计退回 list.length 时**不**再叠加（list 已含未同步条目，叠加会重复计）
      const dayStat = stats?.byDay?.[key]
      const pendingList = list.filter((i) => i.pending)
      return {
        key,
        label: dayLabel(key),
        statCount: dayStat ? dayStat.count + pendingList.length : list.length,
        statWords: dayStat ? dayStat.words + pendingList.reduce((s, i) => s + i.wordCount, 0) : list.reduce((s, i) => s + i.wordCount, 0),
        items: list.map((i) => ({
          id: i.id,
          time: i.createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
          title: i.title,
          preview: i.preview,
          wordCount: i.wordCount,
          lat: i.lat,
          locationName: i.locationName,
          pending: i.pending,
        })),
      }
    })
  })()

  if (error) {
    return (
      <main className="mx-auto flex h-full w-full max-w-md items-center justify-center px-5 safe-pt">
        <div className="text-center">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-3 text-sm font-medium text-white">重试</button>
        </div>
      </main>
    )
  }

  return (
    /* 容器滚动（main 自身 overflow-y-auto，高度 = 可用高度）：底部 TabBar 是流内元素，
       若继续用 window 滚动，列表内容会把 TabBar 挤到文档末尾——必须滚动到底才能看到它。
       代价：失去 iOS「点状态栏回到顶部」的原生行为（那作用于 window 滚动），
       换来与其余页面（/settings、/entry、/settings/*）一致的滚动模型。 */
    <main ref={scrollRef} className="mx-auto h-full w-full max-w-md overflow-y-auto px-5 safe-pt">
      {/* 电脑版与主页同宽（手机视图宽度），不随屏幕拉伸 */}
      {/* viewTransitionName：页面切换动画中页头保持固定（空间锚点） */}
      {/* 本页是 tab 目的地之一，不再放返回箭头（回首页由 TabBar 的「写」承担）；
          标题用绝对定位居中，右侧保留搜索入口，故用 justify-end */}
      <header className="page-header relative flex items-center justify-end py-3">
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">全部日记</h1>
        {/* 搜索：点击后弹出全屏搜索层（正文加密，检索只能在客户端解密后完成） */}
        <button onClick={() => setSearchOpen(true)} aria-label="搜索日记" className="-mr-1 px-1 text-neutral-500 dark:text-neutral-400 active:opacity-60">
          <SearchIcon />
        </button>
      </header>
      {stats && (
        <>
          <div className="flex items-baseline justify-between gap-2 pb-2 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
            {/* 用户名放在最前（名字是懒生成的，未就绪时整段省略，不留空位）；名字过长截断 */}
            <span className="min-w-0 truncate">
              {userName && <>{userName} | </>}{stats.days} 天·共 {stats.count} 篇
            </span>
            {/* 总字数：byDay 各天字数之和（千分位） */}
            <span className="shrink-0">共写了 {Object.values(stats.byDay ?? {}).reduce((sum, d) => sum + d.words, 0).toLocaleString()} 字</span>
          </div>
          {/* 写作频率热力图（仅在有日记时显示） */}
          {stats.count > 0 && <ContributionHeatmap byDay={stats.byDay ?? {}} />}
        </>
      )}
      <div className="flex flex-col gap-6 pb-4">
        {groups.map((g, gi) => (
          <section key={g.key} className={gi > 0 ? 'border-t border-neutral-100 pt-4 dark:border-neutral-800' : ''}>
            {/* 组头：日期（今天/昨天人性化）+ 当天篇数 + 当天总字数（服务端全量聚合，
                分页未加载完时仍显示当天全部统计）。全部组统一主题色渐变文字；
                用 Tailwind 4 新类名 bg-linear-to-r（旧 bg-gradient-to-r 兼容层可能只渲染起始色） */}
            <h2 className="mb-2 bg-linear-to-r from-orange-500 via-rose-500 to-violet-500 bg-clip-text text-sm font-medium text-transparent">
              {g.label} · {g.statCount} 篇 · {g.statWords} 字
            </h2>
            <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
              {g.items.map((item) => (
                <li key={item.id}>
                  <Link href={`/entry/${item.id}`} className="flex flex-col gap-1 py-3 active:opacity-60">
                    <span className="flex items-baseline gap-2">
                      <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">{item.time}</span>
                      {/* 标题 = 首行加粗 */}
                      <span className="line-clamp-1 font-medium text-neutral-800 dark:text-neutral-200">{item.title}</span>
                      {/* 未同步徽标：离线新增、尚未上传服务器的笔记（断网图标，同步后消失） */}
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
                    {/* 剩余正文预览（单行截断；标题已单行截断） */}
                    {item.preview && (
                      <span className="line-clamp-1 whitespace-pre-wrap text-sm text-neutral-500 dark:text-neutral-400">
                        {item.preview}
                      </span>
                    )}
                    {/* 元信息：定位图标 + 地点名（左），字数右对齐 */}
                    <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[10px] text-neutral-500 dark:text-neutral-400">
                      <span className="flex min-w-0 items-center gap-1">
                        {item.lat != null && <span>📍</span>}
                        {item.locationName && <span className="truncate">{item.locationName}</span>}
                      </span>
                      <span className="shrink-0">{item.wordCount} 字</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {/* 空态只在「确实取完了、而且真的一条都没有」时显示。加载中不能显示它——
            那是把「数据还在路上」说成「你没有日记」，也是切 tab 时最容易看到的错误闪现。 */}
        {!loading && items.length === 0 && <p className="pt-20 text-center text-sm text-neutral-500 dark:text-neutral-400">还没有日记</p>}
        {items.length > 0 && (
          <div className="pt-2">
            {hasMore ? (
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="w-full rounded-xl bg-neutral-100 py-3 text-sm text-neutral-500 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-400"
              >
                {loadingMore ? '加载中…' : '加载更多'}
              </button>
            ) : (
              <p className="py-3 text-center text-xs text-neutral-500 dark:text-neutral-400">已显示全部</p>
            )}
          </div>
        )}
      </div>
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </main>
  )
}
