// 浏览器/Node 通用的 base64 <-> Uint8Array 工具
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const binary = atob(s)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

// base64url（无 padding）工具：WebAuthn PRF 扩展 / Recovery Key 使用的编码
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// 解码 base64url（有/无 padding 均可）：先 -_ → +/ 转换，再按 4 的倍数补齐 padding，交给 atob
export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return fromBase64(padded)
}
