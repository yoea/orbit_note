'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { getDek } from '@/lib/client/session'
import { decryptText } from '@/lib/client/crypto/encryption'
import { useUserName } from '@/lib/client/use-user-name'
import SearchDialog from './SearchDialog'
import SearchIcon from './SearchIcon'
import ContributionHeatmap from './ContributionHeatmap'

const PAGE_SIZE = 10

interface Entry {
  id: string
  ciphertext: string
  iv: string
  createdAt: string
  latitude: number | null
  locationName: string | null
}

interface DecryptedItem {
  id: string
  createdAt: Date
  title: string // 首行非空行（加粗标题）
  preview: string // 去除标题行后的剩余正文
  wordCount: number // 解密时计算（trim 后长度，与详情页/编辑器口径一致）
  lat: number | null
  locationName: string | null
}

interface Group {
  key: string // yyyy-mm-dd（本地时区）
  label: string // 今天 / 昨天 / 2026年8月25日 · 星期二
  items: { id: string; time: string; title: string; preview: string; wordCount: number; lat: number | null; locationName: string | null }[]
  // 组头统计（服务端全量聚合——分页只加载了部分，不能从已加载条目统计）
  statCount: number
  statWords: number
}

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
  const [items, setItems] = useState<DecryptedItem[]>([])
  const [stats, setStats] = useState<{ count: number; days: number; byDay: Record<string, { count: number; words: number }> } | null>(null)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  // 请求一页（offset 起 10 条）并解密
  const fetchPage = useCallback(async (pageOffset: number): Promise<DecryptedItem[]> => {
    const dek = getDek()
    if (!dek) return []
    const res = await fetch(`/api/diary?limit=${PAGE_SIZE}&offset=${pageOffset}`)
    if (!res.ok) throw new Error('加载失败')
    const { entries } = await res.json() as { entries: Entry[] }
    const decrypted: DecryptedItem[] = []
    for (const e of entries) {
      try {
        const plain = await decryptText(dek, e.ciphertext, e.iv)
        // 标题 = 首行非空行；预览 = 其后剩余正文（列表两行截断）
        const lines = plain.split('\n')
        const titleIdx = lines.findIndex((l) => l.trim() !== '')
        const title = titleIdx >= 0 ? lines[titleIdx].trim() : ''
        const preview = titleIdx >= 0 ? lines.slice(titleIdx + 1).join('\n').trim() : ''
        decrypted.push({
          id: e.id,
          createdAt: new Date(e.createdAt),
          title,
          preview,
          wordCount: plain.trim().length,
          lat: e.latitude,
          locationName: e.locationName,
        })
      } catch {
        // 单条解密失败跳过（数据损坏不阻塞列表）
      }
    }
    return decrypted
  }, [])

  // 初始加载：统计 + 第一页（有滚动恢复状态时循环加载到上次的深度）
  useEffect(() => {
    void (async () => {
      try {
        const restore = readScrollState()
        const [statsRes, firstPage] = await Promise.all([
          fetch('/api/diary/stats').then((r) => (r.ok ? r.json() : null)),
          fetchPage(0),
        ])
        let loaded = firstPage
        if (restore && restore.count > firstPage.length) {
          // 继续加载直到覆盖上次浏览深度（分页循环）
          while (loaded.length < restore.count) {
            const more = await fetchPage(loaded.length)
            if (more.length === 0) break
            loaded = loaded.concat(more)
          }
        }
        if (statsRes) setStats(statsRes)
        setItems(loaded)
        setOffset(loaded.length)
        setHasMore(loaded.length % PAGE_SIZE === 0 && loaded.length > 0)
      } catch {
        setError('连接失败，请检查网络后重试')
      }
    })()
  }, [fetchPage])

  // 加载更多（点击按钮）
  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const page = await fetchPage(offset)
      setItems((prev) => [...prev, ...page])
      setOffset((o) => o + PAGE_SIZE)
      setHasMore(page.length === PAGE_SIZE)
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
      // 服务端全量统计（当天所有条目，不受分页影响）；stats 未加载时退回已加载统计
      const dayStat = stats?.byDay?.[key]
      return {
        key,
        label: dayLabel(key),
        statCount: dayStat?.count ?? list.length,
        statWords: dayStat?.words ?? list.reduce((s, i) => s + i.wordCount, 0),
        items: list.map((i) => ({
          id: i.id,
          time: i.createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
          title: i.title,
          preview: i.preview,
          wordCount: i.wordCount,
          lat: i.lat,
          locationName: i.locationName,
        })),
      }
    })
  })()

  if (error) {
    return (
      <main className="mx-auto flex h-full w-full max-w-md items-center justify-center px-5 safe-pt">
        <div className="text-center">
          <p className="text-sm text-neutral-500">{error}</p>
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
    <main ref={scrollRef} className="animate-fade-in mx-auto h-full w-full max-w-md overflow-y-auto px-5 safe-pt">
      {/* 电脑版与主页同宽（手机视图宽度），不随屏幕拉伸 */}
      {/* viewTransitionName：页面切换动画中页头保持固定（空间锚点） */}
      {/* 本页是 tab 目的地之一，不再放返回箭头（回首页由 TabBar 的「写」承担）；
          标题用绝对定位居中，右侧保留搜索入口，故用 justify-end */}
      <header className="page-header relative flex items-center justify-end py-3">
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">全部日记</h1>
        {/* 搜索：点击后弹出全屏搜索层（正文加密，检索只能在客户端解密后完成） */}
        <button onClick={() => setSearchOpen(true)} aria-label="搜索日记" className="-mr-1 px-1 text-neutral-400 active:opacity-60">
          <SearchIcon />
        </button>
      </header>
      {stats && (
        <>
          <div className="flex items-baseline justify-between gap-2 pb-2 text-xs tabular-nums text-neutral-400">
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
      <div className="flex flex-col gap-6 pb-10">
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
                      <span className="shrink-0 text-xs tabular-nums text-neutral-400">{item.time}</span>
                      {/* 标题 = 首行加粗 */}
                      <span className="line-clamp-1 font-medium text-neutral-800 dark:text-neutral-200">{item.title}</span>
                    </span>
                    {/* 剩余正文预览（单行截断；标题已单行截断） */}
                    {item.preview && (
                      <span className="line-clamp-1 whitespace-pre-wrap text-sm text-neutral-500 dark:text-neutral-400">
                        {item.preview}
                      </span>
                    )}
                    {/* 元信息：定位图标 + 地点名（左），字数右对齐 */}
                    <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[10px] text-neutral-400">
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
        {items.length === 0 && <p className="pt-20 text-center text-sm text-neutral-400">还没有日记</p>}
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
              <p className="py-3 text-center text-xs text-neutral-400">已显示全部</p>
            )}
          </div>
        )}
      </div>
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </main>
  )
}
