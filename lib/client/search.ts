// 搜索与筛选的纯逻辑（无 DOM、无网络，便于单测）。
//
// 前提：正文端到端加密，服务端只有密文 ⇒ 服务端无法参与正文检索，
// 必须把密文解密到内存后再本地匹配。明文只活在内存里，不落盘。
//
// 高亮只产出「片段数组」而不是 HTML 字符串——项目铁律是零 dangerouslySetInnerHTML，
// 高亮必须交给 React 渲染成 <mark>。

export type TimeRange = 'all' | '7d' | '30d' | 'year'

export interface SearchFilters {
  query: string
  range: TimeRange
  onlyWithLocation: boolean
}

export const DEFAULT_FILTERS: SearchFilters = { query: '', range: 'all', onlyWithLocation: false }

/** 全默认时不做任何过滤——界面据此显示引导文案而不是「全部日记」 */
export function isDefaultFilters(f: SearchFilters): boolean {
  return f.query.trim() === '' && f.range === 'all' && !f.onlyWithLocation
}

export const TIME_RANGE_LABEL: Record<TimeRange, string> = {
  all: '全部时间',
  '7d': '近 7 天',
  '30d': '近 30 天',
  year: '今年',
}

/** 时间范围下界（本地时区当天 0 点）；'all' 返回 null */
export function rangeStart(range: TimeRange, now: Date = new Date()): number | null {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  if (range === '7d') { d.setDate(d.getDate() - 6); return d.getTime() }
  if (range === '30d') { d.setDate(d.getDate() - 29); return d.getTime() }
  if (range === 'year') { return new Date(d.getFullYear(), 0, 1).getTime() }
  return null
}

export interface FilterableEntry {
  createdAt: string
  latitude: number | null
  locationName: string | null
}

/** 是否命中当前筛选条件。空 query 视为「不限关键词」，只看时间与位置条件。 */
export function matches(
  entry: FilterableEntry,
  plain: string,
  f: SearchFilters,
  now: Date = new Date(),
): boolean {
  const start = rangeStart(f.range, now)
  if (start != null && new Date(entry.createdAt).getTime() < start) return false
  if (f.onlyWithLocation && entry.latitude == null) return false
  const q = f.query.trim().toLowerCase()
  if (q === '') return true
  // 地点名也纳入检索：用户常常记得「在哪写的」而不是写了什么
  return plain.toLowerCase().includes(q) || (entry.locationName ?? '').toLowerCase().includes(q)
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
