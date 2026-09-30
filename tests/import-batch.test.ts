// 分批逻辑的守卫测试。
//
// 这段代码决定"一次请求发多少条"，写错的两种后果都很难查：
// 分批过大 → 反代 413；单条超限时若忘了自成一批 → 死循环/丢条目。
import { describe, expect, it } from 'vitest'
import { batchByBytes } from '@/lib/client/import'

const items = (bytes: number[]) => bytes.map((b, i) => ({ bytes: b, i }))

describe('batchByBytes', () => {
  it('按累计字节切批（不超上限）', () => {
    const out = batchByBytes(items([100, 100, 100, 100]), 250, 100)
    expect(out.map((b) => b.length)).toEqual([2, 2])
    for (const b of out) expect(b.reduce((s, x) => s + x.bytes, 0)).toBeLessThanOrEqual(250)
  })

  it('按条数切批', () => {
    const out = batchByBytes(items([1, 1, 1, 1, 1]), 1_000_000, 2)
    expect(out.map((b) => b.length)).toEqual([2, 2, 1])
  })

  it('单条就超过上限时自成一批（否则会卡死或丢条目）', () => {
    const out = batchByBytes(items([10, 9999, 10]), 500, 50)
    expect(out.map((b) => b.map((x) => x.i))).toEqual([[0], [1], [2]])
  })

  it('保持原顺序', () => {
    const out = batchByBytes(items([1, 1, 1, 1, 1, 1]), 2, 100)
    expect(out.flat().map((x) => x.i)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('空输入返回空数组（不要发一个空请求）', () => {
    expect(batchByBytes([])).toEqual([])
  })

  it('刚好等于上限时不提前切批', () => {
    expect(batchByBytes(items([250, 250]), 250, 100).map((b) => b.length)).toEqual([1, 1])
    expect(batchByBytes(items([200, 50]), 250, 100).map((b) => b.length)).toEqual([2])
  })
})
