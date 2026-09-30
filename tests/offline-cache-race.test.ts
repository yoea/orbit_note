// 守卫：离线缓存的**完整性**——即「离线点开一篇笔记能不能读到」的前提。
//
// 背景（2026-09-30 用户反馈「离线模式偶尔点击列表中的部分笔记无反应、无法查看」）：
// 列表只保存派生后的元信息（标题/预览/字数），**不带密文**；离线点开详情时必须在本地
// 缓存里按 id 取密文（`getCachedEntryById` / `getQueuedEntryById`）。
// 因此有一条必须成立的不变量：
//
//   ★ 「列表里能看到的每一条」都必须能在本地（密文缓存 ∪ 未同步队列）里按 id 解析出来。
//
// 这条不变量此前会被两类并发写破坏（本文件的 R1/R2 就是它们的回归哨兵）：
//   · cacheEntriesPage / pruneCachedEntries / removeCachedEntry 全是「读-改-写」，
//     而调用方清一色 `void ...` 不等待 ⇒ 两个 RMW 交叠时，后提交的那次用旧快照整表覆盖，
//     抹掉另一次刚写进去的条目（丢失更新）。
//   · 列表页曾用 `void cacheEntriesPage(server)`：列表已经渲染出条目，而密文还没落库；
//     此时断网（或 iOS 把页面挂起、写入再也没提交）点开它，本地自然找不到。
//
// 这一层判定与正文格式**完全无关**：缓存里存的是密文（字节与服务器一致），
// 解密与 Markdown 渲染都在客户端完成，不依赖网络也不依赖任何解析结果。
// 所以「在线用 markdown 写的笔记，离线打不开」在数据链路上不成立（见 R4 的源码断言）。
//
// 本文件用内存版 idb 替身（vi.mock），因为真机上的失败正是「两次写入交叠」的时序问题——
// 纯函数测试看不见它。真 idb 的行为（事务串行、结构化克隆）在这里只取我们依赖的部分：
// 每次读写都是异步的、写入覆盖整个值。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { entryFixture, queuedFixture } from './entry-fixture'

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  /** 记录写入顺序，便于断言「谁把谁覆盖了」 */
  log: [] as string[],
}))

vi.mock('@/lib/client/idb', () => ({
  // 结构化克隆语义：真 idb 存取的是副本，测试替身不能把引用直接交出去
  idbGet: async (key: string) => {
    await Promise.resolve()
    const v = h.store.get(key)
    return v === undefined ? undefined : structuredClone(v)
  },
  idbSet: async (key: string, value: unknown) => {
    await Promise.resolve()
    h.store.set(key, structuredClone(value))
    h.log.push(key)
  },
  idbDelete: async (key: string) => { h.store.delete(key) },
  idbClearAll: async () => { h.store.clear() },
}))

const {
  cacheEntriesPage, enqueueOfflineEntry, getCachedEntries, getCachedEntryById,
  getQueuedEntries, getQueuedEntryById, pruneCachedEntries, removeCachedEntry, unionWithPending,
} = await import('@/lib/client/offline')

// E2EE 提醒：测试数据也只造密文字段（缓存里本来就只有密文）。
// 全字段默认值走 tests/entry-fixture.ts，避免每次给 diary_entries 加列都要回来补字面量。
function e(id: string, createdAt: string) {
  return entryFixture({ id, ciphertext: `ct-${id}`, iv: `iv-${id}`, createdAt, updatedAt: createdAt })
}

async function cachedIds(): Promise<string[]> {
  return (await getCachedEntries()).map((x) => x.id).sort()
}

describe('R · 缓存写入的并发完整性', () => {
  beforeEach(() => {
    h.store.clear()
    h.log.length = 0
  })

  it('R1 并发的两次 cacheEntriesPage 都要留住（分页/详情页会同时写缓存）', async () => {
    await Promise.all([
      cacheEntriesPage([e('a', '2026-09-01T00:00:00.000Z')]),
      cacheEntriesPage([e('b', '2026-09-02T00:00:00.000Z')]),
    ])
    // 未串行化时后一次写入会用「自己读到的空快照」覆盖 ⇒ 丢一条（离线点开就是没反应）
    expect(await cachedIds()).toEqual(['a', 'b'])
  })

  it('R2 prune 与 cache 并发时，新条目不被子集化的旧快照抹掉', async () => {
    const dead = e('dead', '2020-01-01T00:00:00.000Z') // 服务器早已删掉的残留
    const mid = e('mid', '2026-09-01T00:00:00.000Z') // 末页里的条目（服务器最旧的一批）
    const newest = e('newest', '2026-09-30T00:00:00.000Z') // 并发写入的新条目
    await cacheEntriesPage([dead, mid])
    h.log.length = 0

    // 末页（服务器最旧的一批）判定 dead 已被删除；同时另一处刚写完一条新条目
    // （详情页的单条缓存、队列冲刷后的回写、或另一次分页——都是真实存在的并发写）
    await Promise.all([
      cacheEntriesPage([newest]),
      pruneCachedEntries([mid], { isFirstPage: false, isLastPage: true }),
    ])

    const ids = await cachedIds()
    expect(ids, 'newest 被 prune 的旧快照抹掉了 ⇒ 刚写进缓存的那条离线读不到').toContain('newest')
    expect(ids, '已删除的残留没有被清掉（prune 应当生效）').not.toContain('dead')
  })

  it('R3 removeCachedEntry 与 cache 并发时不丢新条目（删除单条与分页同时发生）', async () => {
    await cacheEntriesPage([e('x', '2026-09-01T00:00:00.000Z')])
    await Promise.all([
      removeCachedEntry('x'),
      cacheEntriesPage([e('y', '2026-09-02T00:00:00.000Z')]),
    ])
    expect(await cachedIds()).toEqual(['y'])
  })

  it('R4 不变量：缓存 ∪ 队列里的每一条都能按 id 解析出密文（= 离线可读）', async () => {
    await cacheEntriesPage([
      e('s1', '2026-09-01T00:00:00.000Z'),
      e('s2', '2026-09-02T00:00:00.000Z'),
    ])
    await enqueueOfflineEntry(queuedFixture({ id: 'q1', ciphertext: 'ct-q1', iv: 'iv-q1', wordCount: 3, queuedAt: Date.UTC(2026, 8, 30) }))

    // 列表的数据源（离线分支）：缓存 ∪ 队列
    const list = unionWithPending(await getCachedEntries(), await getQueuedEntries())
    expect(list.map((x) => x.id)).toHaveLength(3)

    for (const item of list) {
      const found = (await getCachedEntryById(item.id)) ?? (await getQueuedEntryById(item.id))
      expect(found, `列表里的 ${item.id} 在本地按 id 取不到 —— 离线点开它就是「点击没反应」`).not.toBeNull()
      expect(found?.ciphertext).toBe(item.ciphertext)
    }
  })

  it('R3b 空缓存 / 空输入时三个写函数都不抛错（幂等，可被无脑调用）', async () => {
    await expect(cacheEntriesPage([])).resolves.toBeUndefined()
    await expect(pruneCachedEntries([], { isFirstPage: true, isLastPage: true })).resolves.toBeUndefined()
    await expect(removeCachedEntry('nope')).resolves.toBeUndefined()
    expect(await cachedIds()).toEqual([])
  })
})
