// 日记条目的拉取与解密（导出流程与搜索弹窗共用，避免两处分页逻辑各自演化）。
import { decryptText } from './crypto/encryption'

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

// 分页拉取全部条目（服务端按 createdAt 倒序，拼接后仍保持倒序）
export async function fetchAllEntries(): Promise<EncryptedEntry[]> {
  const all: EncryptedEntry[] = []
  let offset = 0
  while (true) {
    const res = await fetch(`/api/diary?limit=${PAGE_SIZE}&offset=${offset}`)
    if (!res.ok) throw new Error('加载失败')
    const { entries } = await res.json() as { entries: EncryptedEntry[] }
    all.push(...entries)
    if (entries.length < PAGE_SIZE) break
    offset += entries.length
  }
  return all
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
