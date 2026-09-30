// 守卫：地名反查的本地缓存。
//
// 为什么需要它（2026-09-30 用生产库实测）：119 条有坐标的笔记只落在 31 个格子里，
// 「精确格子」的历史命中率 74.8% —— 也就是约四分之三的外部调用本可以不打出去。
// 这个缓存能同时省调用、省等待，并减少「缺地名」的失败（4 条缺地名的笔记里有 2 条，
// 其格子此前已经查过）。
//
// ★ 本文件钉住的是一条**容易写错且症状隐蔽**的约束：
//   缓存键必须与**实际发给 API 的坐标严格同源**（都走 coarsenCoordinate）。
//   不同源的两种症状都很难在真机上发现：
//     · 键用了原始坐标 ⇒ 缓存永远不命中，「明明缓存过还是每次打 API」；
//     · 键比请求更粗 ⇒ 「用 A 地的名字标 B 点」（写错地名，静默）。
//
// 用内存版 idb 替身：真机上的另一类失败正是「两次写入交叠」的时序问题，纯函数测试看不见
// （与 offline-cache-race.test.ts 同一套替身约定，含结构化克隆语义）。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  urls: [] as string[],
  /** 让 fetch 模拟失败（网络不可达） */
  fail: false,
  /** 让 fetch 返回一个「有响应但没有可用字段」的 body */
  empty: false,
}))

vi.mock('@/lib/client/idb', () => ({
  idbGet: async (key: string) => {
    await Promise.resolve()
    const v = h.store.get(key)
    return v === undefined ? undefined : structuredClone(v)
  },
  idbSet: async (key: string, value: unknown) => {
    await Promise.resolve()
    h.store.set(key, structuredClone(value))
  },
  idbDelete: async (key: string) => { h.store.delete(key) },
  idbClearAll: async () => { h.store.clear() },
}))

vi.stubGlobal('fetch', async (url: string) => {
  h.urls.push(url)
  if (h.fail) throw new Error('network down')
  return {
    ok: true,
    json: async () => (h.empty ? null : { locality: '五华区', city: '昆明市' }),
  }
})

const { clientReverseGeocode, coarsenCoordinate, geocodeCacheKey } = await import('@/lib/client/geocode')

const CACHE_KEY = 'geo-cache'
function cachedMap(): Record<string, string> {
  return (h.store.get(CACHE_KEY) as Record<string, string> | undefined) ?? {}
}

// 昆明五华区一带的两个点，模糊后落在**同一个格子**（25.05, 102.68）
const A = { lat: 25.049642, lon: 102.676280 }
const B = { lat: 25.051111, lon: 102.677777 }
// 保山隆阳区，另一个格子
const C = { lat: 25.123456, lon: 99.155555 }

describe('G · 地名反查缓存', () => {
  beforeEach(() => {
    h.store.clear()
    h.urls.length = 0
    h.fail = false
    h.empty = false
  })

  it('G0 前置：A / B 模糊后确实同格，C 不同格（否则后面的比较会空转）', () => {
    expect(coarsenCoordinate(A.lat)).toBe(25.05)
    expect(coarsenCoordinate(A.lon)).toBe(102.68)
    expect(geocodeCacheKey(coarsenCoordinate(A.lat), coarsenCoordinate(A.lon)))
      .toBe(geocodeCacheKey(coarsenCoordinate(B.lat), coarsenCoordinate(B.lon)))
    expect(geocodeCacheKey(coarsenCoordinate(C.lat), coarsenCoordinate(C.lon)))
      .not.toBe(geocodeCacheKey(coarsenCoordinate(A.lat), coarsenCoordinate(A.lon)))
  })

  it('G1 同一格子的第二次调用不再打 API（命中缓存）', async () => {
    expect(await clientReverseGeocode(A.lat, A.lon)).toBe('五华区 昆明市')
    expect(h.urls.length).toBe(1)
    expect(await clientReverseGeocode(B.lat, B.lon)).toBe('五华区 昆明市')
    expect(h.urls.length, '同格子仍然打了第二次 API —— 缓存没命中').toBe(1)
  })

  it('G2 缓存键与请求参数严格同源（都用 coarsenCoordinate 后的坐标）', async () => {
    await clientReverseGeocode(A.lat, A.lon)
    const wantKey = geocodeCacheKey(coarsenCoordinate(A.lat), coarsenCoordinate(A.lon))
    expect(Object.keys(cachedMap())).toEqual([wantKey])
    // 请求 URL 里也必须带同一对（模糊后的）坐标：精确坐标永不外发
    expect(h.urls[0]).toContain(`latitude=${coarsenCoordinate(A.lat)}`)
    expect(h.urls[0]).toContain(`longitude=${coarsenCoordinate(A.lon)}`)
    expect(h.urls[0], '精确坐标被发出去了').not.toContain('25.049642')
  })

  it('G3 命中缓存时完全不打网络（离线也能补上地名）', async () => {
    await clientReverseGeocode(A.lat, A.lon)
    h.urls.length = 0
    h.fail = true // 之后网络完全不可达
    expect(await clientReverseGeocode(B.lat, B.lon)).toBe('五华区 昆明市')
    expect(h.urls.length, '断网了却还在尝试请求').toBe(0)
  })

  it('G4 失败结果**不进缓存**（否则一次抖动会把该格子永久标成「没有地名」）', async () => {
    // 有响应但没有可用字段 → 立即返回 null（不进入重试）
    h.empty = true
    expect(await clientReverseGeocode(A.lat, A.lon)).toBeNull()
    expect(cachedMap(), 'null 被写进了缓存').toEqual({})

    // 网络恢复后再查：必须仍然会去打 API，并能拿到结果
    h.empty = false
    expect(await clientReverseGeocode(A.lat, A.lon)).toBe('五华区 昆明市')
    expect(cachedMap()).toEqual({ '25.05,102.68': '五华区 昆明市' })
  })

  it('G5 并发写不同格子时不丢（读-改-写必须串行化）', async () => {
    await Promise.all([
      clientReverseGeocode(A.lat, A.lon),
      clientReverseGeocode(C.lat, C.lon),
    ])
    // 未串行化时后提交者用「自己读到的空快照」整表覆盖 ⇒ 先写的那个格子白查了
    expect(Object.keys(cachedMap()).sort()).toEqual(['25.05,102.68', '25.12,99.16'])
  })
})
