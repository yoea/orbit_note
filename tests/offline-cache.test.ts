import { describe, expect, it } from 'vitest'
import { mergeEntriesById, remainingAfterFlush } from '@/lib/client/offline'
import { diaryCreateSchema } from '@/lib/server/validation'
import type { EncryptedEntry } from '@/lib/client/entries'

// 离线缓存与写队列的纯函数逻辑（idb 相关路径由组件集成行为覆盖）
// E2EE 提醒：缓存里只有密文——测试数据同样只造密文字段。

function entry(id: string, createdAt: string): EncryptedEntry {
  return { id, ciphertext: `ct-${id}`, iv: `iv-${id}`, createdAt, updatedAt: createdAt, wordCount: 1, latitude: null, longitude: null, locationAccuracy: null, locationName: null, weather: null, timezone: null }
}

describe('mergeEntriesById（缓存合并）', () => {
  it('同 id 后写覆盖（详情页单条缓存刷新列表里的旧版）', () => {
    const merged = mergeEntriesById(
      [entry('a', '2026-01-01'), entry('b', '2026-01-02')],
      [entry('a', '2026-02-01')],
    )
    expect(merged).toHaveLength(2)
    expect(merged.find((e) => e.id === 'a')?.createdAt).toBe('2026-02-01')
  })

  it('新 id 追加、不丢既有条目', () => {
    const merged = mergeEntriesById([entry('a', '2026-01-01')], [entry('c', '2026-03-01')])
    expect(merged.map((e) => e.id).sort()).toEqual(['a', 'c'])
  })

  it('空缓存 / 空输入', () => {
    expect(mergeEntriesById([], [entry('x', '2026-01-01')])).toHaveLength(1)
    expect(mergeEntriesById([entry('x', '2026-01-01')], [])).toHaveLength(1)
    expect(mergeEntriesById([], [])).toEqual([])
  })
})

describe('remainingAfterFlush（队列冲刷保留决策）', () => {
  const q = [
    { id: '1', ciphertext: 'a', iv: 'a', wordCount: 1, timezone: null, queuedAt: 1 },
    { id: '2', ciphertext: 'b', iv: 'b', wordCount: 1, timezone: null, queuedAt: 2 },
    { id: '3', ciphertext: 'c', iv: 'c', wordCount: 1, timezone: null, queuedAt: 3 },
  ]

  it('全部确认 → 队列清空', () => {
    expect(remainingAfterFlush(q, new Set(['1', '2', '3']), -1)).toEqual([])
  })

  it('部分确认 → 只剔除已确认的', () => {
    expect(remainingAfterFlush(q, new Set(['2']), -1).map((x) => x.id)).toEqual(['1', '3'])
  })

  it('中途停止（401/网络错误）→ 从停止处整段保留（含其后未尝试的）', () => {
    expect(remainingAfterFlush(q, new Set(['1']), 1).map((x) => x.id)).toEqual(['2', '3'])
  })

  it('停止且无确认 → 原样保留', () => {
    expect(remainingAfterFlush(q, new Set(), 0)).toEqual(q)
  })
})

describe('diaryCreateSchema 客户端 id（离线幂等）', () => {
  const base = { ciphertext: 'x', iv: 'y' }

  it('接受合法 UUID，缺省仍可选', () => {
    expect(diaryCreateSchema.safeParse(base).success).toBe(true)
    expect(diaryCreateSchema.safeParse({ ...base, id: '3f7a7c8e-1d2b-4e5f-9a8b-c0d1e2f3a4b5' }).success).toBe(true)
  })

  it('拒绝非 UUID 的 id（防伪造任意主键）', () => {
    expect(diaryCreateSchema.safeParse({ ...base, id: 'not-a-uuid' }).success).toBe(false)
    expect(diaryCreateSchema.safeParse({ ...base, id: '12345' }).success).toBe(false)
  })

  it('仍拒绝未知键（created_at 等不可由客户端指定）', () => {
    expect(diaryCreateSchema.safeParse({ ...base, createdAt: '2026-01-01' }).success).toBe(false)
    expect(diaryCreateSchema.safeParse({ ...base, updatedAt: '2026-01-01' }).success).toBe(false)
  })
})
