// 批量归档的客户端入口（2026-10-29，阶段 4）。
//
// 错误刻意分门别类而不是一律「失败」：这条路径上最可能发生的是
// 「离线」（PWA 在地铁里整理日记）与「限流」（疯狂连点），
// 两者的正确反应完全不同 —— 一个是"联网再试"，一个是"等一会儿"。
// 给用户一句笼统的"失败"等于让他不知道下一步该做什么。
export interface BulkArchiveResult {
  /** 实际发生变化的条数（**已经在目标状态的不计入**，见服务端注释） */
  updated: number
  /** 服务器上已不存在的 id（在别的设备上删掉了） */
  missing: string[]
}

export type BulkArchiveErrorKind = 'offline' | 'unauthorized' | 'too_many' | 'failed'

export class BulkArchiveError extends Error {
  constructor(readonly kind: BulkArchiveErrorKind) {
    super(kind)
    this.name = 'BulkArchiveError'
  }
}

/** 错误 → 给用户看的一句话（Toaster 直接用）。未识别的一律走 failed。 */
export function bulkArchiveErrorText(e: unknown): string {
  const kind = e instanceof BulkArchiveError ? e.kind : 'failed'
  if (kind === 'offline') return '离线状态无法批量归档，联网后再试'
  if (kind === 'too_many') return '操作太频繁了，等几秒再试'
  if (kind === 'unauthorized') return '登录已过期，请重新解锁'
  return '归档失败，请重试'
}

export async function postBulkArchive(ids: string[], archived: boolean): Promise<BulkArchiveResult> {
  let res: Response
  try {
    res = await fetch('/api/diary/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, archived }),
    })
  } catch {
    // fetch 抛错 = 网络层失败（离线 / DNS / 被系统挂起）。
    // 注意这里**不能**回退到本地队列：批量归档是纯服务器写操作，
    // 本地只能改缓存，改完不告诉服务器就会在下次刷新时"复活"。
    throw new BulkArchiveError('offline')
  }
  if (!res.ok) {
    if (res.status === 401) throw new BulkArchiveError('unauthorized')
    if (res.status === 429) throw new BulkArchiveError('too_many')
    throw new BulkArchiveError('failed')
  }
  return await res.json() as BulkArchiveResult
}
