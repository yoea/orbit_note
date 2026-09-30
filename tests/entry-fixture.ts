// 测试用日记条目工厂（EncryptedEntry / QueuedEntry 各一份全字段默认值）。
//
// 为什么需要它：给 diary_entries 加一列（starred、结构化地名三级）时，四个测试文件里
// 手写的条目字面量会**同时**类型报错，逼着人到每一处补一遍——补的时候还很容易顺手写错语义
// （比如把新加的字段写成 null 而不是它该有的默认）。这里给一份完整的中性默认值，
// 用例只覆盖它真正要断言的那几个字段。
//
// ★ 两个刻意的设计：
//   1) 默认值**必须是完整的**：少一个字段就等于该字段在测试里恒为 undefined，
//      而 undefined 会把「忘传」伪装成「没有值」，让断言静默空转。
//   2) 默认值保持**中性**（无地点、无天气、未收藏），需要什么的用例自己 patch 进来——
//      这样断言里出现的每个非空值都能在用例内一眼找到来源。
//
// E2EE 提醒：正文相关字段一律是密文占位串，测试数据里不出现任何"真实"明文语义。
import type { EncryptedEntry } from '@/lib/client/entries'
import type { QueuedEntry } from '@/lib/client/offline'

export function entryFixture(patch: Partial<EncryptedEntry> = {}): EncryptedEntry {
  return {
    id: '0000aaaa-1111-4111-8111-222233334444',
    ciphertext: 'ct',
    iv: 'iv',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    wordCount: 1,
    latitude: null,
    longitude: null,
    locationAccuracy: null,
    locationProvince: null,
    locationCity: null,
    locationDistrict: null,
    locationName: null,
    weather: null,
    timezone: null,
    starred: false,
    ...patch,
  }
}

export function queuedFixture(patch: Partial<QueuedEntry> = {}): QueuedEntry {
  return {
    id: '0000bbbb-1111-4111-8111-222233334444',
    ciphertext: 'ct',
    iv: 'iv',
    wordCount: 1,
    timezone: null,
    starred: false,
    queuedAt: Date.UTC(2026, 8, 1),
    ...patch,
  }
}
