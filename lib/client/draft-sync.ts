import { idbDelete, idbGet, idbSet } from './idb'

export interface DraftRecord {
  ciphertext: string
  iv: string
  encryptionVersion: number
  updatedAt: number // epoch ms（本地时间戳，仅用于冲突比较）
}

const LOCAL_KEY = 'draft'

// 冲突决策：更新时间较新者胜；空内容视为无草稿（不覆盖对方）
// 返回语义：本地草稿胜 → 返回带明文的 local 对象；服务器胜/本地为空 → 返回 { updatedAt: 服务器时间, text: '' }（空 text 表示"别用本地"）
export function pickNewer(
  local: { updatedAt: number; text: string } | null,
  server: { updatedAt: number } | null,
): { updatedAt: number; text: string } | null {
  if (!local && !server) return null
  if (!server) return local
  if (!local || local.text.trim() === '') return { updatedAt: server.updatedAt, text: '' }
  return local.updatedAt > server.updatedAt ? local : { updatedAt: server.updatedAt, text: '' }
}

export async function loadLocalDraft(): Promise<DraftRecord | null> {
  return (await idbGet<DraftRecord>(LOCAL_KEY)) ?? null
}

export async function saveLocalDraft(record: DraftRecord): Promise<void> {
  await idbSet(LOCAL_KEY, record)
}

export async function clearLocalDraft(): Promise<void> {
  await idbDelete(LOCAL_KEY)
}

export async function fetchServerDraft(): Promise<{ ciphertext: string; iv: string; updatedAt: string } | null> {
  const res = await fetch('/api/draft')
  if (!res.ok) return null
  const { draft } = await res.json()
  return draft ? { ciphertext: draft.ciphertext, iv: draft.iv, updatedAt: draft.updatedAt } : null
}

export async function pushServerDraft(record: DraftRecord): Promise<boolean> {
  const res = await fetch('/api/draft', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ciphertext: record.ciphertext, iv: record.iv, encryptionVersion: record.encryptionVersion }),
  })
  return res.ok
}
