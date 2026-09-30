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

/** 导出用：一次读出全部计数（导出按 id 取值，逐条 await 会把整个导出流程拖成串行） */
export async function getAllEntryViewCounts(): Promise<Record<string, number>> {
  return (await idbGet<Record<string, number>>(KEY)) ?? {}
}

/**
 * 导入（恢复）用：把备份里的打开次数写回本机。
 *
 * 规则：**只补本机没有的，不覆盖本机已有的**。本机的数字是「我在这台设备上真的看过几次」，
 * 是行为记录；备份里的数字只是导出那一刻的快照。两者冲突时保留本机——覆盖等于用旧快照
 * 抹掉此后真实的阅读行为。
 * （典型恢复场景是「清库/换设备后导入」，那时本机为空，会完整写回。）
 *
 * 返回真正写入的条数（供测试与调用方判断，不写入任何界面提示）。
 */
export async function restoreEntryViewCounts(counts: Record<string, number>): Promise<number> {
  const incoming = Object.entries(counts).filter(([, v]) => Number.isFinite(v) && v > 0)
  if (incoming.length === 0) return 0
  return withViewsLock(async () => {
    const cur = (await idbGet<Record<string, number>>(KEY)) ?? {}
    const merged: Record<string, number> = { ...cur }
    let written = 0
    for (const [id, v] of incoming) {
      if (merged[id] != null) continue
      merged[id] = Math.trunc(v)
      written++
    }
    if (written === 0) return 0
    const keys = Object.keys(merged)
    await idbSet(KEY, keys.length > MAX ? keepLast(merged, keys, MAX) : merged)
    return written
  })
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
