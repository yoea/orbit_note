import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildCsv,
  buildJournalFile,
  CSV_COLUMNS,
  ENTRY_COLUMN_COVERAGE,
  parseJournal,
  serializeJournal,
} from '@/lib/client/journal-format'
import { projectRoot } from './class-attrs'
import type { DecryptedEntry } from '@/lib/client/entries'

// ============================================================================
// 「导出包含数据库里的全部笔记字段，导入后能完整恢复」——把这条承诺变成可核验的断言。
//
// 背景：这条承诺原本只活在注释里。于是「给 diary_entries 加一列、导出忘了带上」这种
// 静默漏数据的事故没有任何守卫——导出文件看起来一切正常，只是少了一个字段，
// 要等用户真的去恢复时才发现。
//
// 范围：**只覆盖数据库字段**。本机数据（打开次数）刻意不进文件——它跨设备不准确，
// 纳入备份只会误导恢复（见 lib/client/views.ts），所以本文件不再有它的往返断言。
//
// 做法：把「每一列去哪了」写成台账（ENTRY_COLUMN_COVERAGE），再拿 schema.ts 里
// **真实的列名**来对账：对不上就红，并在报错里直接点出是哪一列。
//   ★ 台账在 lib/client/journal-format.ts，不在测试里——它是给写代码的人看的文档。
// ============================================================================

/** 从 drizzle schema 里抠出 diary_entries 的真实列名（而不是在测试里再抄一遍） */
function diaryEntryColumns(): string[] {
  const src = readFileSync(join(projectRoot, 'lib/server/db/schema.ts'), 'utf8')
  const start = src.indexOf("pgTable('diary_entries'")
  expect(start, '没找到 diary_entries 的定义（schema 结构变了？）').toBeGreaterThanOrEqual(0)
  const end = src.indexOf('}, (t) => [', start)
  expect(end, '没找到 diary_entries 的索引定义段').toBeGreaterThan(start)
  return [...src.slice(start, end).matchAll(/[a-zA-Z]+\('([a-z0-9_]+)'/g)]
    .map((m) => m[1])
    .filter((c) => c !== 'diary_entries')
}

const ID = '0b6f1a2c-3d4e-4f50-8a9b-1c2d3e4f5a6b'

const sample: DecryptedEntry = {
  entry: {
    id: ID,
    ciphertext: 'irrelevant',
    iv: 'irrelevant',
    createdAt: '2024-03-05T01:02:03.000Z',
    updatedAt: '2024-04-06T07:08:09.000Z',
    wordCount: 42,
    latitude: 31.2304,
    longitude: 121.4737,
    locationAccuracy: 25,
    locationName: '上海市黄浦区',
    weather: '晴 25°C',
    timezone: 'Asia/Shanghai',
  },
  plain: '# 标题\n\n正文 **加粗**',
}

describe('导出字段台账（对账 schema.ts）', () => {
  it('F0 防空转：schema 里能读到 13 列', () => {
    const cols = diaryEntryColumns()
    expect(cols.length, `读到的列：${cols.join(', ')}`).toBe(13)
    expect(cols).toContain('ciphertext')
    expect(cols).toContain('location_accuracy')
  })

  it('F1 每一列都在台账里登记 → 新增列忘了导出会直接红', () => {
    const cols = diaryEntryColumns()
    const uncovered = cols.filter((c) => !(c in ENTRY_COLUMN_COVERAGE))
    expect(
      uncovered,
      `diary_entries 新增了列但没在 ENTRY_COLUMN_COVERAGE 登记（导出会静默漏掉它）：${uncovered.join(', ')}`,
    ).toEqual([])
    // 反向：台账里不许留已经不存在的列（否则台账会慢慢变成神话）
    const extra = Object.keys(ENTRY_COLUMN_COVERAGE).filter((c) => !cols.includes(c))
    expect(extra, `台账里登记了 schema 中已不存在的列：${extra.join(', ')}`).toEqual([])
  })

  it('F2 CSV 列集合 = 台账里所有非 null 的 csv 栏（不含本机字段）', () => {
    const declared = new Set(
      Object.values(ENTRY_COLUMN_COVERAGE)
        .map((v) => v.csv)
        .filter((c): c is string => c != null),
    )
    expect([...CSV_COLUMNS].sort()).toEqual([...declared].sort())
  })

  it('F3 只有密文本身与加密版本号不进文件（且必须写明原因）', () => {
    const notInCsv = Object.entries(ENTRY_COLUMN_COVERAGE).filter(([, v]) => v.csv == null)
    expect(notInCsv.map(([c]) => c)).toEqual(['encryption_version'])
    for (const [col, v] of notInCsv) {
      expect(v.note, `${col} 没有写明为什么不导出`).toBeTruthy()
    }
  })
})

// 打开次数「随备份往返」的断言已随功能撤下：本机数据不进备份。这里改为钉住
// 「数据库字段的往返无损」——这才是导出功能真正的承诺。
describe('自家导出 → 再导入 往返无损（数据库字段）', () => {
  it('F4 导出文件能被 parseJournal 原样取回（id / 正文 / 时间 / 地点 / 天气 / 字数）', async () => {
    const file = buildJournalFile([sample])
    const parsed = await parseJournal(JSON.parse(serializeJournal(file)))
    expect(parsed.rejected).toHaveLength(0)
    const e = parsed.entries[0]
    expect(e.id).toBe(ID)
    expect(e.text).toBe('# 标题\n\n正文 **加粗**')
    expect(e.createdAt).toBe('2024-03-05T01:02:03.000Z')
    expect(e.updatedAt).toBe('2024-04-06T07:08:09.000Z')
    expect(e.wordCount).toBe(42)
    expect(e.latitude).toBe(31.2304)
    expect(e.longitude).toBe(121.4737)
    expect(e.locationAccuracy).toBe(25)
    expect(e.locationName).toBe('上海市黄浦区')
    expect(e.weather).toBe('晴 25°C')
    expect(e.timezone).toBe('Asia/Shanghai')
  })

  it('F5 导出不含任何本机字段，旧文件里残留也不会让解析报错', async () => {
    const file = buildJournalFile([sample])
    expect(file.entries[0].orbit).not.toHaveProperty('viewCount')
    expect(JSON.stringify(file)).not.toContain('viewCount')
    expect(CSV_COLUMNS).not.toContain('view_count')
    // 旧版本导出的文件里可能还留着 orbit.viewCount——解析必须照常，不因此拒绝整条
    const legacy = {
      entries: [
        {
          uuid: 'AA7A6A77946547449ED0BBC99349537C',
          creationDate: '2020-01-01T00:00:00Z',
          text: '旧文件',
          orbit: { id: ID, wordCount: 3, viewCount: 7 },
        },
      ],
    }
    const r = await parseJournal(legacy)
    expect(r.rejected).toHaveLength(0)
    expect(r.entries[0].id).toBe(ID)
  })
})

describe('CSV 字段覆盖', () => {
  // 用**单行**正文，避免「正文里含换行」干扰按行断言（那是 F10 专门覆盖的事）
  const flat: DecryptedEntry = { entry: sample.entry, plain: '单行正文' }
  const csv = buildCsv([flat])
  const lines = csv.replace(/^\uFEFF/, '').split('\n')

  it('F8 表头与列顺序一致，含 location_accuracy 且不含本机字段 view_count', () => {
    expect(lines[0]).toBe(CSV_COLUMNS.join(','))
    expect(lines[0]).toContain('location_accuracy')
    expect(lines[0]).not.toContain('view_count')
  })

  it('F9 数据行按列顺序取值（含定位精度）', () => {
    expect(lines[1].split(',')).toEqual([
      ID, '2024-03-05T01:02:03.000Z', '2024-04-06T07:08:09.000Z', '单行正文', '42',
      '31.2304', '121.4737', '25', '上海市黄浦区', '晴 25°C', 'Asia/Shanghai',
    ])
  })

  it('F10 正文里的逗号/引号/换行按 RFC 4180 转义（不能靠简单 split 还原）', () => {
    const tricky: DecryptedEntry = { entry: { ...sample.entry, id: 'x' }, plain: '有,逗号 和 "引号"\n换行' }
    // 注意：转义后的字段里含字面换行，所以这里只能在整个 CSV 文本上断言，不能按行 split
    expect(buildCsv([tricky])).toContain('"有,逗号 和 ""引号""\n换行"')
  })

  it('F11 带 BOM（Excel 打开中文不乱码）', () => {
    expect(csv.startsWith('\uFEFF')).toBe(true)
  })
})
