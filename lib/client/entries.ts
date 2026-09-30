// 日记条目的拉取与解密（导出流程与搜索弹窗共用，避免两处分页逻辑各自演化）。
import { decryptText } from './crypto/encryption'
import { cacheEntriesPage, getCachedEntries, getQueuedEntries, pruneCachedEntries, unionWithPending } from './offline'

// 服务端 /api/diary 返回的整行（正文为密文）
export interface EncryptedEntry {
  id: string
  ciphertext: string
  iv: string
  createdAt: string
  updatedAt: string
  wordCount: number
  latitude: number | null
  longitude: number | null
  locationAccuracy: number | null
  /** 结构化地名三级（省/市/区，缺级为 null）——展示一律走 displayLocationName，见 lib/client/location.ts */
  locationProvince: string | null
  locationCity: string | null
  locationDistrict: string | null
  /** 已废弃的单一地名串：只有老数据（本功能上线前）才有值，仅作展示兜底 */
  locationName: string | null
  weather: string | null
  timezone: string | null
  /** 收藏（星标）：明文的元数据列，入数据库、跟随导出与导入 */
  starred: boolean
  /** 打开次数（我自己看过几次）：数据库列，由 POST /api/diary/[id]/view 原子自增 */
  viewCount: number
}

export interface DecryptedEntry {
  entry: EncryptedEntry
  plain: string
}

// 服务端单页上限 200（见 app/api/diary/route.ts 的 clamp）
const PAGE_SIZE = 200

// 分页拉取全部条目（服务端按 createdAt 倒序，拼接后仍保持倒序）。
// 数据源与列表页一致 = 服务器真值 ∪ 未同步队列（离线写下的笔记也要能搜到/导出）。
// 顺带两件维护工作（都基于「服务器是权威」）：
// - 把已拉到的全部服务器条目写入本地缓存（密文）；
// - 用全量列表清理缓存里服务器已不存在的条目（离线列表不再出现「已删除」的残留）。
// 离线兜底：请求不可达时回退本地密文缓存 + 队列；两者皆空才抛错。
export async function fetchAllEntries(): Promise<EncryptedEntry[]> {
  const all: EncryptedEntry[] = []
  let offset = 0
  try {
    while (true) {
      const res = await fetch(`/api/diary?limit=${PAGE_SIZE}&offset=${offset}`)
      if (!res.ok) throw new Error('加载失败')
      const { entries } = await res.json() as { entries: EncryptedEntry[] }
      all.push(...entries)
      if (entries.length < PAGE_SIZE) break
      offset += entries.length
    }
    void cacheEntriesPage(all) // 顺手缓存（异步，不阻塞返回）；只缓存服务器条目，队列另算
    void pruneCachedEntries(all, { isFirstPage: true, isLastPage: true }) // 已拉到全量 ⇒ 缓存里不在这份清单里的都已被删除
    return unionWithPending(all, await getQueuedEntries())
  } catch (e) {
    const [cached, queued] = await Promise.all([getCachedEntries(), getQueuedEntries()])
    if (cached.length || queued.length) return unionWithPending(cached, queued)
    throw e
  }
}

// 逐条解密。单条解密失败不中断整体（标记为「(解密失败)」），
// 与导出流程的行为保持一致。
export async function decryptEntries(
  dek: CryptoKey,
  entries: EncryptedEntry[],
): Promise<DecryptedEntry[]> {
  const out: DecryptedEntry[] = []
  for (const entry of entries) {
    let plain = ''
    try {
      plain = await decryptText(dek, entry.ciphertext, entry.iv)
    } catch {
      plain = '(解密失败)'
    }
    out.push({ entry, plain })
  }
  return out
}
