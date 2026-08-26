import { randomBytes } from './encryption'
import { fromBase64, toBase64 } from './base64'

// 密钥层级（规格第四节）：Recovery Key 是灾难恢复路径的 IKM
//   DEK ── 256-bit CSPRNG 随机，仅存浏览器内存
//   └─ Recovery Key(32B) ──HKDF-SHA-256(salt=salt_r, info="recovery-kek")──▶ Recovery KEK ──▶ wrapper_r
// Recovery Key 明文只在生成时显示一次，用户自行保管；服务器只存 SHA-256 校验哈希。

// 32 字节 CSPRNG → base64url（43 字符，无 padding），显示一次
// 安全约束：熵必须来自 CSPRNG（randomBytes 基于 crypto.getRandomValues）
export function generateRecoveryKey(): string {
  return encodeRecoveryKey(randomBytes(32))
}

export function encodeRecoveryKey(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeRecoveryKey(key: string): Uint8Array<ArrayBuffer> {
  // 严格校验格式：43 字符 base64url（32 字节 × 8 bit ÷ 6 bit = 42.67 → 43，无 padding）
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('无效的恢复密钥格式')
  const b64 = key.replace(/-/g, '+').replace(/_/g, '/') + '='
  return fromBase64(b64)
}

// 服务器端 recovery-login 校验用哈希（recovery key 256-bit 熵，SHA-256 不可逆且不可爆破）
// 安全约束：只发送哈希，明文 Recovery Key 永不上传
export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
