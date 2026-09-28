import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  buildSnippet,
  firstLine,
  highlightSegments,
  isDefaultFilters,
  matches,
  rangeStart,
  type SearchFilters,
} from '@/lib/client/search'

const NOW = new Date('2026-09-28T12:00:00')

function filters(patch: Partial<SearchFilters> = {}): SearchFilters {
  return { ...DEFAULT_FILTERS, ...patch }
}

describe('isDefaultFilters', () => {
  it('全默认 → true', () => {
    expect(isDefaultFilters(filters())).toBe(true)
    expect(isDefaultFilters(filters({ query: '   ' }))).toBe(true)
  })
  it('任一条件非默认 → false', () => {
    expect(isDefaultFilters(filters({ query: '外滩' }))).toBe(false)
    expect(isDefaultFilters(filters({ range: '7d' }))).toBe(false)
    expect(isDefaultFilters(filters({ onlyWithLocation: true }))).toBe(false)
  })
})

describe('rangeStart', () => {
  it("'all' 返回 null（不限时间）", () => {
    expect(rangeStart('all', NOW)).toBeNull()
  })
  it("'7d' 含今天在内共 7 天（回退 6 天到 0 点）", () => {
    const start = rangeStart('7d', NOW)!
    expect(new Date(start).getHours()).toBe(0)
    expect(new Date(start).getDate()).toBe(22)
  })
  it("'30d' 回退 29 天到 0 点", () => {
    expect(new Date(rangeStart('30d', NOW)!).getDate()).toBe(30) // 8月30日
  })
  it("'year' 为当年 1 月 1 日 0 点", () => {
    const d = new Date(rangeStart('year', NOW)!)
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 0, 1])
  })
})

describe('matches', () => {
  const entry = { createdAt: '2026-09-28T08:00:00', latitude: 25.05, locationName: '黄浦区' }

  it('空关键词且无其它条件 → 全部命中', () => {
    expect(matches(entry, '今天去了外滩', filters(), NOW)).toBe(true)
  })
  it('命中正文（大小写不敏感）', () => {
    expect(matches(entry, 'Visited The Bund', filters({ query: 'the bund' }), NOW)).toBe(true)
    expect(matches(entry, '今天去了外滩', filters({ query: '外滩' }), NOW)).toBe(true)
  })
  it('地点名也参与检索', () => {
    expect(matches(entry, '今天很累', filters({ query: '黄浦' }), NOW)).toBe(true)
  })
  it('未命中 → false', () => {
    expect(matches(entry, '今天去了外滩', filters({ query: '陆家嘴' }), NOW)).toBe(false)
  })
  it('时间范围外的条目被排除', () => {
    expect(matches(entry, 'x', filters({ range: '7d' }), NOW)).toBe(true) // 当天
    const old = { ...entry, createdAt: '2026-01-01T08:00:00' }
    expect(matches(old, 'x', filters({ range: '7d' }), NOW)).toBe(false)
    expect(matches(old, 'x', filters({ range: 'year' }), NOW)).toBe(true)
  })
  it('只看有位置时排除无坐标条目', () => {
    const noLoc = { ...entry, latitude: null }
    expect(matches(noLoc, 'x', filters({ onlyWithLocation: true }), NOW)).toBe(false)
    expect(matches(entry, 'x', filters({ onlyWithLocation: true }), NOW)).toBe(true)
  })
})

describe('buildSnippet', () => {
  it('以首个命中为中心取窗口并加省略号', () => {
    const text = '前'.repeat(40) + 'KEYWORD' + '后'.repeat(80)
    const s = buildSnippet(text, 'keyword', 10, 20)
    expect(s).toContain('KEYWORD')
    expect(s.startsWith('…')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
  })
  it('正文无命中时退化为开头（例如只命中了地点名）', () => {
    const s = buildSnippet('开头内容' + 'x'.repeat(200), '不存在的词', 0, 10)
    expect(s.startsWith('开头内容')).toBe(true)
  })
  it('压平换行，避免片段里出现大片空白', () => {
    expect(buildSnippet('第一行\n\n\n第二行', '', 50, 50)).toBe('第一行 第二行')
  })
})

describe('highlightSegments', () => {
  it('空关键词 → 单段且未命中', () => {
    expect(highlightSegments('正文', '')).toEqual([{ text: '正文', hit: false }])
  })
  it('切出命中段（保留原文大小写）', () => {
    expect(highlightSegments('去了外滩看夜景', '外滩')).toEqual([
      { text: '去了', hit: false },
      { text: '外滩', hit: true },
      { text: '看夜景', hit: false },
    ])
  })
  it('多次命中全部切出', () => {
    const segs = highlightSegments('aXbXc', 'x')
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(['X', 'X'])
  })
  it('大小写不敏感匹配但按原文输出', () => {
    expect(highlightSegments('Hello World', 'WORLD').at(-1)).toEqual({ text: 'World', hit: true })
  })
  it('无命中 → 单段', () => {
    expect(highlightSegments('正文', 'zzz')).toEqual([{ text: '正文', hit: false }])
  })
})

describe('firstLine', () => {
  it('取第一个非空行并去除首尾空白', () => {
    expect(firstLine('\n\n  今天很开心  \n第二行')).toBe('今天很开心')
  })
  it('全空 → 空串', () => {
    expect(firstLine('\n\n  \n')).toBe('')
  })
})
