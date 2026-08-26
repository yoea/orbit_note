import { fromBase64, toBase64 } from './base64'
import { decodeWrapped } from './wrapper'

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
  // DEK：AES-256-GCM，extractable=true（决策 A），仅存浏览器内存
  // 理由：wrapWithKek 包裹 DEK 需要 exportKey('raw', dek) 导出明文字节，extractable=false 必抛 InvalidAccessError。
  // 安全性无差别：XSS 威胁模型下攻击者拿 key 对象引用即可加解密正文（无需 export）；内存转储模型下也无保护。
  // wrapKey 方案需为 KEK/DEK 增加 wrapKey/unwrapKey usage，改动面更大。export 出的 raw 字节仅用于包裹瞬间，包裹后立即丢弃。
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
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

// wrapper 约定的解包：KEK → AES-GCM 解出 raw DEK 字节 → 重新导入为可用的 DEK
// 与 encodeWrapped 内嵌 IV 格式（base64(iv(12B)+cipher)）配套，KEK 由调用方派生（见 setup.ts）
// extractable=true（决策 A 一致）：恢复出的 DEK 与原 extractable=true 的 DEK 字节一致，且 XSS 模型下无差别
export async function unwrapDekFromWrapper(kek: CryptoKey, encryptedDek: string): Promise<CryptoKey> {
  const { iv, data } = decodeWrapped(encryptedDek)
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, data)
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}
