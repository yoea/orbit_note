'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { getDek } from '@/lib/client/session'
import { decryptText } from '@/lib/client/crypto/encryption'
import { useUserName } from '@/lib/client/use-user-name'
import { cacheEntriesPage, cacheStats, getCachedEntries, getCachedStats, getQueuedEntries, pruneCachedEntries, QUEUE_EVENT, unionWithPending } from '@/lib/client/offline'
import SearchDialog from './SearchDialog'
import SearchIcon from './SearchIcon'
import ContributionHeatmap from './ContributionHeatmap'
import DatePickerDialog from './DatePickerDialog'
import StarIcon from './StarIcon'
import Toast from './Toast'
import { displayLocationName } from '@/lib/client/location'
import { isHeatmapEnabled } from '@/lib/client/prefs'
import { deriveTitlePreview, toPlainText } from '@/lib/client/markdown'
import { dayEndIso, dayKeyOf, jumpDayLabel, parseDayKey, type DayKey } from '@/lib/client/date-jump'

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
 * 分页游标：指向「已经取过的某一条」，本身不带方向——
 * 取更旧的一页时当上界（`before`），取更新的一页时当下界（`after`）。
 * 用 (createdAt, id) 一对而不是单一时间戳，是因为同一秒可能有多条
 * （Day One 导入是秒级精度），只按时间比会整批跳过。
 * id 可为 null：按日期跳转时只知道「目标日 23:59:59.999」这个时间边界。
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
// anchor（当前锚定的日期，null = 正常时间轴）属于**视图状态**，与 items 一起进快照——
// 否则切个 tab 回来，锚定视图会莫名其妙回到最新。
let snapshot: { items: DecryptedItem[]; stats: Stats | null; cursorOlder: Cursor | null; hasOlder: boolean; anchor: DayKey | null } | null = null

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
export default function DiaryListView() {
  // 首帧直接用会话快照（上一次离开本页时的内容）：切 tab 回来时立刻有内容，
  // 不再经历「空列表 → 数据到齐」那段可感知的空白。随后照常重取覆盖。
  const [items, setItems] = useState<DecryptedItem[]>(() => snapshot?.items ?? [])
  const [stats, setStats] = useState<Stats | null>(() => snapshot?.stats ?? null)
  const [hasOlder, setHasOlder] = useState(() => snapshot?.hasOlder ?? true)
  // 两个方向的游标：older = 已取过的最旧一条（向下翻），newer = 已取过的最新一条（向上翻）
  const [cursorOlder, setCursorOlder] = useState<Cursor | null>(() => snapshot?.cursorOlder ?? null)
  const [cursorNewer, setCursorNewer] = useState<Cursor | null>(null)
  // hasNewer 只有锚定态可能为 true：未锚定时窗口顶部就是全库最新，没有「更新的一页」。
  const [hasNewer, setHasNewer] = useState(false)
  // 锚定的日期（null = 不锚定，从最新往下）
  const [anchor, setAnchor] = useState<DayKey | null>(() => snapshot?.anchor ?? null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadingNewer, setLoadingNewer] = useState(false)
  // 热力图显示开关（偏好 qo-show-heatmap，默认开）：渲染条件，惰性初值同步读即可
  const [showHeatmap] = useState(() => isHeatmapEnabled())
  // 首次进入（无快照可渲染）时列表本来就是空的——那不是「没有日记」，是数据还在路上。
  const [loading, setLoading] = useState(() => snapshot == null)
  const [error, setError] = useState<string | null>(null)
  // 一次性提示一律走 Toast（fixed 悬浮、不占布局）。
  // ★ 不能用内联行：内联行会在滚动区里凭空多出一行、把列表整体推下去（布局弹跳），
  //   而且滑下去就看不见了。见 components/Toast.tsx。
  const [toast, setToast] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // 挂载时的既有深度：重取时至少要补齐到这里，否则后台刷新一回来列表会「缩水」、
  // 滚动位置跟着跳（快照深度可能大于 sessionStorage 里记的上次浏览深度）。
  const seededDepthRef = useRef(snapshot ? snapshot.items.length : 0)
  const userName = useUserName()
  // 滚动位置保持：sessionStorage 存 { y, count, anchor }——返回时先加载到足够深度再恢复滚动。
  const SCROLL_KEY = 'qo-diary-scroll'
  const restoredScrollRef = useRef(false)
  const itemsRef = useRef<DecryptedItem[]>([])
  // ★ 滚动容器 = 列表区那个 div（**不是** window，也不是外层 main）：
  //   本页是「固定标题栏 + 内部滚动区」布局（标题栏与 TabBar 一样待在滚动容器之外，见 JSX 注释）。
  //   所有与滚动相关的东西——位置保存/恢复、IntersectionObserver 的 root——都绑在它上面；
  //   换布局时必须同步改，否则表现为「滑到底不加载」或「位置记不住」，且零报错。
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // 两端哨兵 + 取数用的 ref（游标/开关放进 ref，加载函数才保持稳定引用，
  // IntersectionObserver 也就不用每次翻页都重建）。
  const [olderSentinelEl, setOlderSentinelEl] = useState<HTMLDivElement | null>(null)
  const [newerSentinelEl, setNewerSentinelEl] = useState<HTMLDivElement | null>(null)
  const cursorOlderRef = useRef<Cursor | null>(cursorOlder)
  const cursorNewerRef = useRef<Cursor | null>(null)
  const hasOlderRef = useRef(hasOlder)
  const hasNewerRef = useRef(hasNewer)
  const anchorRef = useRef<DayKey | null>(anchor)
  const fetchingOlderRef = useRef(false)
  const fetchingNewerRef = useRef(false)
  // prepend 前的滚动锚点：插入完成后按高度差补偿 scrollTop，否则用户正在看的那条
  // 会被新内容整体推走——「无限向上加载」最经典的坑。
  const prependAnchorRef = useRef<{ height: number; top: number } | null>(null)
  // 「用户是否主动向上滚动过」：跳转刚落位时也在顶部、顶部哨兵天然可见——
  // 没有这道闸门就会立刻连环加载到今天、把刚做的锚定冲掉（点 9月10日 结果自动跳回最新，
  // 比「不能向上滚」更糟）。
  const userScrolledUpRef = useRef(false)
  const lastScrollTopRef = useRef(0)

  // 同步给 ref：这些 ref 只被异步回调（滚动保存、observer 回调）读取，因此在 effect 里赋值。
  // 不要写回渲染期赋值——渲染期写 ref 会在并发渲染下读到尚未提交的值（react-hooks/refs 也禁止）。
  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => { cursorOlderRef.current = cursorOlder }, [cursorOlder])
  useEffect(() => { cursorNewerRef.current = cursorNewer }, [cursorNewer])
  useEffect(() => { hasOlderRef.current = hasOlder }, [hasOlder])
  useEffect(() => { hasNewerRef.current = hasNewer }, [hasNewer])
  useEffect(() => { anchorRef.current = anchor }, [anchor])

  // 快照回写：状态一变就覆盖（组件随后被卸载也无妨——模块级变量本就该继续持有最后的内容）。
  useEffect(() => {
    snapshot = { items, stats, cursorOlder, hasOlder, anchor }
  }, [items, stats, cursorOlder, hasOlder, anchor])

  // Toast 自动消失（与 SettingsView 的离线提示同一套做法：外层控制移除）
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  // 读取恢复状态：{ y, count, anchor } 或 null
  const readScrollState = (): { y: number; count: number; anchor: DayKey | null } | null => {
    try {
      const raw = sessionStorage.getItem(SCROLL_KEY)
      if (!raw) return null
      const d = JSON.parse(raw) as { y?: unknown; count?: unknown; anchor?: unknown }
      if (typeof d.y === 'number' && Number.isFinite(d.y) && typeof d.count === 'number') {
        const a = typeof d.anchor === 'string' && parseDayKey(d.anchor) ? d.anchor : null
        return { y: d.y, count: d.count, anchor: a }
      }
    } catch { /* 忽略 */ }
    return null
  }

  // 保存滚动位置（防抖写入）+ 记录「用户是否向上滚过」。
  // 监听对象是滚动容器元素而非 window——本页是容器滚动。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let t: ReturnType<typeof setTimeout> | null = null
    const save = () => {
      try {
        sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ y: el.scrollTop, count: itemsRef.current.length, anchor: anchorRef.current }))
      } catch { /* 忽略 */ }
    }
    const onScroll = () => {
      const st = el.scrollTop
      // 向上移动过 ⇒ 允许顶部哨兵加载「更新的一页」（见 userScrolledUpRef 注释）。
      // 跳转/回到最新的程序化滚动会在 resetScrollTo 里显式复位这个标记，不会被误判。
      if (st < lastScrollTopRef.current) userScrolledUpRef.current = true
      lastScrollTopRef.current = st
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
        requestAnimationFrame(() => {
          const el = scrollRef.current
          if (!el) return
          el.scrollTop = state.y
          lastScrollTopRef.current = state.y
        })
      }
    } catch { /* 忽略 */ }
  }, [items, stats])

  // 向上插入后的滚动补偿（layout effect：在浏览器绘制前完成，用户看不到跳动）。
  // 只有真的 prepend 过（prependAnchorRef 非空）时才动滚动，避免和位置恢复抢。
  useLayoutEffect(() => {
    const a = prependAnchorRef.current
    if (!a) return
    prependAnchorRef.current = null
    const el = scrollRef.current
    if (!el) return
    const delta = el.scrollHeight - a.height
    if (delta > 0) el.scrollTop = a.top + delta
    // 补偿本身会触发一次 scroll 事件：把「上一次位置」对齐到补偿后的值，
    // 否则这一跳会被 onScroll 误判成「用户向上滚动」。
    lastScrollTopRef.current = el.scrollTop
  }, [items])

  // 取一页并解密。dir 决定方向：
  //   · 'older'：from 为 null ⇒ 从最新开始（未锚定的首页）；否则取比 from 更旧的一页（追加到底部）
  //   · 'newer'：取比 from 更新的一页（插到顶部）。只有锚定态会用到
  // 数据源约定不变：在线 = 服务器真值 ∪ 未同步队列（仅最新首页），离线 = 本地缓存 ∪ 队列。
  const fetchPage = useCallback(async (
    from: Cursor | null,
    dir: 'older' | 'newer',
  ): Promise<{ items: DecryptedItem[]; serverCount: number; cursor: Cursor | null }> => {
    const dek = getDek()
    if (!dek) return { items: [], serverCount: 0, cursor: null }
    let entries: Entry[]
    let serverCount: number
    let pendingIds = new Set<string>()
    let nextCursor: Cursor | null = null
    const queued = await getQueuedEntries()
    const qs = !from
      ? ''
      : dir === 'older'
        ? `&before=${encodeURIComponent(from.at)}${from.id ? `&beforeId=${encodeURIComponent(from.id)}` : ''}`
        : `&after=${encodeURIComponent(from.at)}${from.id ? `&afterId=${encodeURIComponent(from.id)}` : ''}`
    const res = await fetch(`/api/diary?limit=${PAGE_SIZE}${qs}`).catch(() => null)
    if (res) {
      if (!res.ok) throw new Error('加载失败')
      const raw = ((await res.json()) as { entries: Entry[] }).entries
      // 服务端对 older 方向按 createdAt desc 返回；newer 方向内部取「紧邻上方的 N 条」后反转，
      // 这里统一收敛成 desc（列表渲染与分组都假定 desc）。
      const server = dir === 'newer' ? [...raw].reverse() : raw
      serverCount = server.length
      // ★ 必须 await：这是「离线可读性」的不变量——**列表里出现过的条目，本地必须已有密文**。
      // 原文是 `void cacheEntriesPage(server)`（不等待），于是存在一个窗口：列表已经渲染出
      // 这些条目，而密文还没落 IndexedDB。用户此时断网（或 iOS 把页面挂起、写入再也没提交）
      // 再点开这篇，详情页在本地找不到密文 ⇒ 表现为「点了没反应」（2026-09-30 定位）。
      await cacheEntriesPage(server)
      if (dir === 'older') {
        // ★ isFirstPage 只在「真的从服务器最新一条开始」时为 true（即没带游标）。
        // 锚定页**不是**首页：它的窗口在时间轴中段，若误传 true，staleCachedIds 会把所有
        // 「比本页更新」的缓存条目判成「服务器已删除」而清掉——跳一次就把近期缓存洗了。
        await pruneCachedEntries(server, { isFirstPage: from === null, isLastPage: server.length < PAGE_SIZE })
      } else {
        // 向上取时：返回不足一页 ⇒ 服务器没有更新的条目了，本页就含最新的那条 ⇒ 首页
        await pruneCachedEntries(server, { isFirstPage: server.length < PAGE_SIZE, isLastPage: false })
      }
      // 未同步 = 队列里有、且服务器本页没有。服务器本页已有 ⇒ 冲刷已完成，
      // 不该再打「未同步」（徽标取自这次请求的实时状态，不依赖队列事件的时序）
      const serverIds = new Set(server.map((e) => e.id))
      pendingIds = new Set(queued.filter((q) => !serverIds.has(q.id)).map((q) => q.id))
      // 未同步队列只并进**最新那一段**（无游标的首页）：它们的时间戳都是「现在」，
      // 锚定到历史窗口时既不属于那个窗口，也会干扰游标计算。
      entries = dir === 'older' && from === null ? unionWithPending(server, queued) : server
      // 游标推进：older 方向记「本页最旧一条」，newer 方向记「本页最新一条」
      const edge = dir === 'older' ? server[server.length - 1] : server[0]
      nextCursor = edge ? { at: edge.createdAt, id: edge.id } : null
    } else {
      // 网络不可达：回退本地缓存（getCachedEntries 已按 createdAt 倒序）+ 队列（未同步，新→旧），
      // 合并后按创建时间倒序。**离线也能继续往下翻**——靠游标在合并数组里定位：
      // 优先按 id 命中（这条必然在缓存里，因为「列表里看得见 ⇒ 本地已有密文」），
      // 命中不了再退回时间比较（缓存被清理过等边缘情况）。
      // 向上（newer）方向离线不做：本地缓存的密度不足以证明「更新的一页」是完整的，
      // 与其给出可能缺条的窗口，不如明说做不到。
      if (dir === 'newer') throw new Error('offline-newer')
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
        // 按日期跳转要求「本地确实有那一天」：缓存是稀疏的（只含浏览过的页），
        // 找不到必须说清楚「离线跳不了」，**绝不能**显示成「这一天没有日记」——那是在撒谎。
        const targetDay = dayKeyOf(new Date(from.at))
        if (!union.some((e) => dayKeyOf(new Date(e.createdAt)) === targetDay)) throw new Error('offline-jump')
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

  // 进入锚定态时统一设置两端游标与开关（初始加载恢复锚定与用户跳转共用，避免两处漂移）
  function applyAnchor(day: DayKey, pageItems: DecryptedItem[]) {
    setAnchor(day)
    setHasNewer(true)
    const top = pageItems[0]
    // 顶部游标 = 本页最新那条；向上取更新的一页时以它为界
    setCursorNewer(top ? { at: top.createdAt.toISOString(), id: top.id } : null)
  }

  // 滚动到指定位置并复位「向上滚动过」标记（跳转 / 回到最新都从这里走，口径一致）
  function resetScrollTo(top: number, day: DayKey | null) {
    const el = scrollRef.current
    if (el) el.scrollTop = top
    userScrolledUpRef.current = false
    lastScrollTopRef.current = top
    try {
      sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ y: top, count: itemsRef.current.length, anchor: day }))
    } catch { /* 忽略 */ }
  }

  // 初始加载：统计 + 第一页（有锚定状态 / 滚动恢复状态 / 会话快照时循环加载到对应深度）
  useEffect(() => {
    void (async () => {
      try {
        const restore = readScrollState()
        // 恢复优先级：会话快照的锚定 > sessionStorage 的锚定 > 最新
        const startAnchor = snapshot?.anchor ?? restore?.anchor ?? null
        const anchorEnd = startAnchor ? dayEndIso(startAnchor) : null
        const [statsRes, firstTry] = await Promise.all([
          fetch('/api/diary/stats')
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          fetchPage(anchorEnd ? { at: anchorEnd, id: null } : null, 'older').catch(() => null),
        ])
        const stats = statsRes ?? (await getCachedStats())
        if (statsRes) void cacheStats(statsRes)
        if (stats) setStats(stats)
        // 锚定状态离线恢复不了（本地没缓存那一天）：**退回最新并说明**，
        // 而不是把整页替换成错误提示——用户只是离线，列表本身还是该能看的。
        let first = firstTry
        let anchorApplied = startAnchor
        if (!first && anchorEnd) {
          first = await fetchPage(null, 'older').catch(() => null)
          anchorApplied = null
          if (first) setToast('离线状态无法显示上次定位的日期，已回到最新')
        }
        if (!first) { setError('连接失败，请检查网络后重试'); return }
        if (anchorApplied) applyAnchor(anchorApplied, first.items)
        let loaded = first.items
        let nextCursor = first.cursor
        let lastServerCount = first.serverCount
        // 目标深度 = max(上次浏览深度, 本次挂载时快照已有条数)：既要覆盖滚动恢复，
        // 也不能让列表比首帧渲染出来的更短。
        const target = Math.max(restore?.count ?? 0, seededDepthRef.current)
        while (nextCursor && loaded.length < target) {
          const more = await fetchPage(nextCursor, 'older')
          if (more.serverCount === 0) break
          nextCursor = more.cursor
          lastServerCount = more.serverCount
          loaded = loaded.concat(more.items)
        }
        setItems(loaded)
        setCursorOlder(nextCursor)
        setHasOlder(lastServerCount === PAGE_SIZE)
      } catch {
        setError('连接失败，请检查网络后重试')
      } finally {
        // 无论成功失败都要收掉 loading：失败会走 error 分支（整页提示）。
        setLoading(false)
      }
    })()
  }, [fetchPage])

  // 队列变化（冲刷成功 / 离线删除未同步笔记）→ 只刷新「未同步」标记，不重取整表
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

  // 取更旧的一页（滚到底部触发）。用 ref 而不是 state 做并发闸门：
  // IntersectionObserver 可能在同一帧连续触发多次，state 更新是异步的，拦不住。
  const loadOlder = useCallback(async () => {
    if (fetchingOlderRef.current || !hasOlderRef.current) return
    const from = cursorOlderRef.current
    if (!from) return
    fetchingOlderRef.current = true
    setLoadingMore(true)
    try {
      const page = await fetchPage(from, 'older')
      setItems((prev) => [...prev, ...page.items])
      setCursorOlder(page.cursor)
      setHasOlder(page.serverCount === PAGE_SIZE)
    } catch {
      // 触底失败不整页报错（用户可能只是网络抖动）：给一次性提示，下滑还能重试。
      // 整页替换会把已经看过的内容全丢掉，代价太大。
      setToast('离线状态无法继续加载更早的日记')
      setHasOlder(false)
    } finally {
      fetchingOlderRef.current = false
      setLoadingMore(false)
    }
  }, [fetchPage])

  // 取更新的一页（锚定态下从顶部继续向上滚动触发）：插到列表**前面**并补偿滚动位置
  const loadNewer = useCallback(async () => {
    if (fetchingNewerRef.current || !hasNewerRef.current) return
    const from = cursorNewerRef.current
    if (!from) return
    fetchingNewerRef.current = true
    setLoadingNewer(true)
    try {
      const page = await fetchPage(from, 'newer')
      if (page.items.length) {
        // ★ 记下插入前的滚动锚点：插入后按高度差补偿，否则正在看的条目被推走
        const el = scrollRef.current
        if (el) prependAnchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
        setItems((prev) => [...page.items, ...prev])
        setCursorNewer(page.cursor)
      }
      // 返回不足一页 ⇒ 已经够到全库最新：**自动解除锚定**。
      // 不解除的话会出现「我已经滑到最新了，但胶囊还写着已定位到 9月10日」的自相矛盾。
      if (page.serverCount < PAGE_SIZE) {
        setHasNewer(false)
        setAnchor(null)
        setCursorNewer(null)
      }
    } catch (e) {
      setToast(e instanceof Error && e.message === 'offline-newer' ? '离线状态无法加载更近的日期' : '加载失败，请检查网络')
      setHasNewer(false)
    } finally {
      fetchingNewerRef.current = false
      setLoadingNewer(false)
    }
  }, [fetchPage])

  // 向下触底自动加载：root 必须是**那个滚动容器**（列表区 div 自身 overflow-y-auto），
  // 不能用默认 viewport——本页不是 window 滚动，用默认 root 会永远不触发，
  // 表现为「滑到底什么都不会发生」且没有任何报错。
  // rootMargin 提前 400px 预取，避免「到底了才转圈」。
  useEffect(() => {
    const root = scrollRef.current
    if (!olderSentinelEl || !root || !hasOlder) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadOlder()
    }, { root, rootMargin: '400px 0px' })
    io.observe(olderSentinelEl)
    return () => io.disconnect()
  }, [olderSentinelEl, hasOlder, loadOlder])

  // 向上触顶加载「更新的一页」：只在锚定态存在（未锚定时窗口顶部就是全库最新）。
  // ★ 不给 rootMargin，且必须由「用户主动向上滚动过」放行——
  //   跳转刚落位时也在顶部、顶部哨兵天然可见；没有这道闸门会立刻连环加载到今天，
  //   把刚做的锚定冲掉（点 9月10日 结果列表自动跳回最新，比不能向上滚更糟）。
  useEffect(() => {
    const root = scrollRef.current
    if (!newerSentinelEl || !root || !hasNewer) return
    const io = new IntersectionObserver((entries) => {
      if (!userScrolledUpRef.current) return
      if (entries.some((e) => e.isIntersecting)) void loadNewer()
    }, { root })
    io.observe(newerSentinelEl)
    return () => io.disconnect()
  }, [newerSentinelEl, hasNewer, loadNewer])

  // 跳到某一天：清空当前窗口、以「该日 23:59:59.999」为界重取第一页。
  // 这是**重新锚定**而不是滚动——10 条/页，靠加载滑到一年前要几十次请求。
  async function doJump(day: DayKey) {
    const end = dayEndIso(day)
    if (!end) return
    setLoading(true)
    try {
      const first = await fetchPage({ at: end, id: null }, 'older')
      setItems(first.items)
      setCursorOlder(first.cursor)
      setHasOlder(first.serverCount === PAGE_SIZE)
      applyAnchor(day, first.items)
      // 跳转是「换了个位置看」，不是「接着上次看」：滚到顶部并复位向上滚动标记，
      // 让滚动恢复逻辑放过这一次（否则旧的 y 会把刚跳到的窗口又推走）。
      restoredScrollRef.current = true
      resetScrollTo(0, day)
    } catch (e) {
      // 离线时跳不了（锚定查询要问服务器）：说清楚，并留在原视图，不静默失败
      setToast(e instanceof Error && e.message === 'offline-jump'
        ? '离线状态无法按日期跳转，请联网后重试'
        : '跳转失败，请检查网络后重试')
    } finally {
      setLoading(false)
    }
  }

  // 回到最新：重新以无游标取第一页，回到正常的「从新到旧」时间轴
  async function backToLatest() {
    setLoading(true)
    try {
      const first = await fetchPage(null, 'older')
      setItems(first.items)
      setCursorOlder(first.cursor)
      setHasOlder(first.serverCount === PAGE_SIZE)
      setAnchor(null)
      setHasNewer(false)
      setCursorNewer(null)
      restoredScrollRef.current = true
      resetScrollTo(0, null)
    } catch {
      setError('连接失败，请检查网络后重试')
    } finally {
      setLoading(false)
    }
  }

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
    /* 布局 = **固定标题栏 + 内部滚动区**（标题栏和底部 TabBar 一样待在滚动容器**之外**）。
       · 为什么固定标题栏：日期入口（跳转 / 回到最新）必须随手可用，否则滑到列表深处
         就得先滚回顶部才能跳转——这正是「找不到某天」痛感的一半。
         TabBar 用的也是这套「流内 + 不参与滚动」，改法一致，不引入 position:fixed。
       · 刻意**不**固定热力图与统计行（约 116px）：固定后列表永远少 20% 可视高度，
         而它们是「偶尔扫一眼」的内容，不该每次进列表都收房租。 */
    <main className="mx-auto flex h-full w-full max-w-md flex-col">
      <header className="page-header relative flex shrink-0 items-center justify-between px-5 py-3 safe-pt">
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">全部日记</h1>
        {/* 日期入口与锚定状态合并成**一个胶囊**（不再单独占一行）：
            未锚定显示「按日期」，锚定后显示「9月2日 ✕」——✕ 即回到最新。
            状态内联进胶囊 = 零新增行、零布局弹跳，且「回到最新」永远在手边。
            篇数不在这里重复显示：组头已经有「9月2日 · N 篇 · M 字」。 */}
        <div className="-ml-1 flex max-w-[52%] items-center rounded-full border border-neutral-200 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          <button
            onClick={() => setPickerOpen(true)}
            aria-label="按日期查找日记"
            className="flex min-w-0 items-center gap-1 py-1 pl-3 pr-2 active:opacity-60"
          >
            <span className="truncate">{anchor ? jumpDayLabel(anchor) : '按日期'}</span>
            <span aria-hidden className="text-[10px]">▾</span>
          </button>
          {anchor && (
            <button
              onClick={() => void backToLatest()}
              aria-label="回到最新"
              title="回到最新"
              className="-ml-1 shrink-0 py-1 pl-1 pr-2.5 text-[11px] active:opacity-60"
            >
              ✕
            </button>
          )}
        </div>
        {/* 搜索：点击后弹出全屏搜索层（正文加密，检索只能在客户端解密后完成） */}
        <button onClick={() => setSearchOpen(true)} aria-label="搜索日记" className="-mr-1 px-1 text-neutral-500 dark:text-neutral-400 active:opacity-60">
          <SearchIcon />
        </button>
      </header>

      {/* ★ 滚动容器。与滚动相关的一切（位置保存/恢复、两个 observer 的 root）都绑在它上面 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5">
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
            {/* 写作频率热力图（仅在有日记时显示；偏好 qo-show-heatmap 可关，默认开）。
                这里**不再**挂「按日期查找」入口（2026-10-02 收敛为单一入口）：热力图受偏好控制，
                关掉它入口就没了，不能当唯一入口；且它只覆盖 26 周，摆在那儿会误导。
                热力图本身也不做逐格点击：格子只有 10px，触区远小于可点标准。 */}
            {showHeatmap && stats.count > 0 && <ContributionHeatmap byDay={stats.byDay ?? {}} />}
          </>
        )}
        <div className="flex flex-col gap-6 pb-4">
          {/* 顶部哨兵 + 向上加载状态：只在锚定态渲染（未锚定时窗口顶部就是全库最新） */}
          {anchor && (
            <div className="pt-2">
              <div ref={setNewerSentinelEl} aria-hidden className="h-1" />
              {loadingNewer && <p className="py-1 text-center text-xs text-neutral-500 dark:text-neutral-400">加载中…</p>}
            </div>
          )}
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
            <p className="pt-20 text-center text-sm text-neutral-500 dark:text-neutral-400">
              {anchor ? '这一天没有日记' : '还没有日记'}
            </p>
          )}
          {/* 触底哨兵 + 加载状态。原先这里是「加载更多」按钮——它把浏览变成了一次操作，
              每翻一页都要用户抬手。现在由 IntersectionObserver 自动取下一页；
              分页改游标后「翻页期间新增日记」也不再导致重复/漏条目。 */}
          {items.length > 0 && (
            <div className="pt-2">
              {hasOlder ? (
                <>
                  <div ref={setOlderSentinelEl} aria-hidden className="h-1" />
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
      {pickerOpen && (
        <DatePickerDialog
          byDay={stats?.byDay ?? {}}
          selected={anchor}
          onSelect={(day) => void doJump(day)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </main>
  )
}
