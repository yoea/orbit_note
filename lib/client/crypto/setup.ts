import { deriveKek } from './kdf'
import { decodeWrapped } from './wrapper'
import { decodeRecoveryKey } from './recovery-key'
import { randomBytes } from './encryption'
import { toBase64, fromBase64 } from './base64'

// 密钥层级（规格第七节，注释必须保留）：
// DEK(256-bit 随机，仅内存)
//  ├─ Passkey PRF 输出 PRF(S) ──HKDF(salt=S)──▶ Passkey KEK ──AES-256-GCM──▶ wrapper_p
//  └─ Recovery Key(32B) ──HKDF(salt=salt_r)──▶ Recovery KEK ──AES-256-GCM──▶ wrapper_r
// wrapper 的 encryptedDek 存储格式：base64( iv(12B) + ciphertext )，IV 内嵌

// 用 KEK 包裹 DEK（KEK 由调用方派生）
export async function wrapWithKek(dek: CryptoKey, kek: CryptoKey): Promise<{ encryptedDek: string; salt: string }> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dek))
  const iv = randomBytes(12)
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw))
  const combined = new Uint8Array(iv.length + cipher.length)
  combined.set(iv, 0)
  combined.set(cipher, iv.length)
  return { encryptedDek: toBase64(combined), salt: toBase64(randomBytes(16)) }
}

// Recovery Key 包裹 DEK：RecoveryKey → HKDF(salt) → KEK → AES-GCM(DEK)
export async function createWrappedDek(
  dek: CryptoKey,
  ikm: Uint8Array<ArrayBuffer>,
  info: string,
  saltB64?: string,
): Promise<{ encryptedDek: string; salt: string }> {
  const saltBytes = saltB64 ? fromBase64(saltB64) : randomBytes(16)
  const kek = await deriveKek(ikm, saltBytes, info)
  const { encryptedDek } = await wrapWithKek(dek, kek)
  return { encryptedDek, salt: toBase64(saltBytes) }
}

// Recovery Key 解锁：输入密钥 → HKDF → KEK → 解包 DEK（完整路径）
export async function unwrapWithRecoveryKey(
  encryptedDek: string,
  salt: string,
  recoveryKey: string,
): Promise<CryptoKey> {
  const kek = await deriveKek(decodeRecoveryKey(recoveryKey), fromBase64(salt), 'recovery-kek')
  const { iv, data } = decodeWrapped(encryptedDek)
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, data)
  // extractable=true（决策 A 一致）：恢复出的 DEK 与原 extractable=true 的 DEK 字节一致，XSS 模型下无差别
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

// PRF 输出 → KEK（HKDF(salt=S)，S 即 passkey_prf wrapper 的 salt 字段）
// 注意：只派生 KEK，解包 DEK 由调用方用 unwrapDekFromWrapper 完成
export async function derivePrfKek(prfOutputB64: string, salt: string): Promise<CryptoKey> {
  // PRF 输出来自 clientExtensionResults，是 base64url（无 padding）；
  // fromBase64 只解析标准 base64：先 -_ → +/ 转换，再按 4 的倍数补齐 padding
  // （真实 PRF 输出为 32 随机字节，含 -/_ 的概率很高，必须转换而不能直接 fromBase64）
  const b64 = prfOutputB64.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return deriveKek(fromBase64(padded), fromBase64(salt), 'passkey-kek')
}
