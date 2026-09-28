// 日记条目的拉取与解密（导出流程与搜索弹窗共用，避免两处分页逻辑各自演化）。
import { decryptText } from './crypto/encryption'
import { cacheEntriesPage, getCachedEntries } from './offline'

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
  locationName: string | null
  weather: string | null
  timezone: string | null
}

export interface DecryptedEntry {
  entry: EncryptedEntry
  plain: string
}

// 服务端单页上限 200（见 app/api/diary/route.ts 的 clamp）
const PAGE_SIZE = 200

// 分页拉取全部条目（服务端按 createdAt 倒序，拼接后仍保持倒序）。
// 离线兜底：请求不可达时回退本地密文缓存（缓存即密文，安全性同服务器库）；
// 缓存也为空才抛错——最坏情况等于无离线能力时的行为。
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
    void cacheEntriesPage(all) // 顺手缓存（异步，不阻塞返回）
    return all
  } catch (e) {
    const cached = await getCachedEntries()
    if (cached.length) return cached
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
