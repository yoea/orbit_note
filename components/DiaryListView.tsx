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
import StarIcon from './StarIcon'
import Toast from './Toast'
import { displayLocationName } from '@/lib/client/location'
import { isHeatmapEnabled } from '@/lib/client/prefs'
import { deriveTitlePreview, toPlainText } from '@/lib/client/markdown'
import { dayKeyOf } from '@/lib/client/date-jump'

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
  locationProvince: string | null
  locationCity: string | null
  locationDistrict: string | null
  locationName: string | null
  weather: string | null
  timezone: string | null
  starred: boolean
  /** 打开次数（数据库列）。列表**不展示**它（只在查看页底部），但要随整行进本地缓存——
   *  否则离线打开这一篇会读到 0。 */
  viewCount: number
}

interface DecryptedItem {
  id: string
  createdAt: Date
  title: string // 首行非空行（加粗标题）
  preview: string // 去除标题行后的剩余正文
  wordCount: number // 解密时计算（trim 后长度，与详情页/编辑器口径一致）
  lat: number | null
  /** 展示用的地名串（结构化三级拼接，老数据回退单一串）——见 displayLocationName */
  locationName: string | null
  pending: boolean // 离线新增、尚未同步到服务器的笔记（列表显示「未同步」徽标）
  starred: boolean // 收藏（暖色 Q 版五角星，只在列表与查看页展示）
}

/**
 * 分页游标：指向「已经取过的最旧一条」，下一次请求取严格更旧的条目。
 * 用 (createdAt, id) 一对而不是单一时间戳，是因为同一秒可能有多条
 * （Day One 导入是秒级精度），只按时间比会整批跳过。
 * id 可为 null 的情况服务于「按日期取一页」的服务端能力（当前客户端不再使用，
 * 见 app/api/diary/route.ts 的 before 注释）。
 */
interface Cursor {
  at: string
  id: string | null
}

interface Group {
  key: string // yyyy-mm-dd（本地时区）
  label: string // 今天 / 昨天 / 2026年8月25日 · 星期二
  items: { id: string; time: string; title: string; preview: string; wordCount: number; lat: number | null; locationName: string | null; pending: boolean; starred: boolean }[]
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
//
// scrollTop：当前滚动位置，随滚动一路更新（见 rememberScroll）。
// 为什么不只靠 sessionStorage（2026-10-02 修「从详情返回回到顶部」）：卸载时 React 已经把滚动
// 容器从文档里摘掉，那时读 el.scrollTop 会得到 0（无布局盒），于是存下去的永远是「顶部」。
// 内存快照里的这份是滚动过程中实时记下的，不依赖「卸载那一刻还能不能读到节点」。
let snapshot: { items: DecryptedItem[]; stats: Stats | null; cursor: Cursor | null; hasMore: boolean; scrollTop: number } | null = null

// 组头：今天/昨天人性化显示，其余显示 日期 + 星期
function dayLabel(key: string): string {
  const today = dayKeyOf(new Date())
  if (key === today) return '今天'
  const y = new Date()
  y.setDate(y.getDate() - 1)
  if (key === dayKeyOf(y)) return '昨天'
  const d = new Date(`${key}T00:00:00`)
  return `${d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })} · ${d.toLocaleDateString('zh-CN', { weekday: 'long' })}`
}

// 全部日记视图（原生路由页 /diary 渲染；DEK 会话级持久化，导航/重载自动恢复）
//
// ★ 这里**没有**「按日期跳转 / 定位到某天」（2026-10-02 用户要求移除）。
//   做过一版：日期胶囊 + 月历 + 锚定窗口 + 双向游标 + prepend 滚动补偿，真机上滚动补偿不稳
//   （上滑卡顿、闪跳），而且它本质是「我要找某天」= 检索行为，放在列表页要背一整套分页/滚动
//   状态机。现在按日期筛在**搜索面板**里（时间档的「具体日期」日历），那边把全部条目解密到
//   内存后本地筛，按天筛既精确又完整。列表页只负责「从新到旧地翻」这一件事。
export default function DiaryListView() {
  // 首帧直接用会话快照（上一次离开本页时的内容）：切 tab 回来时立刻有内容，
  // 不再经历「空列表 → 数据到齐」那段可感知的空白。随后照常重取覆盖。
  const [items, setItems] = useState<DecryptedItem[]>(() => snapshot?.items ?? [])
  const [stats, setStats] = useState<Stats | null>(() => snapshot?.stats ?? null)
  const [hasMore, setHasMore] = useState(() => snapshot?.hasMore ?? true)
  // 待取游标（null = 还没取过，即从最新开始）
  const [cursor, setCursor] = useState<Cursor | null>(() => snapshot?.cursor ?? null)
  const [loadingMore, setLoadingMore] = useState(false)
  // 热力图显示开关（偏好 qo-show-heatmap，默认开）：渲染条件，惰性初值同步读即可
  const [showHeatmap] = useState(() => isHeatmapEnabled())
  // 首次进入（无快照可渲染）时列表本来就是空的——那不是「没有日记」，是数据还在路上。
  const [loading, setLoading] = useState(() => snapshot == null)
  const [error, setError] = useState<string | null>(null)
  // 一次性提示一律走 Toast（fixed 悬浮、不占布局）：
  // ★ 不能用内联行——内联行会在滚动区里凭空多出一行、把列表整体推下去（布局弹跳），
  //   而且滑下去就看不见了。见 components/Toast.tsx。
  const [toast, setToast] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  // 挂载时的既有深度：重取时至少要补齐到这里，否则后台刷新一回来列表会「缩水」、
  // 滚动位置跟着跳（快照深度可能大于 sessionStorage 里记的上次浏览深度）。
  const seededDepthRef = useRef(snapshot ? snapshot.items.length : 0)
  const userName = useUserName()
  // 滚动位置保持：sessionStorage 存 { y, count }——返回时先加载到足够深度再恢复滚动。
  const SCROLL_KEY = 'qo-diary-scroll'
  const restoredScrollRef = useRef(false)
  const itemsRef = useRef<DecryptedItem[]>([])
  // ★ 滚动容器 = **列表区那个 div**（不是 window，也不是外层 main）：
  //   本页是「固定区（标题栏 + 统计 + 热力图）+ 内部滚动区」布局，固定区待在滚动容器之外
  //   （与底部 TabBar 同一套做法，不用 position:fixed）。
  //   所有与滚动相关的东西——位置保存/恢复、IntersectionObserver 的 root——都绑在它上面；
  //   换布局时必须同步改，否则表现为「滑到底不加载」或「位置记不住」，且零报错。
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // 触底哨兵 + 取数用的 ref（游标/开关放进 ref，加载函数才保持稳定引用，
  // IntersectionObserver 也就不用每次翻页都重建）。
  const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null)
  const cursorRef = useRef<Cursor | null>(cursor)
  const hasMoreRef = useRef(hasMore)
  const fetchingRef = useRef(false)
  // 最近一次「节点还挂在文档里」时读到的滚动位置。卸载时用它，而不是再读一次节点
  // （那时容器已摘除，scrollTop 会读成 0 —— 见 snapshot 的注释）。
  const lastScrollTopRef = useRef(0)

  // 同步给 ref：这些 ref 只被异步回调（滚动保存、observer 回调）读取，因此在 effect 里赋值。
  // 不要写回渲染期赋值——渲染期写 ref 会在并发渲染下读到尚未提交的值（react-hooks/refs 也禁止）。
  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => { cursorRef.current = cursor }, [cursor])
  useEffect(() => { hasMoreRef.current = hasMore }, [hasMore])

  // 快照回写：状态一变就覆盖（组件随后被卸载也无妨——模块级变量本就该继续持有最后的内容）。
  // scrollTop 保留上一次的值：它由滚动回调实时更新（rememberScroll），不能被这里的覆盖清零。
  useEffect(() => {
    snapshot = { items, stats, cursor, hasMore, scrollTop: snapshot?.scrollTop ?? 0 }
  }, [items, stats, cursor, hasMore])

  // 记下当前滚动位置（滚动回调里实时调用；同时写入内存快照与 sessionStorage）
  function rememberScroll(y: number) {
    if (snapshot) snapshot.scrollTop = y
  }

  // Toast 自动消失（与 SettingsView 的离线提示同一套做法：外层控制移除）
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  // 读取恢复状态：{ y, count } 或 null
  const readScrollState = (): { y: number; count: number } | null => {
    try {
      const raw = sessionStorage.getItem(SCROLL_KEY)
      if (!raw) return null
      const d = JSON.parse(raw) as { y?: unknown; count?: unknown }
      if (typeof d.y === 'number' && Number.isFinite(d.y) && typeof d.count === 'number') {
        return { y: d.y, count: d.count }
      }
    } catch { /* 忽略 */ }
    return null
  }

  // 保存滚动位置：滚动防抖写入 sessionStorage；页面隐藏/卸载时兜底保存。
  // 监听对象是滚动容器元素而非 window——本页是容器滚动。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let t: ReturnType<typeof setTimeout> | null = null
    const persist = (y: number) => {
      rememberScroll(y)
      try {
        sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ y, count: itemsRef.current.length }))
      } catch { /* 忽略 */ }
    }
    const save = () => persist(lastScrollTopRef.current)
    const onScroll = () => {
      // ★ 位置在**滚动事件里**读（此刻节点一定还挂在文档里），存进 ref；
      //   卸载时只写 ref 里的值，不再读节点 —— 详见 snapshot 与 lastScrollTopRef 的注释。
      lastScrollTopRef.current = el.scrollTop
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

  // 恢复滚动位置（每次挂载只做一次）。
  // ★ 为什么不能只赋一次值（2026-10-02 修「从详情返回回到列表顶部」）：赋值那一刻若内容高度
  //   还没算出来（数据在异步解密、或 React 还没提交完列表），scrollTop 会被**钳到 0 或最大值**。
  //   所以按帧重试到「赋值后回读的值真的到位」为止，最多 30 帧；用户一旦自己触摸/滚动就立刻放弃
  //   （不能跟人抢滚动条）。
  useEffect(() => {
    if (restoredScrollRef.current) return
    if (items.length === 0 && (stats == null || (stats && stats.count === 0))) return
    restoredScrollRef.current = true
    // 位置来源优先级：**内存快照**（滚动过程中实时更新，最可靠）> sessionStorage（硬刷新后才有）
    const target = snapshot?.scrollTop ?? readScrollState()?.y ?? 0
    lastScrollTopRef.current = target
    if (target <= 0) return
    let left = 30
    let cancelled = false
    const cancel = () => { cancelled = true }
    window.addEventListener('touchstart', cancel, { once: true, passive: true })
    window.addEventListener('wheel', cancel, { once: true, passive: true })
    const tick = () => {
      if (cancelled) return
      const el = scrollRef.current
      if (!el) return
      el.scrollTop = target
      // 赋值后立刻回读：值到位 ⇒ 内容高度已经够，收工；否则下一帧再试
      if (Math.abs(el.scrollTop - target) <= 2 || left-- <= 0) return
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [items, stats])

  // 取一页（游标：null = 从最新开始，否则从该游标取更旧的一页）并解密。
  // 数据源约定：在线 = 服务器真值 ∪ 未同步队列（首页），离线 = 本地缓存 ∪ 未同步队列。
  // 「未同步」的笔记在任何模式都可见（带徽标），不会出现「离线看得见、在线看不见」。
  const fetchPage = useCallback(async (from: Cursor | null): Promise<{ items: DecryptedItem[]; serverCount: number; cursor: Cursor | null }> => {
    const dek = getDek()
    if (!dek) return { items: [], serverCount: 0, cursor: null }
    let entries: Entry[]
    let serverCount: number
    let pendingIds = new Set<string>()
    let nextCursor: Cursor | null = null
    const queued = await getQueuedEntries()
    const qs = from
      ? `&before=${encodeURIComponent(from.at)}${from.id ? `&beforeId=${encodeURIComponent(from.id)}` : ''}`
      : ''
    const res = await fetch(`/api/diary?limit=${PAGE_SIZE}${qs}`).catch(() => null)
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
      // isFirstPage 只在「这一页就是从服务器最新一条开始」时为 true：
      // 只有首页能证明「比它还新的条目都不存在」，据此清理缓存里已被删除的条目
      // （见 lib/client/offline.ts 的 staleCachedIds）。
      await pruneCachedEntries(server, { isFirstPage: from === null, isLastPage: server.length < PAGE_SIZE })
      // 未同步 = 队列里有、且服务器本页没有。服务器本页已有 ⇒ 冲刷已完成，
      // 不该再打「未同步」（徽标取自这次请求的实时状态，不依赖队列事件的时序）
      const serverIds = new Set(server.map((e) => e.id))
      pendingIds = new Set(queued.filter((q) => !serverIds.has(q.id)).map((q) => q.id))
      // 未同步队列只并进第一页（它们的时间戳都是「现在」，只可能落在最新那一段）
      entries = from === null ? unionWithPending(server, queued) : server
      const last = server[server.length - 1]
      nextCursor = last ? { at: last.createdAt, id: last.id } : null
    } else {
      // 网络不可达：回退本地缓存（getCachedEntries 已按 createdAt 倒序）+ 队列（未同步，新→旧），
      // 合并后按创建时间倒序。**离线也能继续往下翻**——靠游标在合并数组里定位：
      // 优先按 id 命中（这条必然在缓存里，因为「列表里看得见 ⇒ 本地已有密文」），
      // 命中不了再退回时间比较（缓存被清理过等边缘情况）。
      const cached = await getCachedEntries()
      const union = unionWithPending(cached, queued)
      let startIdx = 0
      if (from) {
        const byId = from.id ? union.findIndex((e) => e.id === from.id) : -1
        if (byId >= 0) startIdx = byId + 1
        else {
          const byTime = union.findIndex((e) => e.createdAt < from.at)
          startIdx = byTime >= 0 ? byTime : union.length
        }
      }
      const slice = union.slice(startIdx, startIdx + PAGE_SIZE)
      entries = slice
      serverCount = slice.length
      if (!slice.length) {
        // 首页就为空才算「真的没有」；后续页取空只表示「本地到此为止」
        if (from === null) throw new Error('加载失败')
        return { items: [], serverCount: 0, cursor: null }
      }
      pendingIds = new Set(queued.map((q) => q.id))
      const last = slice[slice.length - 1]
      nextCursor = startIdx + slice.length < union.length ? { at: last.createdAt, id: last.id } : null
    }
    const decrypted: DecryptedItem[] = []
    for (const e of entries) {
      try {
        const plain = await decryptText(dek, e.ciphertext, e.iv)
        // 标题 = 首行非空行；预览 = 其后剩余正文（列表两行截断）。
        // 输入换成**纯文本派生**（而非 Markdown 源码），否则列表里会直接露出 `# ` 与 `**`。
        const text = toPlainText(plain)
        const { title, preview } = deriveTitlePreview(text)
        decrypted.push({
          id: e.id,
          createdAt: new Date(e.createdAt),
          title,
          preview,
          wordCount: text.length,
          lat: e.latitude,
          // 展示口径统一走 displayLocationName（结构化优先、老数据回退单一串）——
          // 与详情页/搜索用同一个函数，同一地点不会在不同页面显示成不同名字。
          locationName: displayLocationName(e),
          pending: pendingIds.has(e.id),
          starred: e.starred,
        })
      } catch {
        // 单条解密失败跳过（数据损坏不阻塞列表）
      }
    }
    return { items: decrypted, serverCount, cursor: nextCursor }
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
          fetchPage(null),
        ])
        const stats = statsRes ?? (await getCachedStats())
        if (statsRes) void cacheStats(statsRes)
        if (stats) setStats(stats)
        let loaded = first.items
        let nextCursor = first.cursor
        let lastServerCount = first.serverCount
        // 目标深度 = max(上次浏览深度, 本次挂载时快照已有条数)：既要覆盖滚动恢复，
        // 也不能让列表比首帧渲染出来的更短。
        const target = Math.max(restore?.count ?? 0, seededDepthRef.current)
        while (nextCursor && loaded.length < target) {
          const more = await fetchPage(nextCursor)
          if (more.serverCount === 0) break
          nextCursor = more.cursor
          lastServerCount = more.serverCount
          loaded = loaded.concat(more.items)
        }
        setItems(loaded)
        setCursor(nextCursor)
        setHasMore(lastServerCount === PAGE_SIZE)
      } catch {
        setError('连接失败，请检查网络后重试')
      } finally {
        // 无论成功失败都要收掉 loading：失败会走 error 分支（整页提示）。
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

  // 取更旧的一页（自动触底调用）。用 fetchingRef 而不是 state 做并发闸门：
  // IntersectionObserver 可能在同一帧连续触发多次，state 更新是异步的，拦不住。
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
      // 触底失败不整页报错（用户可能只是网络抖动）：给一次性提示，下滑还能重试。
      // 整页替换会把已经看过的内容全丢掉，代价太大。
      setToast('离线状态无法继续加载更早的日记')
      setHasMore(false)
    } finally {
      fetchingRef.current = false
      setLoadingMore(false)
    }
  }, [fetchPage])

  // 触底自动加载：root 必须是**那个滚动容器**（列表区 div 自身 overflow-y-auto），
  // 不能用默认 viewport——本页不是 window 滚动，用默认 root 会永远不触发，
  // 表现为「滑到底什么都不会发生」且没有任何报错。
  // rootMargin 提前 400px 预取，避免「到底了才转圈」。
  useEffect(() => {
    const root = scrollRef.current
    if (!sentinelEl || !root || !hasMore) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadOlder()
    }, { root, rootMargin: '400px 0px' })
    io.observe(sentinelEl)
    return () => io.disconnect()
  }, [sentinelEl, hasMore, loadOlder])

  // 按本地日期分组（基于已加载条目）；组头统计取服务端全量聚合
  // （byDay 按笔记时区归日，与列表本地时区分组在跨时区边缘可能差一天——单用户场景忽略）。
  const groups: Group[] = (() => {
    const sorted = [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    const grouped = new Map<string, DecryptedItem[]>()
    for (const item of sorted) {
      const key = dayKeyOf(item.createdAt)
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
          starred: i.starred,
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
    /* 布局 = **固定区 + 内部滚动区**：标题栏、统计行、热力图都待在滚动容器**之外**
       （与底部 TabBar 同一套做法，不用 position:fixed；固定区不会遮挡内容，也不需要补偿内边距）。
       · 标题栏固定：搜索入口随手可用。
       · 统计行与热力图固定：用户明确要求（2026-10-02）。代价是列表永远少约 116px 可视高度，
         这是有意的取舍——热力图是常看的「写作概览」，不该滚走。
       · 固定区里 stats 未就绪时也占位渲染（统计行留空行、热力图渲染空图）⇒ 数据到达时
         不会把列表整体推下去（布局不弹跳）。 */
    <main className="mx-auto flex h-full w-full max-w-md flex-col">
      <header className="page-header relative flex shrink-0 items-center justify-end px-5 py-3 safe-pt">
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">全部日记</h1>
        {/* 搜索：点击后弹出全屏搜索层（正文加密，检索只能在客户端解密后完成）。
            「找某一天」也在里面——时间档的「具体日期」日历（2026-10-02 从列表页搬过去）。 */}
        <button onClick={() => setSearchOpen(true)} aria-label="搜索日记" className="-mr-1 px-1 text-neutral-500 dark:text-neutral-400 active:opacity-60">
          <SearchIcon />
        </button>
      </header>

      {/* 固定区之二：统计行 + 热力图（含占位，保证高度稳定） */}
      <div className="shrink-0 px-5">
        <div className="flex items-baseline justify-between gap-2 pb-2 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
          {stats ? (
            <>
              {/* 用户名放在最前（名字是懒生成的，未就绪时整段省略，不留空位）；名字过长截断 */}
              <span className="min-w-0 truncate">
                {userName && <>{userName} | </>}{stats.days} 天·共 {stats.count} 篇
              </span>
              {/* 总字数：byDay 各天字数之和（千分位） */}
              <span className="shrink-0">共写了 {Object.values(stats.byDay ?? {}).reduce((sum, d) => sum + d.words, 0).toLocaleString()} 字</span>
            </>
          ) : (
            /* 占位：与真实那一行同高，避免数据到达时列表被推下去 */
            <span className="h-4" aria-hidden />
          )}
        </div>
        {/* 写作频率热力图：纯展示、无点击（格子只有 10px，触区远小于可点标准）。
            未就绪时渲染空图占位；一条日记都没有时不显示（那是新用户，空图反而是噪音）。 */}
        {showHeatmap && (stats === null || stats.count > 0) && (
          <ContributionHeatmap byDay={stats?.byDay ?? {}} />
        )}
      </div>

      {/* ★ 滚动容器：只有列表在这里面滚（与滚动相关的一切都绑在它上面） */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5">
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
                        {/* 收藏：暖色 Q 版五角星（**纯展示**，点击收藏只在查看页——列表行整体是一个链接） */}
                        {item.starred && (
                          <span
                            role="img"
                            aria-label="已收藏"
                            title="已收藏"
                            className="inline-flex shrink-0 translate-y-[1px]"
                          >
                            <StarIcon filled className="h-3.5 w-3.5" />
                          </span>
                        )}
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
          {!loading && items.length === 0 && (
            <p className="pt-20 text-center text-sm text-neutral-500 dark:text-neutral-400">还没有日记</p>
          )}
          {/* 触底哨兵 + 加载状态。原先这里是「加载更多」按钮——它把浏览变成了一次操作，
              每翻一页都要用户抬手。现在由 IntersectionObserver 自动取下一页；
              分页用游标后「翻页期间新增日记」也不再导致重复/漏条目。 */}
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

      {toast && <Toast message={toast} />}
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </main>
  )
}
