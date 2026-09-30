// 交换格式层的守卫测试。
//
// 两个必须钉死的不变量：
//  1. **往返无损**：自家导出再导入，所有用户可见字段逐字段相同（"备份"的承诺）；
//  2. **导入幂等**：外部文件（没有 orbit 块）按源标识确定性派生 id，同一份文件导入两次 id 完全相同。
// 另外覆盖"拒绝并报告"的逐条判定——不合格的条目只拒绝它自己。
import { describe, expect, it } from 'vitest'
import { buildJournalFile, JOURNAL_JSON_NAME, MAX_IMPORT_ENTRIES, parseJournal, serializeJournal } from '@/lib/client/journal-format'
import { uuidToHex32 } from '@/lib/client/uuid-v5'
import { entryFixture } from './entry-fixture'
import type { DecryptedEntry } from '@/lib/client/entries'

const ID = '0b6f1a2c-3d4e-4f50-8a9b-1c2d3e4f5a6b'

const sample: DecryptedEntry = {
  // 全字段默认值见 tests/entry-fixture.ts：这里只覆盖本文件关心的字段
  entry: entryFixture({
    id: ID,
    createdAt: '2024-03-05T01:02:03.000Z',
    updatedAt: '2024-04-06T07:08:09.000Z',
    wordCount: 42,
    latitude: 31.2304,
    longitude: 121.4737,
    locationAccuracy: 25,
    locationProvince: '上海市',
    locationCity: '上海市',
    locationDistrict: '黄浦区',
    weather: '晴 25°C',
    timezone: 'Asia/Shanghai',
    starred: true,
  }),
  plain: '# 标题\n\n正文 **加粗**',
}

describe('导出结构（Day One 兼容）', () => {
  const file = buildJournalFile([sample], { now: new Date('2026-09-30T00:00:00.000Z') })

  it('文件名常量符合 Day One / Journey 的约定', () => {
    expect(JOURNAL_JSON_NAME).toBe('Journal.json')
  })

  it('用 Day One 的字段名与形态', () => {
    const e = file.entries[0]
    expect(e.uuid).toBe(uuidToHex32(ID)) // 32 位大写 hex，无连字符
    expect(e.uuid).toHaveLength(32)
    expect(e.creationDate).toBe('2024-03-05T01:02:03.000Z')
    expect(e.modifiedDate).toBe('2024-04-06T07:08:09.000Z')
    expect(e.timeZone).toBe('Asia/Shanghai')
    // 三级地名各自落到 Day One 对应的位置：省 → administrativeArea、市 → localityName，
    // 组合展示串放 placeName（Day One / Journey 读的就是它）
    expect(e.location).toEqual({
      latitude: 31.2304,
      longitude: 121.4737,
      placeName: '上海市 黄浦区',
      administrativeArea: '上海市',
      localityName: '上海市',
    })
    expect(e.weather).toEqual({ conditionsDescription: '晴 25°C' })
    expect(e.text).toBe('# 标题\n\n正文 **加粗**')
  })

  it('收藏如实写出（Day One 原生就有 starred，不再是恒 false 的占位）', () => {
    expect(file.entries[0].starred).toBe(true)
    const unstarred = buildJournalFile([{ ...sample, entry: { ...sample.entry, starred: false } }])
    expect(unstarred.entries[0].starred).toBe(false)
  })

  it('metadata 明示"坐标未模糊 + 明文"（文件本身要自证风险）', () => {
    expect(file.metadata.coordinatesBlurred).toBe(false)
    expect(file.metadata.encryption).toBe('none')
    expect(file.metadata.count).toBe(1)
  })

  it('坐标为空的条目不带 location 字段（而不是传 null）', () => {
    const bare = buildJournalFile([{
      ...sample,
      entry: {
        ...sample.entry,
        latitude: null, longitude: null, weather: null,
        locationProvince: null, locationCity: null, locationDistrict: null, locationName: null,
      },
    }])
    expect(bare.entries[0].location).toBeUndefined()
    expect(bare.entries[0].weather).toBeUndefined()
  })
})

describe('往返无损（自家导出再导入）', () => {
  it('所有用户可见字段逐字段相同', async () => {
    const json = serializeJournal(buildJournalFile([sample]))
    const parsed = await parseJournal(JSON.parse(json))
    expect(parsed.rejected).toHaveLength(0)
    expect(parsed.entries).toHaveLength(1)
    const got = parsed.entries[0]
    expect(got.id).toBe(ID) // 自家 id 原样保留（既无损又天然幂等）
    expect(got.createdAt).toBe(sample.entry.createdAt)
    expect(got.updatedAt).toBe(sample.entry.updatedAt)
    expect(got.text).toBe(sample.plain)
    expect(got.wordCount).toBe(sample.entry.wordCount)
    expect(got.timezone).toBe(sample.entry.timezone)
    expect(got.latitude).toBe(sample.entry.latitude)
    expect(got.longitude).toBe(sample.entry.longitude)
    expect(got.locationAccuracy).toBe(sample.entry.locationAccuracy)
    expect(got.starred).toBe(true)
    // 结构化地名三级无损往返（District 是 Day One 结构里放不下的那一级，靠 orbit 带回来）
    expect(got.locationProvince).toBe('上海市')
    expect(got.locationCity).toBe('上海市')
    expect(got.locationDistrict).toBe('黄浦区')
    // 有结构化三级时**不**再写单一地名串（否则同一篇会有两套地名、展示口径分裂）
    expect(got.locationName).toBeNull()
    expect(got.weather).toBe(sample.entry.weather)
  })

  it('老数据（只有单一地名串）往返后仍然保留那一串', async () => {
    const legacy: DecryptedEntry = {
      ...sample,
      entry: { ...sample.entry, locationProvince: null, locationCity: null, locationDistrict: null, locationName: '五华区 昆明市' },
    }
    const parsed = await parseJournal(JSON.parse(serializeJournal(buildJournalFile([legacy]))))
    expect(parsed.entries[0].locationProvince).toBeNull()
    expect(parsed.entries[0].locationName).toBe('五华区 昆明市')
  })

  it('结构化三级与老地名串同时存在时两者都原样带回（不做取舍）', async () => {
    const both: DecryptedEntry = { ...sample, entry: { ...sample.entry, locationName: '黄浦区 上海市' } }
    const parsed = await parseJournal(JSON.parse(serializeJournal(buildJournalFile([both]))))
    expect(parsed.entries[0].locationProvince).toBe('上海市')
    expect(parsed.entries[0].locationName).toBe('黄浦区 上海市')
  })
})

describe('导入外部文件（无 orbit 块）', () => {
  const dayOne = {
    entries: [
      {
        uuid: 'AA7A6A77946547449ED0BBC99349537C',
        creationDate: '2013-02-13T20:38:54Z',
        modifiedDate: '2013-02-13T20:40:00Z',
        timeZone: 'Asia/Shanghai',
        text: '第一篇',
        starred: false,
        location: { latitude: 31.2, longitude: 121.5, placeName: '上海' },
        weather: { conditionsDescription: 'Cloudy', temperatureCelsius: 3.5 },
        tags: ['旅行'],
        photos: [{ identifier: 'x' }],
      },
      { creationDate: '2020-01-01T00:00:00Z', text: '没有 uuid 的条目' },
    ],
  }

  it('id 由源 uuid 确定性派生，且同一文件两次导入结果相同', async () => {
    const a = await parseJournal(structuredClone(dayOne))
    const b = await parseJournal(structuredClone(dayOne))
    expect(a.entries[0].id).toBe(b.entries[0].id)
    expect(a.entries[0].id).toMatch(/^[0-9a-f-]{36}$/)
    // 与自家 id 空间不同：派生 id 不等于源 uuid（源是 32 位 hex，不是 uuid）
    expect(a.entries[0].id).not.toBe(dayOne.entries[0].uuid)
  })

  it('没有 uuid 时按「创建时间 + 正文」派生，仍然确定', async () => {
    const a = await parseJournal(structuredClone(dayOne))
    const b = await parseJournal(structuredClone(dayOne))
    expect(a.entries[1].id).toBe(b.entries[1].id)
    expect(a.entries[1].id).not.toBe(a.entries[0].id)
  })

  it('Day One 的结构化天气被还原成文本（含温度）', async () => {
    const r = await parseJournal(structuredClone(dayOne))
    expect(r.entries[0].weather).toBe('Cloudy 3.5°C')
  })

  it('外部文件的地名进「单一地名串」，不硬猜分级（字段含义在各国并不统一）', async () => {
    const r = await parseJournal(structuredClone(dayOne))
    expect(r.entries[0].locationName).toBe('上海')
    expect(r.entries[0].locationProvince).toBeNull()
    expect(r.entries[0].locationDistrict).toBeNull()
  })

  it('外部文件的 starred=true 会被当作收藏（Day One 原生字段）', async () => {
    const r = await parseJournal({ entries: [{ text: 'x', creationDate: '2020-01-01T00:00:00Z', starred: true }] })
    expect(r.entries[0].starred).toBe(true)
    // 非布尔 / 缺失一律 false（老文件里这一位恒为 false）
    const bad = await parseJournal({ entries: [{ text: 'y', creationDate: '2020-01-01T00:00:00Z', starred: 'yes' }] })
    expect(bad.entries[0].starred).toBe(false)
  })

  it('忽略标签与附件，但要如实告知用户', async () => {
    const r = await parseJournal(structuredClone(dayOne))
    expect(r.warnings.join()).toMatch(/标签/)
    expect(r.warnings.join()).toMatch(/照片|附件/)
  })

  it('裸数组外壳也接受', async () => {
    const r = await parseJournal([{ text: 'x', creationDate: '2020-01-01T00:00:00Z' }])
    expect(r.entries).toHaveLength(1)
  })
})

describe('逐条拒绝（不因一条脏数据毁掉整次导入）', () => {
  it('正文为空 / 缺时间 / 时间无法解析 / 不是对象 → 各自被拒并给原因', async () => {
    const r = await parseJournal({
      entries: [
        { text: '   ', creationDate: '2020-01-01T00:00:00Z' },
        { text: '缺时间' },
        { text: '坏时间', creationDate: '不是日期' },
        'not-an-object',
        { text: '唯一一条好的', creationDate: '2021-01-01T00:00:00Z' },
      ],
    })
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0].text).toBe('唯一一条好的')
    expect(r.rejected).toHaveLength(4)
    expect(r.rejected.map((x) => x.reason)).toEqual([
      '正文为空',
      '缺少创建时间（creationDate）',
      expect.stringContaining('创建时间无法解析'),
      '不是对象',
    ])
  })

  it('坐标越界 → 丢坐标但保留条目（不因此拒绝整篇）', async () => {
    const r = await parseJournal({ entries: [{ text: 'x', creationDate: '2020-01-01T00:00:00Z', location: { latitude: 999, longitude: 0 } }] })
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0].latitude).toBeNull()
  })

  it('modifiedDate 缺失时回落到创建时间', async () => {
    const r = await parseJournal({ entries: [{ text: 'x', creationDate: '2020-01-01T00:00:00Z' }] })
    expect(r.entries[0].updatedAt).toBe(r.entries[0].createdAt)
  })

  it('外壳不认识 → 直接抛错（而不是当成 0 条静默成功）', async () => {
    await expect(parseJournal({ foo: 1 })).rejects.toThrow(/无法识别/)
  })

  it('超过单次上限 → 抛错并说明', async () => {
    const huge = { entries: Array.from({ length: MAX_IMPORT_ENTRIES + 1 }, () => ({ text: 'x', creationDate: '2020-01-01T00:00:00Z' })) }
    await expect(parseJournal(huge)).rejects.toThrow(/超过单次导入上限/)
  })
})
