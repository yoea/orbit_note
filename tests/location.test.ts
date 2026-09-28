import { describe, expect, it } from 'vitest'
import { parseCoords } from '@/lib/client/location'
import { coarsenCoordinate } from '@/lib/client/geocode'

describe('parseCoords', () => {
  it('解析标准坐标（逗号 + 空格）', () => {
    expect(parseCoords('25.049642, 102.676280')).toEqual({ latitude: 25.049642, longitude: 102.676280 })
  })

  it('逗号后无空格同样可解析', () => {
    expect(parseCoords('25.049642,102.676280')).toEqual({ latitude: 25.049642, longitude: 102.676280 })
  })

  it('支持中文全角逗号与多余空格', () => {
    expect(parseCoords('  25.049642 ，  102.676280  ')).toEqual({ latitude: 25.049642, longitude: 102.676280 })
  })

  it('支持负坐标（南纬 / 西经）', () => {
    expect(parseCoords('-33.868820, 151.209290')).toEqual({ latitude: -33.868820, longitude: 151.209290 })
  })

  it('支持整数坐标', () => {
    expect(parseCoords('25, 102')).toEqual({ latitude: 25, longitude: 102 })
  })

  it('格式非法返回 null', () => {
    expect(parseCoords('')).toBeNull()
    expect(parseCoords('25.049642')).toBeNull() // 只有一个数
    expect(parseCoords('abc, 102')).toBeNull()
    expect(parseCoords('25.049642, 102.676280, 3')).toBeNull() // 三个数
    expect(parseCoords('25.049642; 102.676280')).toBeNull() // 分隔符错误
  })

  it('超出经纬度范围返回 null', () => {
    expect(parseCoords('91, 102')).toBeNull()
    expect(parseCoords('-91, 102')).toBeNull()
    expect(parseCoords('25, 181')).toBeNull()
    expect(parseCoords('25, -181')).toBeNull()
  })

  it('边界值合法', () => {
    expect(parseCoords('90, 180')).toEqual({ latitude: 90, longitude: 180 })
    expect(parseCoords('-90, -180')).toEqual({ latitude: -90, longitude: -180 })
  })
})

describe('coarsenCoordinate', () => {
  it('默认降到 2 位小数（约 1km 粒度）', () => {
    expect(coarsenCoordinate(25.049642)).toBe(25.05)
    expect(coarsenCoordinate(102.676280)).toBe(102.68)
  })

  it('负坐标同样正确取整', () => {
    expect(coarsenCoordinate(-33.868820)).toBe(-33.87)
    expect(coarsenCoordinate(-151.209290)).toBe(-151.21)
  })

  it('-0 归一为 0（避免 URL 出现 "-0.00"）', () => {
    expect(Object.is(coarsenCoordinate(-0.001), 0)).toBe(true)
  })

  it('整数与 0 保持原值', () => {
    expect(coarsenCoordinate(0)).toBe(0)
    expect(coarsenCoordinate(25)).toBe(25)
  })

  it('可指定精度', () => {
    expect(coarsenCoordinate(25.049642, 0)).toBe(25)
    expect(coarsenCoordinate(25.049642, 3)).toBe(25.05)
    expect(coarsenCoordinate(25.049642, 4)).toBe(25.0496)
  })
})
