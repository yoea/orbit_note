// 守卫：本地「打开次数」计数。
//
// 语义提醒（见 lib/client/views.ts）：这个数字是「**我自己**打开这一篇看过几次」，
// 纯本地、不上传。所以本文件只钉两件事，都不涉及隐私面：
//   1. 计数正确且**并发不丢**（React 开发模式双挂载 effect、多标签页同时打开都要算对）；
//   2. 有上限，不会无限增长；
//   3. 它**不随导出 / 导入往返**——备份只含数据库字段（见文末说明）。
//
// 与 offline-cache-race.test.ts 用同一套内存 idb 替身（含结构化克隆语义）：
// 真机上的失败是「两次读-改-写交叠」，只有带时序的替身才看得见。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ store: new Map<string, unknown>() }))

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

const { bumpEntryViewCount, getEntryViewCount } = await import('@/lib/client/views')

const KEY = 'entry-views'
function map(): Record<string, number> {
  return (h.store.get(KEY) as Record<string, number> | undefined) ?? {}
}

describe('V · 本地打开次数', () => {
  beforeEach(() => { h.store.clear() })

  it('V0 前置：空库读出 0，第一次 +1 得 1（否则下面的断言会空转）', async () => {
    expect(await getEntryViewCount('e1')).toBe(0)
    expect(await bumpEntryViewCount('e1')).toBe(1)
    expect(await getEntryViewCount('e1')).toBe(1)
  })

  it('V1 连续打开累计，且不同笔记互不干扰', async () => {
    await bumpEntryViewCount('e1')
    await bumpEntryViewCount('e1')
    expect(await bumpEntryViewCount('e1')).toBe(3)
    await bumpEntryViewCount('e2')
    expect(await getEntryViewCount('e2')).toBe(1)
    expect(await getEntryViewCount('e1')).toBe(3)
  })

  it('V2 并发的 +1 一次都不能丢（读-改-写必须串行化）', async () => {
    // 真实触发：StrictMode 双挂载 effect、或两个标签页同时打开同一篇
    await Promise.all(Array.from({ length: 5 }, () => bumpEntryViewCount('e1')))
    expect(await getEntryViewCount('e1'), '有几次 +1 被旧快照覆盖掉了').toBe(5)
  })

  it('V3 并发写不同笔记时互不覆盖', async () => {
    await Promise.all([
      bumpEntryViewCount('e1'),
      bumpEntryViewCount('e2'),
      bumpEntryViewCount('e3'),
    ])
    expect(Object.keys(map()).sort()).toEqual(['e1', 'e2', 'e3'])
  })

  it('V4 有上限：超过 500 条只保留最近打开的（防无限增长）', async () => {
    for (let i = 0; i < 501; i++) await bumpEntryViewCount(`e${i}`)
    const keys = Object.keys(map())
    expect(keys.length).toBe(500)
    expect(keys, '最早的记录没被裁掉').not.toContain('e0')
    expect(keys, '最新的记录被裁掉了').toContain('e500')
  })
})

// 打开次数**不随导出 / 导入往返**（2026-09-30）：它跨设备不准确，写进备份只会误导恢复。
// 原先这里守的「导出 / 恢复两个出入口」（V5~V10）已随 views.ts 里那两个函数一起撤下，
// 本文件现在只守纯本机的计数行为（V0~V4）。
