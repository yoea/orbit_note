import { describe, expect, it } from 'vitest'
import { dayEndIso, dayKeyOf, jumpDayLabel, monthGrid, monthTitle, parseDayKey, shiftMonth } from '@/lib/client/date-jump'

// 日期跳转纯函数。跨月补位 / 闰年 / 跨年 / 非法输入是日历最容易错的地方，
// 这里全部用枚举边界钉住（组件里测不了）。
describe('D1 dayKeyOf / parseDayKey', () => {
  it('D1-1 本地时区归日，月/日补零', () => {
    expect(dayKeyOf(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(dayKeyOf(new Date(2026, 11, 31))).toBe('2026-12-31')
    // 深夜 23:59 仍属于当天（若误用 toISOString 会跑到次日）
    expect(dayKeyOf(new Date(2026, 8, 2, 23, 59))).toBe('2026-09-02')
    expect(dayKeyOf(new Date(2026, 8, 2, 0, 0))).toBe('2026-09-02')
  })

  it('D1-2 非法 key 一律 null（含「看起来合法但不存在的日期」）', () => {
    expect(parseDayKey('2026-02-30')).toBeNull() // 会静默滚成 3月2日，必须回验
    expect(parseDayKey('2026-13-01')).toBeNull()
    expect(parseDayKey('2026-1-1')).toBeNull() // 未补零
    expect(parseDayKey('abc')).toBeNull()
    expect(parseDayKey('')).toBeNull()
    expect(parseDayKey('2026-09-02T00:00:00')).toBeNull() // 只吃纯日期
  })

  it('D1-3 合法 key 解析成本地零点', () => {
    const d = parseDayKey('2026-09-02')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(8)
    expect(d!.getDate()).toBe(2)
    expect(d!.getHours()).toBe(0)
  })
})

describe('D2 dayEndIso（锚定查询边界）', () => {
  it('D2-1 取本地当天 23:59:59.999 的 ISO 串', () => {
    expect(dayEndIso('2026-09-02')).toBe(new Date(2026, 8, 2, 23, 59, 59, 999).toISOString())
  })

  it('D2-2 非法 key 返回 null（调用方据此拒绝跳转，不发请求）', () => {
    expect(dayEndIso('2026-02-30')).toBeNull()
    expect(dayEndIso('2026-09-02x')).toBeNull()
  })
})

describe('D3 monthGrid（月历网格）', () => {
  it('D3-1 固定 6 行 × 7 列（高度不随月份跳动）', () => {
    for (const [y, m] of [[2026, 9], [2026, 2], [2024, 2], [2025, 12]] as const) {
      const grid = monthGrid(y, m)
      expect(grid, `${y}-${m} 必须是 6 行`).toHaveLength(6)
      for (const row of grid) expect(row).toHaveLength(7)
    }
  })

  it('D3-2 周一为首列：2026年9月1日是周二 ⇒ 首格为 null；2025年12月1日是周一 ⇒ 首格即当天', () => {
    const sep = monthGrid(2026, 9)
    expect(sep[0][0]).toBeNull()
    expect(sep[0][1]).toBe('2026-09-01')
    expect(sep[0][6]).toBe('2026-09-06') // 周日收尾
    const dec = monthGrid(2025, 12)
    expect(dec[0][0]).toBe('2025-12-01')
  })

  it('D3-3 本月每一天恰好出现一次，且不含相邻月份的日期', () => {
    const grid = monthGrid(2026, 9)
    const days = grid.flat().filter((c): c is string => c !== null)
    expect(days).toHaveLength(30)
    expect(new Set(days).size).toBe(30)
    expect(days[0]).toBe('2026-09-01')
    expect(days[days.length - 1]).toBe('2026-09-30')
    for (const d of days) expect(d.startsWith('2026-09-')).toBe(true)
    // 补位只能是 null，绝不能出现 8月31日 这种相邻月日期
    expect(grid.flat().some((c) => c !== null && !c.startsWith('2026-09-'))).toBe(false)
  })

  it('D3-4 闰年 2 月含 29 日（平年不含）', () => {
    const leap = monthGrid(2024, 2).flat().filter((c): c is string => c !== null)
    expect(leap).toHaveLength(29)
    expect(leap).toContain('2024-02-29')
    const plain = monthGrid(2026, 2).flat().filter((c): c is string => c !== null)
    expect(plain).toHaveLength(28)
    expect(plain).not.toContain('2026-02-29')
  })
})

describe('D4 shiftMonth / 文案', () => {
  it('D4-1 跨年进位与借位', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
    expect(shiftMonth(2026, 1, -13)).toEqual({ year: 2024, month: 12 })
    expect(shiftMonth(2026, 6, 12)).toEqual({ year: 2027, month: 6 })
    expect(shiftMonth(2026, 6, 0)).toEqual({ year: 2026, month: 6 })
  })

  it('D4-2 monthTitle', () => {
    expect(monthTitle(2026, 9)).toBe('2026年9月')
    expect(monthTitle(2026, 12)).toBe('2026年12月')
  })

  it('D4-3 jumpDayLabel：今天 / 同年省年 / 跨年带年', () => {
    expect(jumpDayLabel('2026-10-02', '2026-10-02')).toBe('今天')
    expect(jumpDayLabel('2026-09-02', '2026-10-02')).toBe('9月2日')
    expect(jumpDayLabel('2025-09-02', '2026-10-02')).toBe('2025年9月2日')
    // 非法 key 原样返回，不抛错（避免一处脏数据把整页打崩）
    expect(jumpDayLabel('bad', '2026-10-02')).toBe('bad')
  })
})
