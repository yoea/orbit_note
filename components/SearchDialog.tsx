'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import SearchIcon from './SearchIcon'
import { getDek } from '@/lib/client/session'
import { decryptEntries, fetchAllEntries } from '@/lib/client/entries'
import { weatherEmoji } from '@/lib/client/weather'
import {
  buildSnippet,
  dayRangeKey,
  firstLine,
  highlightSegments,
  isDefaultFilters,
  isDayRange,
  locationFacets,
  matches,
  relevanceScore,
  timeRangeLabel,
  type TimeRange,
} from '@/lib/client/search'
import type { DecryptedEntry } from '@/lib/client/entries'
import { displayLocationName } from '@/lib/client/location'
import { toPlainText } from '@/lib/client/markdown'
import { dayKeyOf, monthGrid, monthTitle, shiftMonth } from '@/lib/client/date-jump'

// 每次渲染的批量——结果多时先给一批，「加载更多」再递增。
// 上限的意义是避免上千条时一次性建 DOM，而不是「只显示这么多」。
const PAGE = 100

// 命中片段的高亮渲染。用 <mark> 分段渲染，**不使用 dangerouslySetInnerHTML**（项目铁律）。
function Highlighted({ text, query }: { text: string; query: string }) {
  const segments = highlightSegments(text, query)
  return (
    <>
      {segments.map((s, i) => s.hit
        ? <mark key={i} className="rounded-[2px] bg-amber-200/70 text-inherit dark:bg-amber-400/25">{s.text}</mark>
        : <span key={i}>{s.text}</span>)}
    </>
  )
}

// 展开小箭头：只给「点了会开面板」的两个按钮用（收藏是即时开关，不需要）。
function Caret() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

// 筛选按钮：三类筛选（时间 / 收藏 / 地点）共用这一个外观。
// children 一律包一层可截断的 span——地名可能很长，不能让按钮被撑破。
function Chip({ active, caret = false, onClick, children }: {
  active: boolean
  caret?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs transition-colors ${
        active
          ? 'bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 font-medium text-white'
          : 'bg-neutral-100 text-neutral-500 active:opacity-60 dark:bg-neutral-800 dark:text-neutral-400'
      }`}
    >
      <span className="min-w-0 truncate">{children}</span>
      {caret && <Caret />}
    </button>
  )
}

// 面板里的一行（时间档 / 月份 / 地点共用）。meta 是右侧的次要信息（篇数）。
function PanelRow({ label, meta, selected, onClick }: {
  label: string
  meta?: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left active:opacity-60">
        <span className="min-w-0 truncate text-sm text-neutral-700 dark:text-neutral-200">{label}</span>
        <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
          {meta}
          {selected && <span className="ml-2 text-emerald-600 dark:text-emerald-400">✓</span>}
        </span>
      </button>
    </li>
  )
}

// 面板里的小分组标题（「按月份」/「具体地点」）
function PanelGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-t border-neutral-100 px-3 pb-1 pt-2.5 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
      {children}
    </p>
  )
}

// 面板的空态/加载态提示（时间与地点面板共用一套文案口径）
function PanelHint({ error, loaded, empty }: { error: string | null; loaded: boolean; empty: string }) {
  return (
    <p className="px-3 py-2.5 text-xs text-neutral-500 dark:text-neutral-400">
      {error ? '日记加载失败' : loaded ? empty : '正在解密日记…'}
    </p>
  )
}

// 筛选项面板的容器（与设置页弹窗同一套做法）。
//
// scroll=false 用于**内容高度固定**的面板（时间面板）：里面只有一行「全部时间」+ 一张固定
// 6 行的日历，高度是确定的，再套 max-h/overflow 只会平白多出一条滚动条（用户在键盘弹起
// ——dvh 变矮——时看到的就是它）。地点面板行数不定，继续走滚动 + 细滚动条。
function Panel({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  return (
    <div
      className={`mb-3 rounded-xl border border-neutral-200 dark:border-neutral-800 ${
        scroll ? 'thin-scrollbar max-h-[45dvh] overflow-y-auto' : ''
      }`}
    >
      {children}
    </div>
  )
}

/**
 * 时间面板里的「具体日期」日历（2026-10-02 从列表页搬过来）。
 *
 * 为什么是**面板内的内联日历**而不是再弹一层月历：
 *   搜索面板本身已经是全屏浮层，再叠一层会有两层遮罩、返回路径也说不清；
 *   内联进时间面板后，「看 9月2日」与「看 9 月」在同一个面板里并列，语义连续。
 *
 * ★ 日历**恒定渲染**，只让底部那行状态文字变（2026-10-02 修「先闪一下才出日历」）：
 *   此前是「加载中 → 一行提示 → 解密完 → 换成整张日历」两段渲染，面板高度从一行文字
 *   跳到一整张日历，用户看到的就是闪一下 + 布局弹跳。状态行放在**固定高度**的槽位里
 *   （h-5），所以加载完成时高度一点不变。
 *
 * 只有**有日记的日子**可点（清单来自已解密条目，与地点清单同一条约定：不给「选了却零结果」
 * 的档位），未来日期不可点，解密完成前全部不可点。
 *
 * 格子用**固定高度 h-9** 而不是 aspect-square：后者高度随容器宽度变化（桌面 448px 宽时
 * 每格 ~50px，一整张日历能到 300px 高），固定高度既更紧凑又与屏宽无关，换月时高度恒定。
 */
type DayPickerStatus = 'loading' | 'error' | 'ready'

function DayPicker({ dayKeys, selected, status, onPick }: {
  dayKeys: Set<string>
  selected: TimeRange
  status: DayPickerStatus
  onPick: (range: TimeRange) => void
}) {
  const today = dayKeyOf(new Date())
  const [view, setView] = useState(() => {
    const sel = /^d:(\d{4})-(\d{2})-\d{2}$/.exec(selected)
    const base = sel ? new Date(Number(sel[1]), Number(sel[2]) - 1, 1) : new Date()
    return { year: base.getFullYear(), month: base.getMonth() + 1 }
  })
  const grid = monthGrid(view.year, view.month)
  const monthPrefix = `${view.year}-${String(view.month).padStart(2, '0')}`
  const monthHasRecord = [...dayKeys].some((k) => k.startsWith(monthPrefix))
  const atCurrentMonth = view.year === Number(today.slice(0, 4)) && view.month === Number(today.slice(5, 7))
  const canGoNext = !atCurrentMonth
  const go = (delta: number) => setView((v) => shiftMonth(v.year, v.month, delta))

  const ready = status === 'ready'
  // 状态行文案（空串也占位，保证高度恒定）
  const note =
    status === 'loading' ? '正在解密日记…'
      : status === 'error' ? '日记加载失败'
        : dayKeys.size === 0 ? '还没有日记'
          : !monthHasRecord ? '这个月没有记录'
            : ''

  return (
    <div className="px-3 pb-2 pt-1">
      <div className="flex items-center justify-between pb-1">
        <button onClick={() => go(-12)} aria-label="上一年" className="px-2 py-1 text-sm text-neutral-500 active:opacity-60 dark:text-neutral-400">«</button>
        <button onClick={() => go(-1)} aria-label="上个月" className="px-2 py-1 text-sm text-neutral-500 active:opacity-60 dark:text-neutral-400">‹</button>
        <span className="text-xs font-medium tabular-nums">{monthTitle(view.year, view.month)}</span>
        <button onClick={() => go(1)} disabled={!canGoNext} aria-label="下个月" className="px-2 py-1 text-sm text-neutral-500 active:opacity-60 disabled:opacity-30 dark:text-neutral-400">›</button>
        <button onClick={() => go(12)} disabled={!canGoNext} aria-label="下一年" className="px-2 py-1 text-sm text-neutral-500 active:opacity-60 disabled:opacity-30 dark:text-neutral-400">»</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-neutral-500 dark:text-neutral-400">
        {['一', '二', '三', '四', '五', '六', '日'].map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1 pt-1">
        {grid.flat().map((day, i) => {
          // 补位格也给固定高度：否则「整行都是补位」的月份（如 2 月恰好 4 行）会塌掉一行，
          // 换月时高度跳动。
          if (day === null) return <span key={`e${i}`} className="h-9" />
          const hasRecord = ready && dayKeys.has(day)
          const isFuture = day > today
          const disabled = !hasRecord || isFuture
          const isSelected = selected === dayRangeKey(day)
          return (
            <button
              key={day}
              onClick={() => onPick(dayRangeKey(day))}
              disabled={disabled}
              aria-label={hasRecord ? `${day} · 有日记` : day}
              aria-current={day === today ? 'date' : undefined}
              className={`h-9 rounded-md text-xs tabular-nums ${
                isSelected
                  ? 'bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 font-medium text-white'
                  /* 不可点：标准次级文字（WCAG AA 下限配对）。刻意不做成「灰到看不见」——
                     低对比度既过不了 footnote-contrast 守卫，也不是表达「不可点」的好办法。 */
                  : disabled
                    ? 'text-neutral-500 dark:text-neutral-400'
                    : 'bg-violet-50 font-medium text-neutral-800 active:bg-violet-100 dark:bg-violet-500/10 dark:text-neutral-200 dark:active:bg-violet-500/20'
              }`}
            >
              {Number(day.slice(8, 10))}
            </button>
          )
        })}
      </div>
      {/* 状态槽：**恒定高度**（h-5 = leading-5 的行高），没有文案时也占位 ⇒ 加载完成不跳版 */}
      <p className="h-5 pt-0.5 text-center text-[11px] leading-5 text-neutral-500 dark:text-neutral-400">{note}</p>
    </div>
  )
}

const PANEL_UL = 'flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800'

// 同一时刻只允许开一个面板——两个面板同时展开会把结果区挤掉一大半。
type FilterPanel = 'time' | 'location'

// 搜索弹窗（/diary 右上角放大镜打开）。
//
// 正文是端到端加密的 ⇒ 服务端无法检索，只能把密文一次性拉到内存、解密后本地匹配。
// 因此：**首次输入时才拉取解密**（不是打开弹窗就做，也不是每敲一个字都做），
// 之后所有筛选与关键词匹配都在内存里完成，输入即出结果。
// 解密后的明文只存在本组件 state 中，关闭弹窗即释放——不写 IndexedDB / localStorage。
export default function SearchDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [range, setRange] = useState<TimeRange>('all')
  // 地点这一类只有两档（2026-10-02 用户要求）：无位置 / 具体地点。两者互斥；再点一次即取消。
  const [noLocation, setNoLocation] = useState(false)
  // 收藏筛选：只看收藏（收藏是「收窄」语义，不需要「只看未收藏」这一半）
  const [onlyStarred, setOnlyStarred] = useState(false)
  // 地名筛选：值为 displayLocationName 的原值（null = 不限）；取自实际数据，见 facets
  const [location, setLocation] = useState<string | null>(null)
  // 当前展开的筛选项面板（时间 / 地点；收藏是即时开关、没有面板）。null = 都收起
  const [openPanel, setOpenPanel] = useState<FilterPanel | null>(null)
  // null = 尚未加载（还没搜过）；加载完成后持有全部已解密条目
  const [entries, setEntries] = useState<DecryptedEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 当前渲染到第几条（分批递增，避免上千条时一次性建 DOM）
  const [visibleCount, setVisibleCount] = useState(PAGE)
  const inputRef = useRef<HTMLInputElement>(null)

  // 打开即聚焦，省一次点击
  useEffect(() => { inputRef.current?.focus() }, [])

  // 按需加载：由输入/筛选的事件处理器触发，而不是 effect——
  // effect 里同步 setState 属于级联渲染（react-hooks/set-state-in-effect）。
  function ensureLoaded() {
    if (entries !== null || loading) return
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const dek = getDek()
        if (!dek) throw new Error('未解锁')
        const decrypted = await decryptEntries(dek, await fetchAllEntries())
        // 搜索只吃**纯文本派生**：直接拿 Markdown 源码匹配，用户搜「粗体」会命中所有 `**加粗**`，
        // 摘要里也会露出 # 与星号。这里一次性派生好并保持 DecryptedEntry 的形状，
        // 于是 lib/client/search.ts 的纯文本契约完全不用动（它的 28 个单测也不用改）。
        setEntries(decrypted.map((d) => ({ entry: d.entry, plain: toPlainText(d.plain) })))
      } catch {
        setError('搜索失败，请重试')
      } finally {
        setLoading(false)
      }
    })()
  }

  // 筛选条件变化后：把已显示条数收回初始值（否则换关键词后仍停在上次展开的深度），
  // 并触发按需加载（首次变更时才真正拉取解密）。
  function resetPaging() {
    setVisibleCount(PAGE)
    ensureLoaded()
  }

  // ★ 打开筛选面板**必须**同时触发惰性解密加载。
  //
  // 为什么单拎成一个函数（2026-09-30 修真实 bug）：面板里的「月份清单」和「地点清单」
  // 都是从**已解密条目**现取的。此前打开面板只 `setOpenPanel(true)`、不加载，于是
  // 「进搜索 → 直接点地点」看到的是空面板（「还没有记录过地点」），用户结论是
  // **按地点筛选不显示结果**——其实纯逻辑（tests/search.test.ts 的 C2/C3）全是对的，
  // 坏在拿不到清单、根本选不出地点。所有面板开关都走这里，别再各自 setState。
  // 守卫 tests/search-filters-ui.test.ts 断言 `setOpenPanel` 全仓只出现在本函数里。
  function openFilterPanel(panel: FilterPanel) {
    // 收起软键盘（2026-10-02）：搜索页进入即自动聚焦，键盘会一直占掉约一半屏高，
    // 而 dvh 会随键盘实时变小 —— 面板的 max-h 随之缩水，日历就挤出了滚动条。
    // 面板打开时键盘本来也用不上（下一步是点日期），先让开空间。
    inputRef.current?.blur()
    setOpenPanel((cur) => (cur === panel ? null : panel))
    ensureLoaded()
  }

  // 选完即收起面板（与地点面板原有的交互一致），选中值回显在按钮上
  function pickRange(r: TimeRange) {
    setRange(r)
    setOpenPanel(null)
    resetPaging()
  }

  // 收藏是即时开关：不展开面板，点一下就切
  function toggleStarred() {
    setOnlyStarred((v) => !v)
    resetPaging()
  }

  // 地点两档互斥：无位置 / 具体地点。**再点一次已选中的那一项即取消**——
  // 原来的「全部地点」那一行已被用户要求删除，取消只能靠这个手势或「重置」。
  function toggleNoLocation() {
    setNoLocation((v) => !v)
    setLocation(null)
    setOpenPanel(null)
    resetPaging()
  }
  function pickLocation(name: string) {
    setLocation((cur) => (cur === name ? null : name))
    setNoLocation(false)
    setOpenPanel(null)
    resetPaging()
  }

  // 重置筛选（**不含**关键词——关键词由输入框自己的 ✕ 清除，两个入口各管一摊）
  function resetFilters() {
    setRange('all')
    setOnlyStarred(false)
    setNoLocation(false)
    setLocation(null)
    setOpenPanel(null)
    resetPaging()
  }

  const filters = { query, range, noLocation, onlyStarred, location }
  const active = !isDefaultFilters(filters)
  // 是否有任何**筛选**（不含关键词）非默认——决定「重置」按钮出不出来
  const filtersActive = range !== 'all' || onlyStarred || noLocation || location !== null

  // 地名清单：从**全部已解密条目**里现取（服务端只有密文与元数据，但地名就是元数据，
  // 客户端取不到别的来源）。清单里不会出现空地名，所以不会给出选了却零结果的可选项。
  const facets = useMemo(() => locationFacets((entries ?? []).map((e) => e.entry)), [entries])
  // 月份清单同理：只列真的有日记的月份（新的在前），不会给出空档
  // 有日记的日期集合（日历据此把没写过的日子置灰）——同样从已解密条目现取
  const dayKeys = useMemo(() => new Set((entries ?? []).map((e) => dayKeyOf(new Date(e.entry.createdAt)))), [entries])

  const results = useMemo(() => {
    if (!entries) return []
    const matched = entries.filter((e) => matches(e.entry, e.plain, filters))
    const q = query.trim()
    // 没有关键词时（纯筛选 = 在浏览）保持服务端的时间倒序——这才是符合直觉的顺序，
    // 相关性在无关键词时没有意义。
    if (q === '') return matched
    // 有关键词时按相关度排：纯时间倒序会让最相关的一篇沉底
    // （搜「咖啡」，通篇讲咖啡的那篇如果写得早，就排在第 79 位）。
    // 同分回落到原顺序（服务端已是时间倒序）——用下标而非重新比较日期，省一次 Date 解析。
    return matched
      .map((e, i) => ({ e, i, score: relevanceScore(e.entry, e.plain, q) }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.e)
  }, [entries, query, range, noLocation, onlyStarred, location]) // eslint-disable-line react-hooks/exhaustive-deps -- filters 每次渲染新建对象，按字段依赖更准确

  const visible = results.slice(0, visibleCount)
  const trimmedQuery = query.trim()

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-neutral-950">
      <div className="mx-auto w-full max-w-md shrink-0 px-5 safe-pt">
        <div className="flex items-center gap-3 py-3">
          {/* 输入框：复用应用既有的圆角浅底样式 */}
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-neutral-100 px-3 py-2.5 dark:bg-neutral-900">
            <span className="shrink-0 text-neutral-500 dark:text-neutral-400"><SearchIcon className="h-4 w-4" /></span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); resetPaging() }}
              placeholder="搜索日记内容"
              type="text"
              /* ★ autoComplete="off"（2026-10-02 用户反馈「会触发联系人填充」）：
                 iOS 键盘上方的「自动填充联系人」条是系统按输入框的 autocomplete 语义弹出的，
                 不给 autocomplete 时它会猜（无 name 的纯文本输入框常常被当成「姓名」）。
                 明确 off，并声明 inputMode/enterKeyHint 都是 search ⇒ 系统不再给联系人候选。
                 autoComplete 之外的三个属性是既有的防误纠错设置，别去掉。 */
              autoComplete="off"
              inputMode="search"
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-neutral-500 dark:placeholder:text-neutral-400"
            />
            {query !== '' && (
              <button onClick={() => { setQuery(''); resetPaging() }} aria-label="清除" className="shrink-0 text-sm text-neutral-500 dark:text-neutral-400 active:opacity-60">✕</button>
            )}
          </div>
          <button onClick={onClose} className="shrink-0 text-sm text-neutral-500 dark:text-neutral-400 active:opacity-60">取消</button>
        </div>
        {/* 筛选归为**三类**（时间 / 收藏 / 地点），与关键词同样是「与」的关系；
            全部是明文元数据，每一项都只**收窄**结果集 ⇒ 任意组合恒为交集（见 lib/client/search.ts）。
            · 时间：按钮上直接显示当前档位（默认「全部时间」），点开面板选**具体日期**（日历上只有写过日记的日子可点）；
            · 收藏：布尔开关，点了就切，没有面板可开；文字恒定，只有颜色变（选中＝主题色）；
            · 地点：「无位置」与「具体地点」是同一类里的两档，因此都收在地点面板内，
              不再单独占一个 chip（这就是从 7 个 chip 收敛成 3 个控件的原因）。 */}
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <Chip active={range !== 'all'} caret onClick={() => openFilterPanel('time')}>
            {timeRangeLabel(range)}
          </Chip>
          <Chip active={location !== null || noLocation} caret onClick={() => openFilterPanel('location')}>
            {location ?? (noLocation ? '无位置' : '地点')}
          </Chip>
          {/* 收藏：文字**恒定**为「收藏」，选中与否只用颜色表达（2026-10-02 用户要求） */}
          <Chip active={onlyStarred} onClick={toggleStarred}>收藏</Chip>
          {filtersActive && (
            <button
              onClick={resetFilters}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs text-neutral-500 active:opacity-60 dark:text-neutral-400"
            >
              重置
            </button>
          )}
        </div>
        {/* 时间面板：只有「全部时间」+ 一张日历。
            ★ 2026-10-02 用户要求删掉「近 7 天 / 近 30 天 / 具体月份」三档——时间筛选只留「按具体日期」
              （理由见 lib/client/search.ts 顶部注释）。面板里给「全部时间」这一行是为了能**取消**筛选：
              chip 上的 ✕ 只清关键词，筛选的取消入口必须有地方放。
            日历本身列的是**真的有日记的日子**（与地点清单同一条约定），不给「点了却零结果」的档位。 */}
        {openPanel === 'time' && (
          <Panel scroll={false}>
            <ul className={PANEL_UL}>
              <PanelRow label="全部时间" selected={range === 'all'} onClick={() => pickRange('all')} />
            </ul>
            <PanelGroupLabel>具体日期</PanelGroupLabel>
            {/* 日历**恒定渲染**（2026-10-02）：此前分成「加载中一行提示 → 解密完换日历」两段，
                面板高度从一行跳到一整张日历 ⇒ 用户看到「先闪一下日历才出来」。现在只有
                日历底部那行状态文字在变，而它是固定高度的槽位，不会带动布局。 */}
            <DayPicker
              dayKeys={dayKeys}
              selected={isDayRange(range) ? range : 'all'}
              status={entries === null ? (error ? 'error' : 'loading') : 'ready'}
              onPick={pickRange}
            />
          </Panel>
        )}
        {/* 地点面板：只有两档——「无位置」与「具体地点」（2026-10-02 用户要求，从三档收成两档）。
            清单来自**实际数据**（每个地点后面带篇数），不是让用户凭记忆敲字——
            敲字既容易打错（「昆明市」写成「昆明」就零结果）也搜不出自己有哪些地点可选。
            「不限」不再单列一行：点已选中的那一项即可取消（见 pickLocation / toggleNoLocation）。 */}
        {openPanel === 'location' && (
          <Panel>
            <ul className={PANEL_UL}>
              <PanelRow label="无位置" selected={noLocation} onClick={toggleNoLocation} />
            </ul>
            <PanelGroupLabel>具体地点</PanelGroupLabel>
            <ul className={PANEL_UL}>
              {facets.length === 0 && (
                <li><PanelHint error={error} loaded={entries !== null} empty="还没有记录过地点" /></li>
              )}
              {facets.map((f) => (
                <PanelRow
                  key={f.name}
                  label={f.name}
                  meta={`${f.count} 篇`}
                  selected={location === f.name}
                  onClick={() => pickLocation(f.name)}
                />
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <div className="mx-auto min-h-0 w-full max-w-md flex-1 overflow-y-auto px-5 pb-safe">
        {/* 未输入且未筛选：只给引导，不展示全部日记（那是列表页的职责） */}
        {!active && (
          <p className="pt-16 text-center text-sm text-neutral-500 dark:text-neutral-400">输入关键词，或选择上面的筛选条件</p>
        )}

        {active && loading && <p className="pt-16 text-center text-sm text-neutral-500 dark:text-neutral-400">正在解密日记…</p>}

        {active && !loading && error && (
          <div className="pt-16 text-center">
            <p className="text-sm text-red-500">{error}</p>
            <button
              onClick={() => { setEntries(null); ensureLoaded() }}
              className="mt-4 rounded-xl bg-neutral-100 px-6 py-2.5 text-sm font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            >
              重试
            </button>
          </div>
        )}

        {active && !loading && !error && entries !== null && (
          results.length === 0 ? (
            <p className="pt-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
              {trimmedQuery ? <>没有找到包含「{trimmedQuery}」的日记</> : '没有符合条件的日记'}
            </p>
          ) : (
            <>
              <p className="py-2 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                找到 {results.length} 篇
                {visibleCount < results.length && `（已显示 ${visible.length}）`}
              </p>
              {/* 结果项沿用列表页的视觉：左侧时间 + 标题 + 命中片段（高亮） */}
              <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
                {visible.map(({ entry, plain }) => {
                  const place = displayLocationName(entry)
                  return (
                  <li key={entry.id}>
                    <Link href={`/entry/${entry.id}`} className="flex flex-col gap-1 py-3 active:opacity-60">
                      <span className="flex items-baseline gap-2">
                        <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                          {new Date(entry.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                        </span>
                        <span className="line-clamp-1 font-medium text-neutral-800 dark:text-neutral-200">
                          <Highlighted text={firstLine(plain) || '(无标题)'} query={trimmedQuery} />
                        </span>
                      </span>
                      <span className="line-clamp-2 whitespace-pre-wrap text-sm text-neutral-500 dark:text-neutral-400">
                        <Highlighted text={buildSnippet(plain, trimmedQuery)} query={trimmedQuery} />
                      </span>
                      {/* 元信息行：左下角定位，右下角天气。
                          天气必须显示——天气是检索字段之一（搜「小雨」能命中天气），
                          不展示的话命中了也看不出为什么命中；用 Highlighted 渲染，
                          关键词命中天气时会像正文一样高亮。
                          地名同样走统一展示口径（结构化三级拼接，老数据回退单一串），
                          与列表页/详情页显示成同一个名字。 */}
                      {(place || entry.weather) && (
                        <span className="flex items-baseline justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                          {/* 左：地名（无定位时留空，天气仍靠右对齐） */}
                          <span className="min-w-0 truncate">
                            {place && (
                              <>
                                <span className="mr-0.5 text-[10px]">📍</span>
                                <Highlighted text={place} query={trimmedQuery} />
                              </>
                            )}
                          </span>
                          {/* 右：天气（emoji + 文本，与详情页同款展示） */}
                          {entry.weather && (
                            <span className="shrink-0">
                              <span className="mr-0.5 text-[10px]">{weatherEmoji(entry.weather)}</span>
                              <Highlighted text={entry.weather} query={trimmedQuery} />
                            </span>
                          )}
                        </span>
                      )}
                    </Link>
                  </li>
                  )
                })}
              </ul>
              {/* 分批加载：卡片式按钮与筛选 Chip 同风格，明确告知「还有多少」——
                  绝不静默截断（用户看到 100 条却以为是全部，比加载慢更糟） */}
              {visibleCount < results.length && (
                <button
                  onClick={() => setVisibleCount((c) => c + PAGE)}
                  className="my-4 w-full rounded-xl bg-neutral-100 py-3 text-sm font-medium text-neutral-600 active:opacity-60 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  加载更多（还有 {results.length - visible.length} 篇）
                </button>
              )}
            </>
          )
        )}
      </div>
    </div>
  )
}
