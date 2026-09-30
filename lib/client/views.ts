// 「打开次数」——**数据库列**（2026-09-30 起），本模块只负责「+1 并取回最新一行」。
//
// 语义：这个数字的含义是「**我自己**打开这一篇看过几次」，不是「被谁看过几次」。
//
// ★ 历史（别把设计退回去）：它曾经是**纯本机**的 IndexedDB 计数，当时的理由是
//   「服务端计数要把『读』变成『写』，等于新增一层元数据暴露面，只换来跨设备一致，不值」。
//   2026-09-30 用户明确要求改为**入库**（要跨设备一致，且要随导出 / 导入往返）——
//   于是它成为 diary_entries 的一列（migration 0014），也重新纳入导出字段台账。
//   代价是每次打开详情多一次写请求；换来的是数字在所有设备上一致、且能随备份恢复。
//   ⚠️ 旧的**本机**计数刻意不迁移：它按设备计，写进库等于冒充全局真值，宁可全部从 0 起算。
//
// ★ 三条约束：
//   1) 计数由**服务器原子自增**（`POST /api/diary/[id]/view`，`view_count = view_count + 1`），
//      客户端永远不提交绝对值 —— 避免多标签页「读旧值再写回」的丢失更新，也不让客户端篡改统计；
//   2) **绝不阻塞阅读或保存**：失败一律静默返回 null（离线、限流、条目已删除都算），
//      界面退回显示「上次同步到的值」，不报错、不重试；
//   3) 返回 `null` 与返回「viewCount 为 0 的条目」是**不同**的两件事 —— 前者是「这次没数成」，
//      后者是「服务器说这篇就是 0 次」。调用方据此决定要不要覆盖界面上已有的数字。
import type { EncryptedEntry } from './entries'

/**
 * 打开一篇 → 服务器 +1，返回**最新整行**（调用方顺手刷本地密文缓存 + 合并进界面状态）。
 * 数不成（离线 / 限流 / 条目不在服务器上）返回 null —— 调用方保持当前显示不变。
 */
export async function bumpEntryViewCount(id: string): Promise<EncryptedEntry | null> {
  try {
    const res = await fetch(`/api/diary/${id}/view`, { method: 'POST' })
    if (!res.ok) return null
    const data = (await res.json()) as { entry?: EncryptedEntry }
    return data.entry ?? null
  } catch {
    return null // 网络不可达 / 请求被中止：静默降级
  }
}
