// 密钥派生：所有 KEK 均通过 HKDF-SHA-256 派生（规格第四节）
//
// 密钥层级（DEK 仅存浏览器内存，KEK 由 HKDF 派生，任何密钥明文不离开浏览器）：
//   DEK ── 256-bit CSPRNG 随机，首次初始化生成，仅存浏览器内存
//   ├─ Passkey PRF 输出 PRF(S) ──HKDF-SHA-256(salt=S, info="passkey-kek")──▶ Passkey KEK ──▶ wrapper_p
//   └─ Recovery Key(32B) ──HKDF-SHA-256(salt=salt_r, info="recovery-kek")──▶ Recovery KEK ──▶ wrapper_r
//
// 安全约束：
// - salt 不要求保密（公开存于 key_wrappers.salt），但每条 wrapper 必须独立随机（S 或 salt_r）
// - info 按用途区分（"passkey-kek" / "recovery-kek"），避免不同 KEK 域交叉派生
// - 派生出的 KEK 不可导出（extractable=false），仅用于 AES-GCM 包裹/解包 DEK
export async function deriveKek(
  ikm: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: string,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}
