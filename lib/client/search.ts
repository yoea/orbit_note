// 搜索与筛选的纯逻辑（无 DOM、无网络，便于单测）。
//
// 前提：正文端到端加密，服务端只有密文 ⇒ 服务端无法参与正文检索，
// 必须把密文解密到内存后再本地匹配。明文只活在内存里，不落盘。
//
// 高亮只产出「片段数组」而不是 HTML 字符串——项目铁律是零 dangerouslySetInnerHTML，
// 高亮必须交给 React 渲染成 <mark>。
//
// ★ 所有筛选条件是**与**的关系（时间 × 位置 × 收藏 × 地名 × 关键词），
//   且全部作用在同一条 entry 上 ⇒ 组合结果一定是各条件的交集，不会出现
//   「按 A 筛出来的集合里再挑出不符合 B 的」（见 tests/search.test.ts 的组合断言）。
//
// ★ 界面上的筛选归为**三类**（2026-09-30 定）——时间 / 收藏 / 地点。
//   「只看有位置」不是第四类，它是地点这一类的「不限到具体地点」那一档，
//   因此在地点面板里与「全部地点」并列，而不是单独占一个 chip。
import { displayLocationName, type LocationedEntry } from './location'

// ── 时间：四档 ──────────────────────────────────────────────────────────────
//
// 全部时间 / 近 7 天 / 近 30 天 / **具体月份**。
// 刻意**不做**「今年」这类粗粒度区间（用户 2026-09-30 明确只要这四档）：
// 它与月份清单信息量重叠，而月份清单还能精确跳到某年的某个月；
// 也不做「近 90 天」之类的中间档——跨度越大越接近「全部时间」，没有额外信息。
//
// 具体月份编码成 'm:YYYY-MM' 而不是新增一个字段：时间维度在数据层始终是**一个**
// 可选值，`matches` 里就仍然只有一处时间判定，不需要「预设与月份互斥」的额外规则。
export type TimeRange = 'all' | '7d' | '30d' | `m:${string}`

/** 预设档（下拉里排在月份清单之前）。'all' 是默认值 = 不做时间过滤。 */
export const TIME_PRESETS: TimeRange[] = ['all', '7d', '30d']

const MONTH_RANGE_RE = /^m:(\d{4})-(\d{2})$/

/** 'm:YYYY-MM' → { year, month }；非月份档或月份非法（00/13）返回 null */
function parseMonthRange(range: TimeRange): { year: number; month: number } | null {
  const m = MONTH_RANGE_RE.exec(range)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return { year, month }
}

export interface SearchFilters {
  query: string
  range: TimeRange
  onlyWithLocation: boolean
  /** 只看收藏（false = 不限；筛选是「收窄」语义，不需要「只看未收藏」这一半） */
  onlyStarred: boolean
  /** 地名筛选：取 displayLocationName 的**原值**（null = 不限）。存展示串而非 id，是因为
   *  「一个地点」在界面上就是那个名字，用户选的就是他看到的那一行。 */
  location: string | null
}

export const DEFAULT_FILTERS: SearchFilters = {
  query: '',
  range: 'all',
  onlyWithLocation: false,
  onlyStarred: false,
  location: null,
}

/** 全默认时不做任何过滤——界面据此显示引导文案而不是「全部日记」 */
export function isDefaultFilters(f: SearchFilters): boolean {
  return f.query.trim() === '' && f.range === 'all' && !f.onlyWithLocation && !f.onlyStarred && f.location === null
}

/** 时间档的展示串（chip 上的文字与面板里那一行**共用**它，避免两处走样） */
export function timeRangeLabel(range: TimeRange): string {
  if (range === '7d') return '近 7 天'
  if (range === '30d') return '近 30 天'
  const month = parseMonthRange(range)
  if (month) return `${month.year}年${month.month}月`
  return '全部时间'
}

/** 时间范围下界（本地时区当天/当月 0 点）；'all' 返回 null */
export function rangeStart(range: TimeRange, now: Date = new Date()): number | null {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  if (range === '7d') { d.setDate(d.getDate() - 6); return d.getTime() }
  if (range === '30d') { d.setDate(d.getDate() - 29); return d.getTime() }
  const month = parseMonthRange(range)
  if (month) return new Date(month.year, month.month - 1, 1).getTime()
  return null
}

/**
 * 时间范围上界（**不含**，取次月 1 日 0 点）；只有具体月份有上界。
 * 预设档（近 7 天 / 近 30 天）只有下界、上界是「现在」——刻意不给它们算上界：
 * 上界写成「明天 0 点」会把今天晚些时候创建的条目挡在外面（时钟与本地时区都可能偏）。
 */
export function rangeEnd(range: TimeRange): number | null {
  const month = parseMonthRange(range)
  if (!month) return null
  return new Date(month.year, month.month, 1).getTime()
}

export interface MonthFacet {
  /** 'YYYY-MM'（本地时区） */
  key: string
  /** 展示串（'2026年9月'）——与 chip 上的文字同一口径 */
  label: string
  count: number
}

/**
 * 数据里**实际存在**的月份清单（新的在前）。
 * 与地名清单同理：只列真的有日记的月份，不给出「选了却零结果」的空档；
 * 正文端到端加密、服务端无法参与筛选，所以清单只能在客户端从已解密条目里现取。
 */
export function monthFacets(entries: { createdAt: string }[]): MonthFacet[] {
  const map = new Map<string, number>()
  for (const e of entries) {
    const d = new Date(e.createdAt)
    if (Number.isNaN(d.getTime())) continue
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, label: timeRangeLabel(`m:${key}`), count }))
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
}

export interface FilterableEntry extends LocationedEntry {
  createdAt: string
  latitude: number | null
  weather: string | null
  starred: boolean
}

/** 地名的检索/匹配用文本：结构化三级 + 老的地名串都算（老数据也要搜得到） */
function placeHaystack(e: LocationedEntry): string {
  return [e.locationProvince, e.locationCity, e.locationDistrict, e.locationName]
    .filter((v): v is string => Boolean(v))
    .join(' ')
    .toLowerCase()
}

/** 是否命中当前筛选条件。空 query 视为「不限关键词」，只看其余条件。 */
export function matches(
  entry: FilterableEntry,
  plain: string,
  f: SearchFilters,
  now: Date = new Date(),
): boolean {
  const at = new Date(entry.createdAt).getTime()
  const start = rangeStart(f.range, now)
  if (start != null && at < start) return false
  const end = rangeEnd(f.range)
  if (end != null && at >= end) return false
  if (f.onlyWithLocation && entry.latitude == null) return false
  if (f.onlyStarred && !entry.starred) return false
  // 地名筛选：按**展示串**精确相等（用户选的是列表里看到的那一行，不该匹配到别的地点）
  if (f.location !== null && displayLocationName(entry) !== f.location) return false
  const q = f.query.trim().toLowerCase()
  if (q === '') return true
  // 正文之外的元数据也纳入检索：用户常常记得「在哪写的」「什么天气」而不是写了什么。
  // 天气是保存时记录的明文字段（如「小雨」），不检索它就会漏掉「找下雨天写的日记」这类需求。
  return plain.toLowerCase().includes(q)
    || placeHaystack(entry).includes(q)
    || (entry.weather ?? '').toLowerCase().includes(q)
}

export interface LocationFacet {
  /** 展示串（displayLocationName 的原值）——既是筛选值也是界面上的那一行字 */
  name: string
  count: number
}

/**
 * 去重后的地名清单（供搜索弹窗的「地名」筛选项使用）。
 * 按出现次数降序、同次数按名字排——常用的地点排前面。
 * 没有任何地名的条目（没记位置 / 反查失败）不进清单，因此不会出现空白可选项。
 */
export function locationFacets(entries: LocationedEntry[]): LocationFacet[] {
  const map = new Map<string, number>()
  for (const e of entries) {
    const name = displayLocationName(e)
    if (!name) continue
    map.set(name, (map.get(name) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans'))
}

/** 子串出现次数（不重叠）。needle 为空时返回 0（避免死循环）。 */
function countOccurrences(haystackLower: string, needleLower: string): number {
  if (needleLower === '') return 0
  let count = 0
  let i = 0
  while ((i = haystackLower.indexOf(needleLower, i)) !== -1) {
    count++
    i += needleLower.length
  }
  return count
}

/**
 * 相关度评分（有关键词时才用得上）。
 *
 * 搜索的价值在于「把对的答案排前面」——纯粹按时间倒序会让最相关的一篇沉底。
 * 信号按强度排序：标题（首行）命中 > 地点名命中 > 正文命中次数。
 * 权重是刻意保守的简单加权（不上 TF-IDF 那类东西），便于理解与调整。
 *
 * 注意 bodyHits 计的是整篇（含标题），标题命中会同时吃到两份分——
 * 这是有意的：标题命中本就该更重。
 */
export function relevanceScore(entry: FilterableEntry, plain: string, query: string): number {
  const q = query.trim().toLowerCase()
  if (q === '') return 0
  const bodyLower = plain.toLowerCase()
  const titleHits = countOccurrences(firstLine(plain).toLowerCase(), q)
  const bodyHits = countOccurrences(bodyLower, q)
  const locHit = placeHaystack(entry).includes(q) ? 1 : 0
  return titleHits * 10 + bodyHits * 2 + locHit * 3
}

const SNIPPET_BEFORE = 12
const SNIPPET_AFTER = 60

/**
 * 命中片段：以首个命中位置为中心取窗口。
 * 正文没有命中时（例如只命中了地点名）退化为开头一段，保证结果项仍有上下文。
 */
export function buildSnippet(plain: string, query: string, before = SNIPPET_BEFORE, after = SNIPPET_AFTER): string {
  // 压平换行——片段只占一两行，保留换行会出现大片空白
  const text = plain.replace(/\s+/g, ' ').trim()
  const q = query.trim().toLowerCase()
  const at = q === '' ? -1 : text.toLowerCase().indexOf(q)
  if (at === -1) return text.slice(0, before + after)
  const start = Math.max(0, at - before)
  const end = Math.min(text.length, at + q.length + after)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

export interface Segment {
  text: string
  hit: boolean
}

/** 把文本切成「命中 / 未命中」片段，交给 React 渲染（不使用 HTML 字符串） */
export function highlightSegments(text: string, query: string): Segment[] {
  const q = query.trim()
  if (q === '') return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const out: Segment[] = []
  let i = 0
  while (i < text.length) {
    const at = lower.indexOf(needle, i)
    if (at === -1) {
      out.push({ text: text.slice(i), hit: false })
      break
    }
    if (at > i) out.push({ text: text.slice(i, at), hit: false })
    out.push({ text: text.slice(at, at + q.length), hit: true })
    i = at + q.length
  }
  return out.length > 0 ? out : [{ text, hit: false }]
}

/** 首行标题（与列表页口径一致：第一个非空行） */
export function firstLine(plain: string): string {
  return plain.split('\n').find((l) => l.trim())?.trim() ?? ''
}
