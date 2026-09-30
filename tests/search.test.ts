import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  TIME_PRESETS,
  buildSnippet,
  firstLine,
  highlightSegments,
  isDefaultFilters,
  locationFacets,
  matches,
  monthFacets,
  rangeEnd,
  rangeStart,
  relevanceScore,
  timeRangeLabel,
  type FilterableEntry,
  type SearchFilters,
} from '@/lib/client/search'

const NOW = new Date('2026-09-28T12:00:00')

function filters(patch: Partial<SearchFilters> = {}): SearchFilters {
  return { ...DEFAULT_FILTERS, ...patch }
}

/** 可筛选条目的全字段默认值（给 diary_entries 加列时不必回来补每一处字面量） */
function fe(patch: Partial<FilterableEntry> = {}): FilterableEntry {
  return {
    createdAt: '2026-09-28T08:00:00',
    latitude: null,
    weather: null,
    starred: false,
    locationProvince: null,
    locationCity: null,
    locationDistrict: null,
    locationName: null,
    ...patch,
  }
}

describe('isDefaultFilters', () => {
  it('全默认 → true', () => {
    expect(isDefaultFilters(filters())).toBe(true)
    expect(isDefaultFilters(filters({ query: '   ' }))).toBe(true)
  })
  it('任一条件非默认 → false（含新增的收藏与地名）', () => {
    expect(isDefaultFilters(filters({ query: '外滩' }))).toBe(false)
    expect(isDefaultFilters(filters({ range: '7d' }))).toBe(false)
    expect(isDefaultFilters(filters({ onlyWithLocation: true }))).toBe(false)
    expect(isDefaultFilters(filters({ onlyStarred: true }))).toBe(false)
    expect(isDefaultFilters(filters({ location: '云南省 昆明市' }))).toBe(false)
  })
})

describe('时间档：rangeStart / rangeEnd', () => {
  it("'all' 两侧都是 null（不限时间）", () => {
    expect(rangeStart('all', NOW)).toBeNull()
    expect(rangeEnd('all')).toBeNull()
  })
  it("'7d' 含今天在内共 7 天（回退 6 天到 0 点），且刻意没有上界", () => {
    const start = rangeStart('7d', NOW)!
    expect(new Date(start).getHours()).toBe(0)
    expect(new Date(start).getDate()).toBe(22)
    expect(rangeEnd('7d')).toBeNull()
  })
  it("'30d' 回退 29 天到 0 点", () => {
    expect(new Date(rangeStart('30d', NOW)!).getDate()).toBe(30) // 8月30日
  })
  it('预设档只有三个——刻意不做「今年」（与月份清单重叠、粒度更粗）', () => {
    expect(TIME_PRESETS).toEqual(['all', '7d', '30d'])
  })
  it('具体月份：下界 = 当月 1 日 0 点，上界 = 次月 1 日 0 点（不含）', () => {
    const d = new Date(rangeStart('m:2026-08', NOW)!)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 7, 1, 0])
    const e = new Date(rangeEnd('m:2026-08')!)
    expect([e.getFullYear(), e.getMonth(), e.getDate(), e.getHours()]).toEqual([2026, 8, 1, 0])
  })
  it('12 月的上界跨到下一年 1 月', () => {
    const e = new Date(rangeEnd('m:2026-12')!)
    expect([e.getFullYear(), e.getMonth(), e.getDate()]).toEqual([2027, 0, 1])
  })
  it('非法月份不给边界（既不抛异常，也不悄悄退化成整年）', () => {
    expect(rangeStart('m:2026-13', NOW)).toBeNull()
    expect(rangeEnd('m:2026-13')).toBeNull()
    expect(rangeStart('m:2026-00', NOW)).toBeNull()
    expect(rangeEnd('m:2026-00')).toBeNull()
  })
})

describe('timeRangeLabel（chip 与面板共用同一份文字）', () => {
  it('预设档与月份档各有其展示串', () => {
    expect(timeRangeLabel('all')).toBe('全部时间')
    expect(timeRangeLabel('7d')).toBe('近 7 天')
    expect(timeRangeLabel('30d')).toBe('近 30 天')
    expect(timeRangeLabel('m:2026-09')).toBe('2026年9月')
    expect(timeRangeLabel('m:2026-12')).toBe('2026年12月')
  })
})

describe('monthFacets（月份清单）', () => {
  it('按月归并、新的在前，且带篇数', () => {
    const facets = monthFacets([
      { createdAt: '2026-09-28T08:00:00' },
      { createdAt: '2026-09-01T08:00:00' },
      { createdAt: '2026-08-31T23:00:00' },
      { createdAt: '2025-12-01T08:00:00' },
    ])
    expect(facets).toEqual([
      { key: '2026-09', label: '2026年9月', count: 2 },
      { key: '2026-08', label: '2026年8月', count: 1 },
      { key: '2025-12', label: '2025年12月', count: 1 },
    ])
  })
  it('按**本地时区**归月，不是按 UTC 截字符串', () => {
    // 本地 9 月 1 日 00:30 写的这一篇：在 UTC+8 之类东时区里，它的 UTC 时间戳还停在
    // 8 月 31 日 —— 若实现写成 iso.slice(0, 7)，用户会看到「8 月有 1 篇」而 9 月是空的。
    const local = new Date(2026, 8, 1, 0, 30)
    const facets = monthFacets([{ createdAt: local.toISOString() }])
    expect(facets).toHaveLength(1)
    expect(facets[0].key).toBe(`${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}`)
    expect(facets[0].key).toBe('2026-09')
  })
  it('时间戳坏掉的条目不进清单（也不抛）', () => {
    expect(monthFacets([{ createdAt: 'not-a-date' }])).toEqual([])
  })
  it('空输入 → 空清单（界面据此显示「还没有日记」而不是空白）', () => {
    expect(monthFacets([])).toEqual([])
  })
})

describe('matches', () => {
  const entry = fe({ createdAt: '2026-09-28T08:00:00', latitude: 25.05, locationName: '黄浦区' })

  it('空关键词且无其它条件 → 全部命中', () => {
    expect(matches(entry, '今天去了外滩', filters(), NOW)).toBe(true)
  })
  it('命中正文（大小写不敏感）', () => {
    expect(matches(entry, 'Visited The Bund', filters({ query: 'the bund' }), NOW)).toBe(true)
    expect(matches(entry, '今天去了外滩', filters({ query: '外滩' }), NOW)).toBe(true)
  })
  it('地点名也参与检索（结构化三级与老的地名串都算）', () => {
    expect(matches(entry, '今天很累', filters({ query: '黄浦' }), NOW)).toBe(true)
    const structured = fe({ locationProvince: '云南省', locationCity: '昆明市', locationDistrict: '五华区' })
    expect(matches(structured, '今天很累', filters({ query: '五华' }), NOW)).toBe(true)
    expect(matches(structured, '今天很累', filters({ query: '云南' }), NOW)).toBe(true)
    expect(matches(structured, '今天很累', filters({ query: '成都' }), NOW)).toBe(false)
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
    expect(matches(old, 'x', filters({ range: 'm:2026-01' }), NOW)).toBe(true)
  })
  it('具体月份含首日 0 点、不含次月 1 日 0 点（上界是闭开区间）', () => {
    const inMonth = { ...entry, createdAt: '2026-08-15T10:00:00' }
    const atStart = { ...entry, createdAt: '2026-08-01T00:00:00' }
    const atNextMonth = { ...entry, createdAt: '2026-09-01T00:00:00' }
    const prevMonth = { ...entry, createdAt: '2026-07-31T23:59:59' }
    expect(matches(inMonth, 'x', filters({ range: 'm:2026-08' }), NOW)).toBe(true)
    expect(matches(atStart, 'x', filters({ range: 'm:2026-08' }), NOW)).toBe(true)
    expect(matches(atNextMonth, 'x', filters({ range: 'm:2026-08' }), NOW)).toBe(false)
    expect(matches(prevMonth, 'x', filters({ range: 'm:2026-08' }), NOW)).toBe(false)
  })
  it('只看有位置时排除无坐标条目', () => {
    const noLoc = { ...entry, latitude: null }
    expect(matches(noLoc, 'x', filters({ onlyWithLocation: true }), NOW)).toBe(false)
    expect(matches(entry, 'x', filters({ onlyWithLocation: true }), NOW)).toBe(true)
  })
  it('只看收藏时排除未收藏条目', () => {
    expect(matches(entry, 'x', filters({ onlyStarred: true }), NOW)).toBe(false)
    expect(matches({ ...entry, starred: true }, 'x', filters({ onlyStarred: true }), NOW)).toBe(true)
  })
})

// ============================================================================
// 收藏 × 地名：两种筛选必须能**组合**，且结果准确（= 严格取交集）
//
// 组合筛选最容易出的错是「先按 A 筛出子集，再在子集里按 B 筛」时把 B 的作用域搞错，
// 或者两个条件各写一处、其中一处忘了带上。下面用一组构造好的数据把交叉情况钉死：
//   · 同一地点既有收藏也有未收藏 → 两个条件一起用时只能留收藏的那条；
//   · 收藏的那条在另一个地点 → 换地名必须换结果；
//   · 「地名」是精确匹配（不是子串包含）→ 选「昆明市 五华区」不能把「昆明市 西山区」带进来。
// ============================================================================
describe('收藏 × 地名 组合筛选', () => {
  // 三个地点、四条数据，交叉覆盖
  const kunmingWuhua = fe({ locationProvince: '云南省', locationCity: '昆明市', locationDistrict: '五华区', starred: true })
  const kunmingWuhuaPlain = fe({ locationProvince: '云南省', locationCity: '昆明市', locationDistrict: '五华区', starred: false })
  const kunmingXishan = fe({ locationProvince: '云南省', locationCity: '昆明市', locationDistrict: '西山区', starred: true })
  const shanghai = fe({ locationProvince: '上海市', locationCity: '上海市', locationDistrict: '黄浦区', starred: false })
  const all = [kunmingWuhua, kunmingWuhuaPlain, kunmingXishan, shanghai]

  const pick = (f: Partial<SearchFilters>) => all.filter((e) => matches(e, '正文', filters(f), NOW))

  it('C0 前置：数据本身两种状态都齐（否则后面的组合断言会空转）', () => {
    expect(all.filter((e) => e.starred)).toHaveLength(2)
    expect(all.filter((e) => !e.starred)).toHaveLength(2)
  })

  it('C1 只看收藏 = 全部收藏（2 条）', () => {
    expect(pick({ onlyStarred: true })).toEqual([kunmingWuhua, kunmingXishan])
  })

  it('C2 按地名筛选 = 该地点的全部条目（与收藏状态无关）', () => {
    expect(pick({ location: '云南省 昆明市 五华区' })).toEqual([kunmingWuhua, kunmingWuhuaPlain])
  })

  it('C3 组合：收藏 ∩ 地名 = 该地点里被收藏的那些', () => {
    expect(pick({ onlyStarred: true, location: '云南省 昆明市 五华区' })).toEqual([kunmingWuhua])
    expect(pick({ onlyStarred: true, location: '上海市 黄浦区' })).toEqual([]) // 上海那条没收藏
  })

  it('C4 地名是精确匹配：选五华区不会把西山区带进来', () => {
    expect(pick({ location: '云南省 昆明市 西山区' })).toEqual([kunmingXishan])
  })

  it('C5 再叠加关键词与时间，仍是交集（任一条件不满足即出局）', () => {
    expect(pick({ onlyStarred: true, location: '云南省 昆明市 五华区', query: '正文' })).toEqual([kunmingWuhua])
    expect(pick({ onlyStarred: true, location: '云南省 昆明市 五华区', query: '不存在的词' })).toEqual([])
    // 时间：同一条件组合下，把那条的创建时间挪到范围外就必须被刷掉（证明时间是独立生效的）
    const ancient = { ...kunmingWuhua, createdAt: '2020-01-01T00:00:00' }
    const combo = { onlyStarred: true, location: '云南省 昆明市 五华区', range: '7d' as const }
    expect(matches(kunmingWuhua, '正文', filters(combo), NOW)).toBe(true)
    expect(matches(ancient, '正文', filters(combo), NOW)).toBe(false)
  })
})

describe('locationFacets（地名清单）', () => {
  it('去重后带篇数，按篇数降序；没有地名的条目不进清单', () => {
    const facets = locationFacets([
      fe({ locationProvince: '云南省', locationCity: '昆明市', locationDistrict: '五华区' }),
      fe({ locationProvince: '云南省', locationCity: '昆明市', locationDistrict: '五华区' }),
      fe({ locationProvince: '上海市', locationCity: '上海市', locationDistrict: '黄浦区' }),
      fe(), // 没记位置
    ])
    expect(facets).toEqual([
      { name: '云南省 昆明市 五华区', count: 2 },
      { name: '上海市 黄浦区', count: 1 },
    ])
  })

  it('老数据（只有单一地名串）也进清单，且用统一的展示口径', () => {
    const facets = locationFacets([fe({ locationName: '五华区 昆明市' })])
    expect(facets).toEqual([{ name: '五华区 昆明市', count: 1 }])
  })
})

describe('relevanceScore', () => {
  const entry = fe()

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
    const withLoc = fe({ locationProvince: '云南省', locationCity: '昆明市', locationDistrict: '星巴克咖啡店' })
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
