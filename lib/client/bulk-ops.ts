// 批量写操作的客户端入口（2026-10-29）：归档 / 取消归档 / 永久删除。
//
// 三个动作共用一套错误分类，因为它们失败的原因就那么几种。但**文案必须带动作名**：
// 「归档失败」和「删除失败」对用户的意义完全不同（一个可以再点，一个要重新想清楚）。
// 而"离线"与"限流"的正确反应也不一样 —— 一个是"联网再试"，一个是"等几秒"。
// 给一句笼统的"失败"等于没说。
export interface BulkArchiveResult {
  /** 实际发生变化的条数（**已经在目标状态的不计入**，见服务端注释） */
  updated: number
  /** 服务器上已不存在的 id（在别的设备上删掉了） */
  missing: string[]
}

export interface BulkDeleteResult {
  deleted: number
  missing: string[]
}

export type BulkErrorKind = 'offline' | 'unauthorized' | 'too_many' | 'failed'

export class BulkError extends Error {
  constructor(readonly kind: BulkErrorKind) {
    super(kind)
    this.name = 'BulkError'
  }
}

/** 错误 → 给用户看的一句话。`verb` 是动作名（「归档」/「删除」…），决定文案前半句。 */
export function bulkErrorText(e: unknown, verb: string): string {
  const kind = e instanceof BulkError ? e.kind : 'failed'
  if (kind === 'offline') return `离线状态无法${verb}，联网后再试`
  if (kind === 'too_many') return '操作太频繁了，等几秒再试'
  if (kind === 'unauthorized') return '登录已过期，请重新解锁'
  return `${verb}失败，请重试`
}

/** 统一的 POST 封装：把网络层异常与 HTTP 状态码都收敛成 BulkError。 */
async function postBulk(url: string, body: unknown): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // fetch 抛错 = 网络层失败（离线 / DNS / 被系统挂起）。
    // 刻意**不**回退本地队列：批量写是纯服务器操作，本地改完不告诉服务器，
    // 下次刷新就会"复活"。
    throw new BulkError('offline')
  }
  if (!res.ok) {
    if (res.status === 401) throw new BulkError('unauthorized')
    if (res.status === 429) throw new BulkError('too_many')
    throw new BulkError('failed')
  }
  return await res.json()
}

export interface ArchiveAllResult {
  /** 实际发生变化的条数（**已归档的不重复计入**） */
  updated: number
  /** 服务端写入的归档时间（ISO）。回写本地缓存 / 离线队列必须用**同一个值** */
  archivedAt: string
  /** 被改到的 id：客户端拿它回写本地密文缓存（离线一致性） */
  ids: string[]
}

export async function postBulkArchive(ids: string[], archived: boolean): Promise<BulkArchiveResult> {
  return await postBulk('/api/diary/archive', { ids, archived }) as BulkArchiveResult
}

/**
 * 归档**所有**日记（服务端一句 UPDATE，不需要客户端知道 id）。
 *
 * ★ 影响面是三个批量操作里最大的 —— 一次清空整个日常列表。
 *   它**可逆**（随时在归档页取消归档），所以只需要一道确认；但**篇数必须说清楚**，
 *   不能让人盲点。
 */
export async function postArchiveAll(): Promise<ArchiveAllResult> {
  return await postBulk('/api/diary/archive/all', {}) as ArchiveAllResult
}

/** 永久删除。**不可逆** —— 调用方必须先做二次确认（文案要写清不能恢复）。 */
export async function postBulkDelete(ids: string[]): Promise<BulkDeleteResult> {
  return await postBulk('/api/diary/delete', { ids }) as BulkDeleteResult
}
