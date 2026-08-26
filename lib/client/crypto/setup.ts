import { deriveKek } from './kdf'
import { decodeRecoveryKey } from './recovery-key'
import { randomBytes, unwrapDekFromWrapper } from './encryption'
import { toBase64, fromBase64, fromBase64Url } from './base64'

// 密钥层级（规格第七节，注释必须保留）：
// DEK(256-bit 随机，仅内存)
//  ├─ Passkey PRF 输出 PRF(S) ──HKDF(salt=S)──▶ Passkey KEK ──AES-256-GCM──▶ wrapper_p
//  └─ Recovery Key(32B) ──HKDF(salt=salt_r)──▶ Recovery KEK ──AES-256-GCM──▶ wrapper_r
// wrapper 的 encryptedDek 存储格式：base64( iv(12B) + ciphertext )，IV 内嵌

// 用 KEK 包裹 DEK（KEK 由调用方派生）
// 注意：返回不含 salt——HKDF salt 由调用方管理（createWrappedDek 的 saltBytes / passkey 路径的 PRF eval S），
// 避免误存随机死值导致 KEK 不匹配、DEK 不可恢复
export async function wrapWithKek(dek: CryptoKey, kek: CryptoKey): Promise<{ encryptedDek: string }> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dek))
  const iv = randomBytes(12)
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw))
  const combined = new Uint8Array(iv.length + cipher.length)
  combined.set(iv, 0)
  combined.set(cipher, iv.length)
  return { encryptedDek: toBase64(combined) }
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
  return unwrapDekFromWrapper(kek, encryptedDek)
}

// PRF 输出 → KEK（HKDF(salt=S)，S 即 passkey_prf wrapper 的 salt 字段）
// 注意：只派生 KEK，解包 DEK 由调用方用 unwrapDekFromWrapper 完成
export async function derivePrfKek(prfOutputB64: string, salt: string): Promise<CryptoKey> {
  // PRF 输出（clientExtensionResults）与 salt 均可能为 base64url 无 padding（如 prfEvalB64(S) 直接入库）；
  // 统一用 fromBase64Url 规范化（-_→+/、补 padding），标准 base64 也兼容（replace 为 no-op）
  const prfOutput = fromBase64Url(prfOutputB64)
  if (prfOutput.length !== 32) throw new Error('PRF 输出长度无效')
  return deriveKek(prfOutput, fromBase64Url(salt), 'passkey-kek')
}
