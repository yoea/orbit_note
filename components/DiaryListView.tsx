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
import DatePickerDialog from './DatePickerDialog'
import StarIcon from './StarIcon'
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
 * 分页游标（服务端 `before` / `beforeId` 一对）：指向「已经取过的最旧一条」，
 * 下一次请求取严格更旧的条目。用 (createdAt, id) 而不是单一时间戳，是因为
 * 同一秒可能有多条（Day One 导入是秒级精度），只按时间比会整批跳过。
 *
 * beforeId 可为 null：按日期跳转时只知道「目标日 23:59:59.999」这个时间边界，
 * 没有对应的条目 id（那天最后一条可能是任意一条）。服务端据此只按时间比较。
 */
interface Cursor {
  before: string
  beforeId: string | null
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
// 唯一的"陈旧窗口"是「刚保存完一篇就切到列表」：新条目要等这次后台重取回来才出现，
// 也就是一个请求往返（此时列表是**有内容的**，不会白屏）；代价远小于每次进来都空一下。
//
// anchor：当前是否锚定在某个日期（null = 「最新」的正常时间轴）。它属于**视图状态**，
// 和 items 一起进快照——否则切个 tab 回来，锚定视图会莫名其妙回到最新，用户得重新跳一次。
let snapshot: { items: DecryptedItem[]; stats: Stats | null; cursor: Cursor | null; hasMore: boolean; anchor: DayKey | null } | null = null

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
  const [hasMore, setHasMore] = useState(() => snapshot?.hasMore ?? true)
  // 待取游标（null = 还没取过，即从最新开始）
  const [cursor, setCursor] = useState<Cursor | null>(() => snapshot?.cursor ?? null)
  // 锚定的日期（null = 不锚定，从最新往下）。见 doJump / backToLatest
  const [anchor, setAnchor] = useState<DayKey | null>(() => snapshot?.anchor ?? null)
  const [loadingMore, setLoadingMore] = useState(false)
  // 热力图显示开关（偏好 qo-show-heatmap，默认开）：渲染条件，惰性初值同步读即可
  const [showHeatmap] = useState(() => isHeatmapEnabled())
  // 首次进入（无快照可渲染）时列表本来就是空的——那不是「没有日记」，是数据还在路上。
  // 原先没有这个标志，于是会先闪一行「还没有日记」再被真实列表顶掉。
  const [loading, setLoading] = useState(() => snapshot == null)
  const [error, setError] = useState<string | null>(null)
  // 一次性提示（如「离线时无法按日期跳转」）：不整页替换、不弹窗，就在列表上方一行说明。
  // 与 error 的区别：error 是「这一页拿不到数据」，notice 是「刚才那个操作没成功，别的都还好」。
  const [notice, setNotice] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  // 挂载时的既有深度：重取时至少要补齐到这里，否则后台刷新一回来列表会「缩水」、
  // 滚动位置跟着跳（快照深度可能大于 sessionStorage 里记的上次浏览深度）。
  const seededDepthRef = useRef(snapshot ? snapshot.items.length : 0)
  const userName = useUserName()
  const [searchOpen, setSearchOpen] = useState(false)
  // 滚动位置保持：sessionStorage 存 { y: 滚动值, count: 已加载条数, anchor: 锚定日期 }
  // ——返回时先加载到足够深度再恢复滚动（否则内容高度不足被钳制）。
  // anchor 必须一起存：从详情页返回时，锚定视图要回到同一天，而不是回到「最新」。
  const SCROLL_KEY = 'qo-diary-scroll'
  const restoredScrollRef = useRef(false)
  const itemsRef = useRef<DecryptedItem[]>([])
  // 滚动容器（本页是容器滚动，见下方 main 的注释）
  const scrollRef = useRef<HTMLElement | null>(null)
  // 触底哨兵 + 取数用的 ref：游标/开关放进 ref，加载函数才能保持稳定引用，
  // IntersectionObserver 也就不用每次翻页都重建。
  const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null)
  const cursorRef = useRef<Cursor | null>(cursor)
  const hasMoreRef = useRef(hasMore)
  const anchorRef = useRef<DayKey | null>(anchor)
  const fetchingRef = useRef(false)

  // 同步给 ref：itemsRef 只被「滚动保存」回调异步读取，因此在 effect 里赋值。
  // 不要写回渲染期赋值（itemsRef.current = items）——渲染期写 ref 会在并发渲染下读到
  // 尚未提交的值，也是 react-hooks/refs 明确禁止的。
  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => { cursorRef.current = cursor }, [cursor])
  useEffect(() => { hasMoreRef.current = hasMore }, [hasMore])
  useEffect(() => { anchorRef.current = anchor }, [anchor])

  // 快照回写：状态一变就覆盖（组件随后被卸载也无妨——模块级变量本就该继续持有最后的内容）。
  // 卸载时不需要清理：下一次挂载要的就是这份「上次离开时的样子」。
  useEffect(() => { snapshot = { items, stats, cursor, hasMore, anchor } }, [items, stats, cursor, hasMore, anchor])

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

  // 保存滚动位置：滚动防抖写入 sessionStorage；页面隐藏/卸载时兜底保存
  // （监听对象是容器元素而非 window——本页已改为容器滚动）
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

  // 取一页（游标：null = 从最新开始，否则从该游标往下取更旧的）并解密。
  // 两端数据源保持一致：在线 = 服务器真值 ∪ 未同步队列（首页），离线 = 缓存 ∪ 未同步队列。
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
      ? `&before=${encodeURIComponent(from.before)}${from.beforeId ? `&beforeId=${encodeURIComponent(from.beforeId)}` : ''}`
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
      // ★ isFirstPage 只在「真的从服务器最新一条开始」时为 true（即没带游标）。
      // 锚定页**不是**首页：它的窗口在时间轴中段，若误传 true，staleCachedIds 会把所有
      // 「比本页更新」的缓存条目判成「服务器已删除」而清掉——锚定一次就把近期缓存洗了。
      await pruneCachedEntries(server, { isFirstPage: from === null, isLastPage: server.length < PAGE_SIZE })
      // 未同步 = 队列里有、且服务器本页没有。服务器本页已有 ⇒ 冲刷已完成，
      // 不该再打「未同步」（徽标取自这次请求的实时状态，不依赖队列事件的时序）
      const serverIds = new Set(server.map((e) => e.id))
      pendingIds = new Set(queued.filter((q) => !serverIds.has(q.id)).map((q) => q.id))
      // 未同步队列只并进**最新那一段**（无游标的第一页）：它们的时间戳都是「现在」，
      // 锚定到历史窗口时既不属于那个窗口，也会干扰「最后一条即最旧一条」的游标计算。
      entries = from === null ? unionWithPending(server, queued) : server
      const last = server[server.length - 1]
      nextCursor = last ? { before: last.createdAt, beforeId: last.id } : null
    } else {
      // 网络不可达：回退本地缓存（getCachedEntries 已按 createdAt 倒序）+ 队列（未同步，新→旧），
      // 合并后按创建时间倒序。**离线也要能翻页**——原先靠 offset 切片，现在按游标在
      // 合并数组里定位：优先按 id 命中（这条必然在缓存里，因为「列表里看得见 ⇒ 本地已有密文」），
      // 命中不了再退回时间比较（缓存被清理过等边缘情况）。
      const cached = await getCachedEntries()
      const union = unionWithPending(cached, queued)
      let startIdx = 0
      if (from) {
        const byId = from.beforeId ? union.findIndex((e) => e.id === from.beforeId) : -1
        if (byId >= 0) startIdx = byId + 1
        else {
          const byTime = union.findIndex((e) => e.createdAt < from.before)
          startIdx = byTime >= 0 ? byTime : union.length
        }
        // 按日期跳转要求「本地确实有那一天」：缓存是稀疏的（只含浏览过的页），
        // 找不到必须说清楚「离线跳不了」，**绝不能**显示成「这一天没有日记」——那是在撒谎。
        const targetDay = dayKeyOf(new Date(from.before))
        if (!union.some((e) => dayKeyOf(new Date(e.createdAt)) === targetDay)) throw new Error('offline-jump')
      }
      const slice = union.slice(startIdx, startIdx + PAGE_SIZE)
      entries = slice
      serverCount = slice.length
      if (!slice.length) {
        // 第一页就为空才算「真的没有」；后续页取空只表示「本地到此为止」
        if (from === null) throw new Error('加载失败')
        return { items: [], serverCount: 0, cursor: null }
      }
      pendingIds = new Set(queued.map((q) => q.id))
      const last = slice[slice.length - 1]
      nextCursor = startIdx + slice.length < union.length ? { before: last.createdAt, beforeId: last.id } : null
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

  // 初始加载：统计 + 第一页（有锚定状态 / 滚动恢复状态 / 会话快照时循环加载到对应深度）
  // 统计离线兜底：请求失败（.catch → null）时回退缓存值。
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
          fetchPage(anchorEnd ? { before: anchorEnd, beforeId: null } : null).catch(() => null),
        ])
        const stats = statsRes ?? (await getCachedStats())
        if (statsRes) void cacheStats(statsRes)
        if (stats) setStats(stats)
        // 锚定状态离线恢复不了（本地没缓存那一天）：**退回最新并说明**，
        // 而不是把整页替换成错误提示——用户只是离线，列表本身还是该能看的。
        let first = firstTry
        let anchorApplied = startAnchor
        if (!first && anchorEnd) {
          first = await fetchPage(null).catch(() => null)
          anchorApplied = null
          if (first) setNotice('离线状态无法显示上次定位的日期，已回到最新')
        }
        if (!first) { setError('连接失败，请检查网络后重试'); return }
        if (anchorApplied) setAnchor(anchorApplied)
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
    } catch (e) {
      // 触底失败不整页报错（用户可能只是网络抖动）：停掉自动加载并给一行提示，
      // 用户下滑还有机会重试。整页替换会把已经看过的内容全丢掉，代价太大。
      if (e instanceof Error && e.message === 'offline-jump') setNotice('离线状态无法继续加载更早的日记')
      else setNotice('加载失败，请检查网络')
      setHasMore(false)
    } finally {
      fetchingRef.current = false
      setLoadingMore(false)
    }
  }, [fetchPage])

  // 触底自动加载：root 必须是**本页的滚动容器**（main 自身 overflow-y-auto），
  // 不能用默认 viewport——本页不是 window 滚动（原因见下方 main 的注释），
  // 用默认 root 会永远不触发，表现为「滑到底什么都不会发生」。
  // rootMargin 提前 400px 预取，避免用户真的看到「到底了才转圈」。
  useEffect(() => {
    const root = scrollRef.current
    if (!sentinelEl || !root || !hasMore) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadOlder()
    }, { root, rootMargin: '400px 0px' })
    io.observe(sentinelEl)
    return () => io.disconnect()
  }, [sentinelEl, hasMore, loadOlder])

  // 跳到某一天：清空当前列表、以「该日 23:59:59.999」为游标重取第一页。
  // 这是**重新锚定**而不是滚动——列表现有 10 条/页，靠加载滑到一年前要几十次请求。
  async function doJump(day: DayKey) {
    const end = dayEndIso(day)
    if (!end) return
    setLoading(true)
    setNotice(null)
    try {
      const first = await fetchPage({ before: end, beforeId: null })
      setItems(first.items)
      setCursor(first.cursor)
      setHasMore(first.serverCount === PAGE_SIZE)
      setAnchor(day)
      // 跳转是「换了个位置看」，不是「接着上次看」：滚动到顶部，并让滚动恢复逻辑
      // 放过这一次（否则旧的 y 会把刚跳到的窗口又推走）。
      restoredScrollRef.current = true
      if (scrollRef.current) scrollRef.current.scrollTop = 0
      try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ y: 0, count: first.items.length, anchor: day })) } catch { /* 忽略 */ }
    } catch (e) {
      // 离线时跳不了（锚定查询要问服务器）：说清楚，并留在原视图，不要静默失败
      setNotice(e instanceof Error && e.message === 'offline-jump'
        ? '离线状态无法按日期跳转，请联网后重试'
        : '跳转失败，请检查网络后重试')
    } finally {
      setLoading(false)
    }
  }

  // 回到最新：重新以无游标取第一页，回到正常的「从新到旧」时间轴
  async function backToLatest() {
    setLoading(true)
    setNotice(null)
    try {
      const first = await fetchPage(null)
      setItems(first.items)
      setCursor(first.cursor)
      setHasMore(first.serverCount === PAGE_SIZE)
      setAnchor(null)
      restoredScrollRef.current = true
      if (scrollRef.current) scrollRef.current.scrollTop = 0
      try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ y: 0, count: first.items.length, anchor: null })) } catch { /* 忽略 */ }
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
    /* 容器滚动（main 自身 overflow-y-auto，高度 = 可用高度）：底部 TabBar 是流内元素，
       若继续用 window 滚动，列表内容会把 TabBar 挤到文档末尾——必须滚动到底才能看到它。
       代价：失去 iOS「点状态栏回到顶部」的原生行为（那作用于 window 滚动），
       换来与其余页面（/settings、/entry、/settings/*）一致的滚动模型。

       ★ 触底自动加载（IntersectionObserver）的 root 就是这个 main —— 换了滚动模型
         必须同步改那里，否则「滑到底」什么都不会发生（见上面的注释）。 */
    <main ref={scrollRef} className="mx-auto h-full w-full max-w-md overflow-y-auto px-5 safe-pt">
      {/* 电脑版与主页同宽（手机视图宽度），不随屏幕拉伸 */}
      {/* viewTransitionName：页面切换动画中页头保持固定（空间锚点） */}
      {/* 本页是 tab 目的地之一，不再放返回箭头（回首页由 TabBar 的「写」承担）；
          标题用绝对定位居中，两侧分别是日期入口与搜索入口 */}
      <header className="page-header relative flex items-center justify-between py-3">
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">全部日记</h1>
        {/* 日期入口：显示当前范围（全部 / 9月2日），点开月历直接跳转 */}
        <button
          onClick={() => setPickerOpen(true)}
          aria-label="按日期查找日记"
          className="-ml-1 flex max-w-[45%] items-center gap-1 rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-500 active:opacity-60 dark:border-neutral-700 dark:text-neutral-400"
        >
          <span className="truncate">{anchor ? jumpDayLabel(anchor) : '按日期'}</span>
          <span aria-hidden className="text-[10px]">▾</span>
        </button>
        {/* 搜索：点击后弹出全屏搜索层（正文加密，检索只能在客户端解密后完成） */}
        <button onClick={() => setSearchOpen(true)} aria-label="搜索日记" className="-mr-1 px-1 text-neutral-500 dark:text-neutral-400 active:opacity-60">
          <SearchIcon />
        </button>
      </header>
      {/* 锚定条：明确告诉用户「现在看的不是最新」，并给一条回到最新的路。
          不用浮动层——本页已有搜索弹层与日期弹层，再来一个浮动元素会打架。 */}
      {anchor && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-neutral-100 px-3 py-2 text-xs dark:bg-neutral-800">
          <span className="min-w-0 truncate text-neutral-600 dark:text-neutral-300">
            已定位到 {jumpDayLabel(anchor)}
            {stats?.byDay?.[anchor] ? ` · ${stats.byDay[anchor].count} 篇` : ''}
          </span>
          <button onClick={() => void backToLatest()} className="shrink-0 font-medium text-neutral-500 active:opacity-60 dark:text-neutral-400">
            回到最新
          </button>
        </div>
      )}
      {notice && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
          <span className="min-w-0">{notice}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 font-medium active:opacity-60">知道了</button>
        </div>
      )}
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
              热力图本身不做逐格点击：格子只有 10px，触区远小于可点标准，
              点错的概率比点对还高——它的下方给一个「按日期查找」入口代替。 */}
          {showHeatmap && stats.count > 0 && (
            <ContributionHeatmap byDay={stats.byDay ?? {}} onOpenPicker={() => setPickerOpen(true)} />
          )}
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
            且每翻一页都要用户抬手。现在由 IntersectionObserver 自动取下一页；
            用按钮的时代分页是 offset（服务器位置），改成游标后「翻页期间新增日记」
            不再导致重复/漏条目（见 app/api/diary/route.ts 的 before 注释）。 */}
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
