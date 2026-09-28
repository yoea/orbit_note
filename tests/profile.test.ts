import { describe, expect, it } from 'vitest'
import { USER_NAME_MAX, generateDefaultName } from '@/lib/client/profile'

describe('generateDefaultName', () => {
  it('格式为 Orbit_ + 3 位十六进制（与设置页默认名约定一致）', () => {
    for (let i = 0; i < 30; i++) {
      expect(generateDefaultName()).toMatch(/^Orbit_[0-9a-f]{3}$/)
    }
  })

  it('长度不超过上限（保证设置页与统计行布局不被撑破）', () => {
    expect(generateDefaultName().length).toBeLessThanOrEqual(USER_NAME_MAX)
  })

  it('不同调用产生不同后缀（至少不是常量）', () => {
    const names = new Set(Array.from({ length: 30 }, () => generateDefaultName()))
    expect(names.size).toBeGreaterThan(1)
  })
})
