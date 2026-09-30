// 守卫：结构化地名（省 / 市 / 区）的三个纯函数 + 展示口径唯一出口。
//
// 背景：反查接口（BigDataCloud）本来就**分级**返回（principalSubdivision / city / locality），
// 早先把它拼成一个「区 市」字符串是**有损**的——分不出「昆明」是市还是区，也没法按省/市筛选。
// 本次把地名拆成三级字段存在 diary_entries 上（location_province / city / district），
// 老字段 location_name 保留只为给老数据兜底展示。
//
// ★ 本文件钉住的两条最容易写错的地方：
//   1) 展示串必须是**大→小**（省 市 区）且**去重**——直辖市（上海市/北京市/重庆市）的
//      「省」与「市」同名，不去重会显示「上海市 上海市 黄浦区」；
//   2) PATCH body 里缺失的级必须**显式写 null**——否则「上次查到的区名」会在一次只查到
//      市级结果的补写中残留，变成张冠李戴（换了城市却还挂着旧区名）。
//
// 与 tests/search.test.ts 的分工：那边测「按地名筛选的结果是否准确」，这边只测
// 「一条记录的地名怎么解释与怎么写出」，两边共用同一份实现（lib/client/location.ts）。
import { describe, expect, it } from 'vitest'
import {
  displayLocationName,
  formatLocationName,
  hasStructuredLocation,
  locationParts,
  locationPatch,
} from '@/lib/client/location'
import { partsFromBdc } from '@/lib/client/geocode'

/** 只带地名四项的最小条目（displayLocationName 的入参形状） */
function place(patch: Partial<{
  locationProvince: string | null
  locationCity: string | null
  locationDistrict: string | null
  locationName: string | null
}> = {}) {
  return {
    locationProvince: null,
    locationCity: null,
    locationDistrict: null,
    locationName: null,
    ...patch,
  }
}

describe('L · 结构化地名', () => {
  it('L0 前置：三级齐全时 locationParts 与 fields 同源（防后面的断言空转）', () => {
    const e = place({ locationProvince: '云南省', locationCity: '昆明市', locationDistrict: '五华区' })
    expect(locationParts(e)).toEqual({ province: '云南省', city: '昆明市', district: '五华区' })
  })

  it('L1 展示串是大→小（省 市 区），不是反查接口返回顺序', () => {
    expect(formatLocationName({ province: '云南省', city: '昆明市', district: '五华区' }))
      .toBe('云南省 昆明市 五华区')
  })

  it('L2 直辖市「省 = 市」必须去重（否则「上海市 上海市 黄浦区」）', () => {
    expect(formatLocationName({ province: '上海市', city: '上海市', district: '黄浦区' }))
      .toBe('上海市 黄浦区')
  })

  it('L3 缺级跳过：空的与只有空白的都当不存在', () => {
    expect(formatLocationName({ province: null, city: '昆明市', district: '五华区' })).toBe('昆明市 五华区')
    expect(formatLocationName({ province: '云南省', city: null, district: null })).toBe('云南省')
    expect(formatLocationName({ province: '  ', city: ' 昆明市 ', district: '' })).toBe('昆明市')
  })

  it('L4 三级全空 → null（调用方据此退回显示坐标，而不是显示空串）', () => {
    expect(formatLocationName({ province: null, city: null, district: null })).toBeNull()
    expect(formatLocationName({ province: '', city: '   ', district: '' })).toBeNull()
  })

  it('L5 结构性判断：任一级有值即为「有结构化地名」（决定要不要重新反查）', () => {
    expect(hasStructuredLocation(place())).toBe(false)
    expect(hasStructuredLocation(place({ locationProvince: '云南省' }))).toBe(true)
    expect(hasStructuredLocation(place({ locationDistrict: '五华区' }))).toBe(true)
    // 只有老串不算「有结构化」——老串里分不出分级，必须重新反查
    expect(hasStructuredLocation(place({ locationName: '五华区 昆明市' }))).toBe(false)
  })

  it('L6 展示口径：结构化优先，老数据回退到单一串', () => {
    expect(displayLocationName(place({
      locationProvince: '云南省', locationCity: '昆明市', locationDistrict: '五华区',
      locationName: '五华区 昆明市', // 老串还在也不该被用上
    }))).toBe('云南省 昆明市 五华区')
    // 老数据（本功能上线前）：只有单一串
    expect(displayLocationName(place({ locationName: '五华区 昆明市' }))).toBe('五华区 昆明市')
    expect(displayLocationName(place())).toBeNull()
  })

  it('L7 PATCH body：缺失的级**显式写 null**（防旧区名残留成张冠李戴）', () => {
    // 换到只查到市级的地方：区必须先被清掉，否则「西山区」会跟着新城市一起留下来
    const patch = locationPatch({ province: '四川省', city: '成都市', district: null })
    expect(patch).toEqual({ locationProvince: '四川省', locationCity: '成都市', locationDistrict: null })
    expect(Object.keys(patch).sort()).toEqual(['locationCity', 'locationDistrict', 'locationProvince'])
    expect('locationName' in patch, 'PATCH 不该再写老串——服务端会据结构化三级把它清空').toBe(false)
  })

  it('L8 反查结果映射：principalSubdivision→省、city→市、locality→区；全空→null', () => {
    expect(partsFromBdc({ principalSubdivision: '云南省', city: '昆明市', locality: '五华区' }))
      .toEqual({ province: '云南省', city: '昆明市', district: '五华区' })
    // 直辖市：BDC 的 city 与 principalSubdivision 同为「上海市」
    expect(partsFromBdc({ principalSubdivision: '上海市', city: '上海市', locality: '黄浦区' }))
      .toEqual({ province: '上海市', city: '上海市', district: '黄浦区' })
    expect(partsFromBdc({})).toBeNull()
    expect(partsFromBdc(null)).toBeNull()
    expect(partsFromBdc(undefined)).toBeNull()
    // 只有空白字符 = 没有值（不能落成空串，否则 hasStructuredLocation 会误判为「有」）
    expect(partsFromBdc({ principalSubdivision: '   ' })).toBeNull()
    expect(partsFromBdc({ city: '   ' })).toBeNull()
    // 有值的那一级被 trim 过（接口偶尔带回首尾空格）
    expect(partsFromBdc({ city: '  昆明市  ' })).toEqual({ province: null, city: '昆明市', district: null })
  })

  it('L9 反查结果直接喂给 PATCH body 时字段名对得上（端到端的一小段）', () => {
    const parts = partsFromBdc({ principalSubdivision: '云南省', city: '昆明市', locality: '五华区' })
    expect(locationPatch(parts!)).toEqual({
      locationProvince: '云南省',
      locationCity: '昆明市',
      locationDistrict: '五华区',
    })
  })
})
