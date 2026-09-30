'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import SearchIcon from './SearchIcon'
import { getDek } from '@/lib/client/session'
import { decryptEntries, fetchAllEntries } from '@/lib/client/entries'
import { weatherEmoji } from '@/lib/client/weather'
import {
  TIME_PRESETS,
  buildSnippet,
  firstLine,
  highlightSegments,
  isDefaultFilters,
  locationFacets,
  matches,
  monthFacets,
  relevanceScore,
  timeRangeLabel,
  type TimeRange,
} from '@/lib/client/search'
import type { DecryptedEntry } from '@/lib/client/entries'
import { displayLocationName } from '@/lib/client/location'
import { toPlainText } from '@/lib/client/markdown'

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

// 筛选项面板的容器（限高 + 内部滚动，与设置页弹窗同一套做法）
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 max-h-[45dvh] overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
      {children}
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
  const [onlyWithLocation, setOnlyWithLocation] = useState(false)
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

  // 地点三类选择互斥：不限 / 只看有位置 / 具体地点
  function pickAllPlaces() {
    setLocation(null)
    setOnlyWithLocation(false)
    setOpenPanel(null)
    resetPaging()
  }
  function pickWithLocation() {
    setLocation(null)
    setOnlyWithLocation(true)
    setOpenPanel(null)
    resetPaging()
  }
  function pickLocation(name: string) {
    setLocation(name)
    setOnlyWithLocation(false)
    setOpenPanel(null)
    resetPaging()
  }

  // 重置筛选（**不含**关键词——关键词由输入框自己的 ✕ 清除，两个入口各管一摊）
  function resetFilters() {
    setRange('all')
    setOnlyStarred(false)
    setOnlyWithLocation(false)
    setLocation(null)
    setOpenPanel(null)
    resetPaging()
  }

  const filters = { query, range, onlyWithLocation, onlyStarred, location }
  const active = !isDefaultFilters(filters)
  // 是否有任何**筛选**（不含关键词）非默认——决定「重置」按钮出不出来
  const filtersActive = range !== 'all' || onlyStarred || onlyWithLocation || location !== null

  // 地名清单：从**全部已解密条目**里现取（服务端只有密文与元数据，但地名就是元数据，
  // 客户端取不到别的来源）。清单里不会出现空地名，所以不会给出选了却零结果的可选项。
  const facets = useMemo(() => locationFacets((entries ?? []).map((e) => e.entry)), [entries])
  // 月份清单同理：只列真的有日记的月份（新的在前），不会给出空档
  const months = useMemo(() => monthFacets((entries ?? []).map((e) => e.entry)), [entries])

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
  }, [entries, query, range, onlyWithLocation, onlyStarred, location]) // eslint-disable-line react-hooks/exhaustive-deps -- filters 每次渲染新建对象，按字段依赖更准确

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
            · 时间：按钮上直接显示当前档位（默认「全部时间」），点开面板选预设档或具体月份；
            · 收藏：布尔开关，点了就切，没有面板可开；
            · 地点：「只看有位置」与「具体地点」是同一类里的两档，因此都收在地点面板内，
              不再单独占一个 chip（这就是从 7 个 chip 收敛成 3 个控件的原因）。 */}
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <Chip active={range !== 'all'} caret onClick={() => openFilterPanel('time')}>
            {timeRangeLabel(range)}
          </Chip>
          <Chip active={onlyStarred} onClick={toggleStarred}>
            {onlyStarred ? '仅收藏' : '收藏'}
          </Chip>
          <Chip active={location !== null || onlyWithLocation} caret onClick={() => openFilterPanel('location')}>
            {location ?? (onlyWithLocation ? '有位置' : '地点')}
          </Chip>
          {filtersActive && (
            <button
              onClick={resetFilters}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs text-neutral-500 active:opacity-60 dark:text-neutral-400"
            >
              重置
            </button>
          )}
        </div>
        {/* 时间面板：预设档 + 数据里实际存在的月份清单。
            列月份而不是让用户自己选年/月，理由与地点清单相同——只给出**真的有日记**的档位，
            不会出现「选了却零结果」的组合。 */}
        {openPanel === 'time' && (
          <Panel>
            <ul className={PANEL_UL}>
              {TIME_PRESETS.map((r) => (
                <PanelRow key={r} label={timeRangeLabel(r)} selected={range === r} onClick={() => pickRange(r)} />
              ))}
            </ul>
            <PanelGroupLabel>按月份</PanelGroupLabel>
            <ul className={PANEL_UL}>
              {months.length === 0 && (
                <li><PanelHint error={error} loaded={entries !== null} empty="还没有日记" /></li>
              )}
              {months.map((m) => (
                <PanelRow
                  key={m.key}
                  label={m.label}
                  meta={`${m.count} 篇`}
                  selected={range === `m:${m.key}`}
                  onClick={() => pickRange(`m:${m.key}`)}
                />
              ))}
            </ul>
          </Panel>
        )}
        {/* 地点面板：不限 / 只看有位置 / 具体地点 三档互斥。
            清单来自**实际数据**（每个地点后面带篇数），不是让用户凭记忆敲字——
            敲字既容易打错（「昆明市」写成「昆明」就零结果）也搜不出自己有哪些地点可选。 */}
        {openPanel === 'location' && (
          <Panel>
            <ul className={PANEL_UL}>
              <PanelRow label="全部地点" selected={location === null && !onlyWithLocation} onClick={pickAllPlaces} />
              <PanelRow label="只看有位置" selected={onlyWithLocation} onClick={pickWithLocation} />
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
