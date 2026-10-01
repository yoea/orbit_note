// 守卫：查看页「打开次数」的计数模块（lib/client/views.ts）。
//
// 语义：这个数字是「**我自己**打开这一篇看过几次」，不是「被谁看过几次」。
//
// ★ 2026-09-30 的语义反转（改这里之前先读）：
//   它原先是**纯本机** IndexedDB 计数，且刻意不进导出（跨设备不准确）。用户要求改为入库，
//   于是它成了 diary_entries 的一列（migration 0014），并**重新纳入**导出（FORMAT_VERSION 5）。
//   本文件当时守的 V0~V4（本地累计 / 并发不丢 / 上限 500）已整体作废——那些不变量现在由
//   数据库承担（服务器端原子自增），客户端只剩「发一次请求、容错、别抛」。
//
// 现在钉三件事：
//   1. 只走 `POST /api/diary/[id]/view` —— 不许退回本机计数，也不许让客户端提交**绝对值**
//      （那会遇到多标签页「读旧值再写回」的丢失更新，客户端也能凭空篡改统计）；
//   2. 失败（离线 / 限流 / 404 / 畸形响应）一律返回 **null 且不抛** —— 计数绝不能影响阅读；
//   3. `null`（这次没数成）与「viewCount 为 0 的条目」（服务器说就是 0 次）是**不同**的两件事，
//      调用方（EntryView）据此决定要不要覆盖界面上已有的数字。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { entryFixture } from './entry-fixture'
import { projectRoot, stripComments } from './class-attrs'

const { bumpEntryViewCount } = await import('@/lib/client/views')

const ID = '0000aaaa-1111-4111-8111-222233334444'
// ★ 必须剥注释再断言：本文件头部的说明里就写着「IndexedDB」「entry-views」这些词
//   （它们是**历史**说明），不剥的话 V4 会因为文档而变红——守卫要盯的是代码，不是注释。
const SRC = stripComments(readFileSync(join(projectRoot, 'lib/client/views.ts'), 'utf8'))

// 手记调用而不是用 spy 的 mock.calls：这里的断言要读 url/method，
// 自己收集一份在 TS 下更直接，也不用和 vi.fn 的泛型签名较劲。
let calls: { url: string; init?: RequestInit }[] = []

function mockFetch(impl: (url: string, init?: RequestInit) => Response): void {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return impl(url, init)
  })
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => { calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

describe('V · 打开次数（数据库列 + 服务器原子自增）', () => {
  it('V0 计数成功 → 返回**服务器那一行**，且打到 view 子资源的 POST 上', async () => {
    mockFetch(() => jsonResponse({ entry: entryFixture({ id: ID, viewCount: 7 }) }))
    const got = await bumpEntryViewCount(ID)
    expect(got?.viewCount, '返回的必须是以服务器为准的值（不是本地推算的）').toBe(7)
    expect(got?.id).toBe(ID)
    expect(calls.length).toBe(1)
    expect(calls[0].url, '端点写错了——计数只能在 /api/diary/[id]/view').toBe(`/api/diary/${ID}/view`)
    expect(calls[0].init?.method, '必须是 POST（自增是服务端行为，不是 PUT 一个绝对值）').toBe('POST')
  })

  it('V1 离线（fetch 直接 reject）→ 返回 null，且**不抛**（计数绝不能影响阅读）', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('network down') })
    await expect(bumpEntryViewCount(ID)).resolves.toBeNull()
  })

  it('V2 限流 / 条目不存在等非 2xx → null（不重试、不报错）', async () => {
    for (const status of [429, 404, 401, 500]) {
      calls = []
      mockFetch(() => jsonResponse({ error: 'x' }, status))
      await expect(bumpEntryViewCount(ID), `HTTP ${status} 应降级为 null`).resolves.toBeNull()
      expect(calls.length, '一次请求就够，不该重试').toBe(1)
      vi.unstubAllGlobals()
    }
  })

  it('V3 响应体畸形（没有 entry / 不是 JSON）→ null（不能把 undefined 当成 0 显示出去）', async () => {
    mockFetch(() => jsonResponse({ entry: null }))
    await expect(bumpEntryViewCount(ID)).resolves.toBeNull()
    mockFetch(() => new Response('not json', { status: 200 }))
    await expect(bumpEntryViewCount(ID)).resolves.toBeNull()
  })

  it('V4 反向守卫：不许退回本机计数（本模块不得再碰 IndexedDB / localStorage）', () => {
    expect(SRC, '又 import 了 idb —— 打开次数已入库，退回本机计数会让数字跨设备不一致').not.toMatch(
      /from '\.\/idb'|localStorage|indexedDB/i,
    )
    expect(SRC, "残留了旧的 'entry-views' 存储键").not.toContain('entry-views')
  })

  it('V5 反向守卫：客户端**不许提交绝对值**（只发 POST 到子资源，不带请求体）', () => {
    // 出现 PATCH 或 body 就说明有人把它改回「客户端算好数量再写回」——那正是丢失更新的来源
    expect(SRC, 'views.ts 不该再用 PATCH（绝对值写回会丢更新）').not.toContain('PATCH')
    expect(SRC, '不该再传 body（自增由服务器做，客户端不提交数字）').not.toMatch(/body:\s*JSON/)
  })
})

// ── 端点本身的源码级守卫（行为级由 tests/api-protection.test.ts 的 401 用例兜底）──
const ROUTE = stripComments(
  readFileSync(join(projectRoot, 'app/api/diary/[id]/view/route.ts'), 'utf8'),
)

describe('V-endpoint · 打开次数端点', () => {
  it('V6 服务器**原子自增**：用 SQL 表达式 +1，且端点不解析请求体', () => {
    expect(ROUTE, '不是自增表达式 —— 客户端提交绝对值会在多标签页并存时丢更新').toContain(
      'sql`${diaryEntries.viewCount} + 1`',
    )
    expect(ROUTE, '端点不该读请求体（它表达的是「我读了一次」这个事件，没有参数）').not.toMatch(/req\.json/)
  })

  it('V7 绝不刷新 updatedAt —— 回看一篇不算编辑，详情页不能冒出「编辑于」', () => {
    // drizzle 的 update().set() 只写列出的字段；一旦有人顺手补上 updatedAt，
    // 每打开一次详情页都会把这一篇标成「刚编辑过」。
    expect(ROUTE, 'set 里出现了 updatedAt —— 回看会把自己标成「已编辑」').not.toContain('updatedAt')
  })
})

// ── EntryView 的计数时机（2026-10-01 定）：停留满 1 秒才算「打开过」──
// 语义变更：此前 entry 一就位就立刻 POST；现在延迟 1 秒——误触 / 秒退不计数、不发请求。
// 界面先按 entry.viewCount 原样显示（0 就显示 0），到点后数字才原地跳到 +1。
const VIEW = stripComments(
  readFileSync(join(projectRoot, 'components/EntryView.tsx'), 'utf8'),
)

describe('V-timing · 计数延迟 1 秒（不满 1 秒的打开不算）', () => {
  it('V8 计数请求包在 setTimeout 里，时长是具名常量 1 秒', () => {
    expect(VIEW, '延迟时长应收敛为具名常量（魔法数字会被随手改掉）').toContain('VIEW_COUNT_DELAY_MS = 1_000')
    const call = VIEW.indexOf('bumpEntryViewCount(entry.id)')
    const timer = VIEW.indexOf('setTimeout(')
    expect(call, 'EntryView 里找不到计数调用').toBeGreaterThanOrEqual(0)
    expect(timer, '计数调用不在 setTimeout 里——「停留满 1 秒才计」被改没了').toBeGreaterThanOrEqual(0)
    expect(timer, 'setTimeout 必须出现在计数调用之前').toBeLessThan(call)
    // setTimeout 的收尾就是延迟常量（`}, VIEW_COUNT_DELAY_MS)`），比截窗口更稳
    expect(VIEW, '延迟时长不是 VIEW_COUNT_DELAY_MS').toContain('}, VIEW_COUNT_DELAY_MS)')
  })

  it('V9 1 秒内离开不计数：回调先查 aliveRef，离开后连请求都不发', () => {
    const call = VIEW.indexOf('bumpEntryViewCount(entry.id)')
    // 从 setTimeout 到计数调用之间必须存在 aliveRef 守卫
    const timer = VIEW.indexOf('setTimeout(')
    const between = VIEW.slice(timer, call)
    expect(between, '回调里没有 aliveRef 守卫——用户秒退后请求照样发出，1 秒语义名存实亡')
      .toContain('if (!aliveRef.current) return')
  })

  it('V10 去重：viewCountedRef 先挡后置位（StrictMode 双挂载 / setEntry 重跑不得重复计数）', () => {
    // 没有置位的话：开发模式双挂载 +2；同一篇上改定位 / 收藏 / 保存触发的 setEntry
    // 会让本 effect 重跑、再武装一个定时器 ⇒ 多次 +1。
    expect(VIEW, '缺了去重的「挡」——重跑会重复计数').toContain('if (!entry || viewCountedRef.current) return')
    expect(VIEW, '缺了去重的「置位」——挡永远不生效，每次重跑都重新武装定时器').toContain('viewCountedRef.current = true')
  })
})
