import { fromBase64, toBase64 } from './base64'

// keyWrappers.encryptedDek 存储格式：base64( iv(12B) + ciphertext )，IV 内嵌避免额外列
// 安全约束：
// - IV 由调用方传入，必须与 AES-GCM 加密所用的 IV 一致（GCM 解密需要同一 IV，自产 IV 必失败）
// - 每次 wrap 的 IV 仍要求 CSPRNG 唯一 96-bit 值（GCM IV 绝不复用），由调用方（wrapWithKek）保证
// - 数据格式与 schema（key_wrappers.encrypted_dek 单一 text 列）对齐；
//   解包方（setup/session 流程）必须用 decodeWrapped 拆分，前 12 字节为 IV
export function encodeWrapped(iv: Uint8Array<ArrayBuffer>, cipher: ArrayBuffer): string {
  const out = new Uint8Array(iv.length + cipher.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(cipher), iv.length)
  return toBase64(out)
}

export function decodeWrapped(s: string): { iv: Uint8Array<ArrayBuffer>; data: Uint8Array<ArrayBuffer> } {
  const all = fromBase64(s)
  if (all.length < 13) throw new Error('invalid wrapped data')
  return { iv: all.slice(0, 12), data: all.slice(12) }
}
