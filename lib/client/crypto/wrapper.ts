import { fromBase64, toBase64 } from './base64'
import { randomBytes } from './encryption'

// keyWrappers.encryptedDek 存储格式：base64( iv(12B) + ciphertext )，IV 内嵌避免额外列
// 安全约束：
// - 内嵌的 IV 为每次 wrap 时 CSPRNG 生成的唯一 96-bit 值（GCM IV 绝不复用）
// - 数据格式与 schema（key_wrappers.encrypted_dek 单一 text 列）对齐；
//   解包方（setup/session 流程）必须用 decodeWrapped 拆分，前 12 字节为 IV
export function encodeWrapped(encrypted: ArrayBuffer): string {
  const cipher = new Uint8Array(encrypted)
  const iv = randomBytes(12)
  const out = new Uint8Array(iv.length + cipher.length)
  out.set(iv, 0)
  out.set(cipher, iv.length)
  return toBase64(out)
}

export function decodeWrapped(s: string): { iv: Uint8Array<ArrayBuffer>; data: Uint8Array<ArrayBuffer> } {
  const all = fromBase64(s)
  if (all.length < 13) throw new Error('invalid wrapped data')
  return { iv: all.slice(0, 12), data: all.slice(12) }
}
