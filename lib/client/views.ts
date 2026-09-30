// 「打开次数」——**纯本地**计数。
//
// 这个数字的含义是「**我自己**打开这一篇看过几次」，不是「被谁看过几次」。两者是完全
// 不同的功能，选纯本地是刻意的：
//   · 服务端计数意味着每次打开详情都要写库（把「读」变成「写」），而且服务器会知道
//     「你在什么时间回看了哪一篇」——对一个以零知识为卖点的私人日记，那是**纯新增的
//     元数据泄漏面**，换来的只有「跨设备一致」这一个好处，不值。
//   · 本地计数还能在离线时照常工作（这正是本项目的日常场景）。
// 接受的代价：每台设备各自计数；清掉 IndexedDB（设置 → 删除所有数据）即清零。
//
// ★ 因此它**不随导出 / 导入往返**（2026-09-30 决定）：导出只包含数据库里的笔记字段，
//   打开次数是纯本机数据、跨设备不准确，写进备份文件只会误导恢复。views.ts 只留
//   「读一次 / 打开一次 +1」这两个本地行为，不再提供导出/恢复出入口。
//
// 存储用 idb.ts 的通用 kv（'entry-views' → { [entryId]: number }），而不是 localStorage：
// localStorage 的 qo-* 键在「删除所有数据」与登出时都不会被清，而「我常看哪几篇」也算
// 行为痕迹，应当跟 idbClearAll() 一起消失。
import { idbGet, idbSet } from './idb'

const KEY = 'entry-views'
// 上限：只保留最近打开过的这些条。单用户日记量级很小，这里只是防无限增长。
const MAX = 500

// 读-改-写必须串行化——与 offline.ts 的 withEntriesLock 是同一个教训：
// 两次 RMW 交叠时，后提交者拿**自己读到的旧快照整表覆盖**，把另一次刚 +1 的结果抹掉。
// 真实触发场景：React 开发模式（StrictMode）双挂载 effect、或多标签页同时打开同一篇。
let viewsLock: Promise<unknown> = Promise.resolve()

export function withViewsLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = viewsLock.then(fn, fn)
  viewsLock = next.then(() => undefined, () => undefined)
  return next
}

export async function getEntryViewCount(id: string): Promise<number> {
  const map = (await idbGet<Record<string, number>>(KEY)) ?? {}
  return map[id] ?? 0
}

// 打开一次 → 计数 +1，返回**新值**（界面直接显示它，不用再读一次）。
export async function bumpEntryViewCount(id: string): Promise<number> {
  return withViewsLock(async () => {
    const map = (await idbGet<Record<string, number>>(KEY)) ?? {}
    const value = (map[id] ?? 0) + 1
    // 展开时已存在的键**不会**被移到末尾（字符串键序 = 首次插入序），
    // 所以「删最早的」删的确实是「最先被打开的那批」。
    const merged: Record<string, number> = { ...map, [id]: value }
    const keys = Object.keys(merged)
    await idbSet(KEY, keys.length > MAX ? keepLast(merged, keys, MAX) : merged)
    return value
  })
}

function keepLast(src: Record<string, number>, keys: string[], max: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of keys.slice(keys.length - max)) out[k] = src[k]
  return out
}
