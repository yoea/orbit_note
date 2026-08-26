import { describe, expect, it } from 'vitest'
import { rateLimit } from '../lib/server/ratelimit'

describe('rateLimit 滑动窗口', () => {
  it('允许窗口内前 max 次', () => {
    for (let i = 0; i < 5; i++) expect(rateLimit('t1', 5, 1000)).toBe(true)
    expect(rateLimit('t1', 5, 1000)).toBe(false)
  })
  it('不同 key 独立计数', () => {
    for (let i = 0; i < 5; i++) rateLimit('t2a', 5, 1000)
    expect(rateLimit('t2b', 5, 1000)).toBe(true)
  })
  it('窗口过期后恢复', async () => {
    for (let i = 0; i < 5; i++) rateLimit('t3', 2, 50)
    await new Promise((r) => setTimeout(r, 80))
    expect(rateLimit('t3', 2, 50)).toBe(true)
  })
})
