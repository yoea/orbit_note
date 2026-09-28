import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  buildSnippet,
  firstLine,
  highlightSegments,
  isDefaultFilters,
  matches,
  rangeStart,
  relevanceScore,
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
  const entry = { createdAt: '2026-09-28T08:00:00', latitude: 25.05, locationName: '黄浦区', weather: null }

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
  it('天气也参与检索（明文字段，此前漏了——搜「小雨」找不到下雨天写的日记）', () => {
    const rainy = { ...entry, weather: '小雨' }
    expect(matches(rainy, '今天心情一般', filters({ query: '小雨' }), NOW)).toBe(true)
    expect(matches(entry, '今天心情一般', filters({ query: '小雨' }), NOW)).toBe(false)
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

describe('relevanceScore', () => {
  const entry = { createdAt: '2026-09-28T08:00:00', latitude: null, locationName: null, weather: null }

  it('空关键词 → 0（无关键词时不排序，保持时间倒序）', () => {
    expect(relevanceScore(entry, '咖啡咖啡咖啡', '')).toBe(0)
    expect(relevanceScore(entry, '咖啡咖啡咖啡', '   ')).toBe(0)
  })
  it('标题（首行）命中显著高于仅正文命中', () => {
    const titleHit = relevanceScore(entry, '咖啡日记\n今天在家休息', '咖啡')
    const bodyOnly = relevanceScore(entry, '随意的一天\n喝了一杯咖啡', '咖啡')
    expect(titleHit).toBeGreaterThan(bodyOnly)
  })
  it('正文命中次数越多分越高', () => {
    const once = relevanceScore(entry, '开头\n咖啡', '咖啡')
    const thrice = relevanceScore(entry, '开头\n咖啡咖啡咖啡', '咖啡')
    expect(thrice).toBeGreaterThan(once)
  })
  it('地点名命中加分（正文未命中时仍有分）', () => {
    const withLoc = { ...entry, locationName: '星巴克咖啡店' }
    expect(relevanceScore(withLoc, '今天出门了', '咖啡')).toBeGreaterThan(0)
    expect(relevanceScore(entry, '今天出门了', '咖啡')).toBe(0)
  })
  it('不重叠计数：连续重复串按不重叠次数计', () => {
    // 'aaaa' 中找 'aa' → 2 次（不是 3 次）
    const two = relevanceScore(entry, 'aaaa', 'aa')
    const one = relevanceScore(entry, 'aaa', 'aa')
    expect(two).toBeGreaterThan(one)
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
