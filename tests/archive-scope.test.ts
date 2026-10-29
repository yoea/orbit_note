// 守卫：「归档」的口径不能只在某一处生效（2026-10-29，migration 0015）
//
// 背景：归档的语义是「退出日常视图」。这个语义要在**五个地方**同时成立——
//   列表（/api/diary）、统计（热力图/连续天数/字数）、去年的今天、导出、离线队列。
// 少一处就是一个不报错的 bug：例如统计漏了 WHERE，用户会看到「归档了却还在热力图上有格子」，
// 而代码里没有任何地方会红。
//
// 另一半是**写入侧的硬约定**：归档是「元数据更新」不是「编辑」——
// PATCH 只带 archivedAt，一旦带了 ciphertext 就会刷新 updated_at，
// 详情页凭空多一条「上次编辑」。这一条照 entry-star 的 S7 写法钉死。
//
// 非空转验证：Temp/nonvacuous_archive.py（五个破坏用例）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from './class-attrs'

const LIST_API = 'app/api/diary/route.ts'
const STATS_API = 'app/api/diary/stats/route.ts'
const OTD_API = 'app/api/diary/on-this-day/route.ts'
const ENTRY_VIEW = 'components/EntryView.tsx'
const FORMAT = 'lib/client/journal-format.ts'
const OFFLINE = 'lib/client/offline.ts'

function code(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/** 从 needle 起到 nextNeedle 之前（源码级切片，两端都要先断言存在，否则会切出空串空转） */
function slice(rel: string, from: string, to: string): string {
  const src = code(rel)
  const a = src.indexOf(from)
  expect(a, `${rel} 里找不到「${from}」`).toBeGreaterThanOrEqual(0)
  const b = src.indexOf(to, a + from.length)
  expect(b, `${rel} 里找不到切片右界「${to}」`).toBeGreaterThan(a)
  return src.slice(a, b)
}

describe('A · 归档口径（列表 / 统计 / 去年今日 / 导出 / 离线）', () => {
  it('A0 解析自检：五个文件都读到了关键锚（防断言空转）', () => {
    for (const [rel, needle] of [
      [LIST_API, 'archivedAt'],
      [STATS_API, 'archived_at'],
      [OTD_API, 'archived_at'],
      [ENTRY_VIEW, 'toggleArchive'],
      [FORMAT, 'archived_at'],
    ] as const) {
      const src = code(rel)
      expect(src.length, `${rel} 读不到内容`).toBeGreaterThan(200)
      expect(src, `${rel} 里找不到「${needle}」`).toContain(needle)
    }
  })

  it('A1 列表接口默认 exclude，且三档各自有明确的 SQL 条件', () => {
    const src = code(LIST_API)
    // ★ 默认必须是 exclude：旧客户端不传这个参数，默认 all 就等于归档对线上老用户不生效
    expect(src, '列表的 archived 参数默认值不是 exclude').toContain("?? 'exclude'")
    expect(src, '列表没排除归档（缺 isNull）').toContain('isNull(diaryEntries.archivedAt)')
    expect(src, '列表拿不到「仅归档」那一档（缺 isNotNull）').toContain('isNotNull(diaryEntries.archivedAt)')
    // 非法值必须是 400，而不是静默当成某档
    expect(src, '非法 archived 值没有拒绝').toMatch(/archivedRaw !== 'exclude'[\s\S]{0,120}bad_request/)
  })

  it('A2 统计（热力图 / 连续天数 / 字数）必须排除归档', () => {
    expect(code(STATS_API), '统计 SQL 没有 WHERE archived_at IS NULL —— 归档了还会算进热力图与连续天数')
      .toContain('archived_at IS NULL')
  })

  it('A3 去年的今天必须排除归档', () => {
    expect(code(OTD_API), 'on-this-day 没有排除归档 —— 归档的老日记会被翻出来摆在写页顶上')
      .toContain('archived_at IS NULL')
  })

  it('A4 归档是元数据更新：PATCH 只带 archivedAt，绝不带 ciphertext', () => {
    const fn = slice(ENTRY_VIEW, 'async function toggleArchive()', 'const remove = useCallback')
    expect(fn.length, 'toggleArchive 切片过短，断言会空转').toBeGreaterThan(300)
    expect(fn, 'PATCH 没带 archivedAt').toContain('{ archivedAt: next }')
    // ★ 带了 ciphertext 就会刷新 updated_at ⇒ 详情页凭空多「上次编辑」
    expect(fn, '归档 PATCH 里出现了 ciphertext —— 会刷新 updatedAt（凭空多「上次编辑」）').not.toContain('ciphertext')
    // 取消归档必须传 null（undefined 会被 JSON.stringify 丢掉，等于静默无操作）
    expect(fn, '取消归档没有显式传 null').toMatch(/next = .*null/)
  })

  it('A5 导出：台账/CSV/版本号都带上了归档', () => {
    const src = code(FORMAT)
    expect(src, '字段台账没登记 archived_at').toMatch(/archived_at:\s*\{[^}]*csv: 'archived_at'/)
    expect(src, 'CSV 列序里没有 archived_at').toMatch(/'timezone', 'archived_at'/)
    expect(src, 'FORMAT_VERSION 没升到 6（新增了 orbit.archivedAt）').toContain('FORMAT_VERSION = 6')
  })

  it('A6 离线队列：未同步的笔记也要带上归档状态', () => {
    const src = code(OFFLINE)
    expect(src, 'QueuedEntry 没有 archivedAt').toMatch(/archivedAt: string \| null/)
    // 冲刷 POST 必须带上，否则服务端按默认 null 抹掉 = 「离线归档了，联网又变回未归档」
    expect(src, '冲刷 POST 没带 archivedAt').toMatch(/starred: item\.starred,\s*archivedAt: item\.archivedAt/)
    // queuedToEntry 的映射也要带（离线列表里这篇要是已归档的，得照实显示）
    expect(src, 'queuedToEntry 没映射 archivedAt').toMatch(/starred: item\.starred,\s*archivedAt: item\.archivedAt,/)
  })
})
