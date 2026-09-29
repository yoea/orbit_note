import { describe, expect, it } from 'vitest'
import { mergeEntriesById, queuedToEntry, remainingAfterFlush, staleCachedIds, unionWithPending } from '@/lib/client/offline'
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

describe('queuedToEntry（队列项 → 条目形态）', () => {
  it('字段映射：createdAt/updatedAt 取 queuedAt，定位/天气为 null', () => {
    const e = queuedToEntry({ id: 'u1', ciphertext: 'ct', iv: 'iv', wordCount: 12, timezone: 'Asia/Shanghai', queuedAt: Date.UTC(2026, 8, 29, 1, 2, 3) })
    expect(e.id).toBe('u1')
    expect(e.ciphertext).toBe('ct')
    expect(e.iv).toBe('iv')
    expect(e.wordCount).toBe(12)
    expect(e.timezone).toBe('Asia/Shanghai')
    expect(e.createdAt).toBe(new Date(Date.UTC(2026, 8, 29, 1, 2, 3)).toISOString())
    expect(e.updatedAt).toBe(e.createdAt)
    expect(e.latitude).toBeNull()
    expect(e.longitude).toBeNull()
    expect(e.locationName).toBeNull()
    expect(e.weather).toBeNull()
  })

  it('可直接并入列表数据流（与 EncryptedEntry 同构，解密路径无需分支）', () => {
    const e = queuedToEntry({ id: 'u2', ciphertext: 'ct', iv: 'iv', wordCount: 1, timezone: null, queuedAt: 0 })
    const merged = mergeEntriesById([entry('a', '2026-01-01')], [e])
    expect(merged.map((x) => x.id).sort()).toEqual(['a', 'u2'])
  })
})

describe('staleCachedIds（服务器为真：缓存里已删条目的判定）', () => {
  const cached = [
    entry('a', '2026-09-29T10:00:00.000Z'),
    entry('c', '2026-09-29T09:30:00.000Z'), // 卡在本页窗口内、但服务器没返回 ⇒ 已删除
    entry('b', '2026-09-29T09:00:00.000Z'),
    entry('d', '2026-09-20T08:00:00.000Z'), // 更旧（本页窗口之外）
  ]

  it('窗口内不在本页 ⇒ 已删除（c 在 b 与 a 之间但服务器没返回）', () => {
    const page = [entry('a', '2026-09-29T10:00:00.000Z'), entry('b', '2026-09-29T09:00:00.000Z')]
    expect(staleCachedIds(cached, page, { isFirstPage: false, isLastPage: false })).toEqual(['c'])
  })

  it('首页 ⇒ 比服务器最新还新的也是已删除（删掉最新那条的常见情形）', () => {
    const page = [entry('b', '2026-09-29T09:00:00.000Z')] // 服务器最新 = b，a/c 都比它新 ⇒ 已删
    expect(staleCachedIds(cached, page, { isFirstPage: true, isLastPage: false }).sort()).toEqual(['a', 'c'])
  })

  it('末页 ⇒ 比本页最旧还旧的也算已删除', () => {
    const page = [entry('a', '2026-09-29T10:00:00.000Z'), entry('b', '2026-09-29T09:00:00.000Z')]
    expect(staleCachedIds(cached, page, { isFirstPage: true, isLastPage: true }).sort()).toEqual(['c', 'd'])
  })

  it('窗口之外的保留（非首页非末页不做越界判断——更旧/更新的留给其它分页）', () => {
    const page = [entry('b', '2026-09-29T09:00:00.000Z')]
    expect(staleCachedIds(cached, page, { isFirstPage: false, isLastPage: false })).toEqual([])
  })

  it('空页不作为证据（异常空响应不得清空缓存）', () => {
    expect(staleCachedIds(cached, [], { isFirstPage: true, isLastPage: true })).toEqual([])
  })

  it('服务器仍有的条目不判为删除', () => {
    const page = [entry('c', '2026-09-29T09:30:00.000Z'), entry('b', '2026-09-29T09:00:00.000Z')]
    expect(staleCachedIds(cached, page, { isFirstPage: false, isLastPage: false })).toEqual([])
  })
})

describe('unionWithPending（列表数据源 = 服务器真值 ∪ 未同步队列）', () => {
  it('队列条目并进列表（离线刚写的笔记在线也可见）', () => {
    const server = [entry('s1', '2026-09-29T08:00:00.000Z')]
    const queued = [entry('q1', '2026-09-29T09:00:00.000Z')]
    expect(unionWithPending(server, queued).map((e) => e.id)).toEqual(['q1', 's1']) // 新的在前
  })

  it('同 id 以服务器为准（冲刷已成功、队列未清空的竞态）', () => {
    const server = [entry('same', '2026-09-29T08:00:00.000Z')]
    const queued = [{ ...entry('same', '2026-09-29T07:00:00.000Z'), ciphertext: 'queued-ct' }]
    const merged = unionWithPending(server, queued)
    expect(merged).toHaveLength(1)
    expect(merged[0].ciphertext).toBe('ct-same') // 服务器那份
  })

  it('空队列 = 原列表；空服务器 = 队列', () => {
    const server = [entry('s1', '2026-09-29T08:00:00.000Z')]
    expect(unionWithPending(server, [])).toEqual(server)
    const queued = [entry('q1', '2026-09-29T09:00:00.000Z')]
    expect(unionWithPending([], queued)).toEqual(queued)
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
