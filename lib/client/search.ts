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

// ── 时间：只剩两档 ──────────────────────────────────────────────────────────
//
// 全部时间 / **具体日期**。
// ★ 2026-10-02（用户要求）：删掉了「近 7 天」「近 30 天」与「具体月份」三个快捷档。
//   理由：这几档要么与「具体日期」信息量重叠（月份只是粗一层的日期），要么几乎不用
//   （近 7 天/近 30 天在只有几十篇的个人日记里，效果接近「全部时间」）。档位少了以后
//   时间面板只剩「全部时间 + 一张日历」，用户不必先在一串档位里找。
//   历史（别加回来）：曾有过 '7d' / '30d' / 'm:YYYY-MM'，也被删过一次「今年」档。
//
// 具体日期编码成 'd:YYYY-MM-DD' 而不是新增字段：时间维度在数据层始终是**一个**可选值，
// `matches` 里就仍然只有一处时间判定。'
export type TimeRange = 'all' | `d:${string}`

const DAY_RANGE_RE = /^d:(\d{4})-(\d{2})-(\d{2})$/

/**
 * 'd:YYYY-MM-DD' → 本地零点的 Date；非日期档或日期非法返回 null。
 * 回验一次组件是必要的：`new Date(2026, 1, 30)`（2月30日）不报错，会静默滚到 3月2日。
 */
function parseDayRange(range: TimeRange): Date | null {
  const m = DAY_RANGE_RE.exec(range)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12) return null
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  return date
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
  const day = parseDayRange(range)
  if (!day) return '全部时间'
  const md = `${day.getMonth() + 1}月${day.getDate()}日`
  // 跨年才带年份，否则 chip 上太长
  return day.getFullYear() === new Date().getFullYear() ? md : `${day.getFullYear()}年${md}`
}

/** 该时间档是否属于「具体某一天」（面板里据此高亮日历上的那一格） */
export function isDayRange(range: TimeRange): boolean {
  return parseDayRange(range) !== null
}

/**
 * 'YYYY-MM-DD' → 'd:YYYY-MM-DD'。
 * 存在的意义是**把日期档的编码格式收在一处**：日历点击、选中判定、测试都走它，
 * 哪天编码要改只改这里。
 */
export function dayRangeKey(day: string): TimeRange {
  return `d:${day}`
}

/** 时间范围下界（具体日期 = 本地当天 0 点）；'all' 返回 null */
export function rangeStart(range: TimeRange): number | null {
  const day = parseDayRange(range)
  return day ? day.getTime() : null
}

/**
 * 时间范围上界（**不含**，具体日期取次日 0 点）；'all' 返回 null。
 * 用「次日 0 点、不含」而不是「当天 23:59:59.999」：临界那一毫秒的条目不会被漏掉。
 */
export function rangeEnd(range: TimeRange): number | null {
  const day = parseDayRange(range)
  if (!day) return null
  const next = new Date(day)
  next.setDate(next.getDate() + 1)
  return next.getTime()
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
): boolean {
  const at = new Date(entry.createdAt).getTime()
  const start = rangeStart(f.range)
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
