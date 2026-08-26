import { fromBase64, toBase64 } from './base64'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// 密钥层级（规格第四节）：本模块操作的是 DEK（顶层数据加密密钥）
//   DEK ── 256-bit CSPRNG 随机，仅存浏览器内存，永不上传明文
//   ├─ Passkey KEK（HKDF 派生，见 kdf.ts）──▶ wrapper_p（存服务器）
//   └─ Recovery KEK（HKDF 派生）──▶ wrapper_r（存服务器）
// DEK 的生成/持有仅在本模块与 setup/session 流程；解密正文时从内存取 DEK。

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  // 安全约束：所有 IV / salt / DEK 材料必须来自 CSPRNG（crypto.getRandomValues）
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

export async function generateDek(): Promise<CryptoKey> {
  // DEK：AES-256-GCM，不可导出（extractable=false），仅存浏览器内存
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

// 正文加密：每篇日记独立 96-bit 随机 IV（防同文重放），密文 base64 存储
// 安全约束：IV 绝不复用；AES-GCM 自带 authTag，任何篡改（密文/IV）都会解密失败
export async function encryptText(
  key: CryptoKey,
  plaintext: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = randomBytes(12)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext))
  return { ciphertext: toBase64(new Uint8Array(cipher)), iv: toBase64(iv) }
}

export async function decryptText(key: CryptoKey, ciphertext: string, iv: string): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(ciphertext))
  return decoder.decode(plain)
}
