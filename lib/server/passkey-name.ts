// 通行密钥在系统「密码 / 通行密钥」里的显示名。
//
// 目标（2026-10-10 用户要求）：有用户名 → 「Ethan的Orbit」；没有用户名 → 「Orbit_User」。
//
// ★ 为什么单独一个文件、且**不带 `server-only`**：它要被单元测试直接 import。
//   `webauthn.ts` 顶层读 env（WEBAUTHN_RP_ID / ORIGIN 等），测试环境 import 就会抛错
//   ⇒ 纯逻辑留在本文件，`webauthn.ts` 只做调用。这也让这段规则可以被**真正单测**
//   （而不是只做源码字符串断言）。
//
// ★ 为什么 `name` 与 `displayName` 都设成同一个值：
//   · iOS / macOS 的「通行密钥」列表读的是 `user.name`；
//   · Android / Chrome 的账户选择器优先 `displayName`。
//   只设一个，会出现「有的平台显示 Orbit_User、有的显示 xxx的Orbit」。
//
// ★ `user.name` 有 **64 字节（UTF-8）上限**（WebAuthn 规范对 PublicKeyCredentialUserEntity
//   的要求）。中文 3 字节/字 ⇒「小明的Orbit」仅 17 字节，正常名字远不会超；
//   真超了才回退到 ASCII 形式（`displayName` 无长度限制，仍保留完整的中文名）。

/** 没有用户名时的显示名（早期版本的固定名，保持向后一致） */
export const PASSKEY_FALLBACK_NAME = 'Orbit_User'

/** `user.name` 的字节上限（WebAuthn 规范：≤ 64 bytes，按 UTF-8 计） */
const USER_NAME_MAX_BYTES = 64

/** UTF-8 字节长度（不依赖 Node 的 Buffer —— 该文件也要能在浏览器/测试环境求值） */
function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length
}

/** 按 UTF-8 字节数截断，且**不切开多字节字符**（中文被切一半会变成 U+FFFD） */
function truncateUtf8(s: string, maxBytes: number): string {
  if (utf8Length(s) <= maxBytes) return s
  let out = ''
  for (const ch of s) {
    if (utf8Length(out + ch) > maxBytes) break
    out += ch
  }
  return out
}

export function buildPasskeyUserNames(displayBase?: string | null): { name: string; displayName: string } {
  const base = (displayBase ?? '').trim()
  // 无用户名（首次 setup 时还不存在）→ 沿用早期版本的固定名
  if (!base) return { name: PASSKEY_FALLBACK_NAME, displayName: PASSKEY_FALLBACK_NAME }

  const displayName = `${base}的Orbit`
  if (utf8Length(displayName) <= USER_NAME_MAX_BYTES) return { name: displayName, displayName }

  // 只在超 64 字节时走这里：改用 ASCII 形式，并**真正把长度截到限内**
  // （服务器已经把用户名限到 32 字符，但 32 个中文 = 96 字节，回退路径是会被真实触发的）。
  const suffix = "'s Orbit"
  const ascii = base.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim()
  const head = truncateUtf8(ascii, USER_NAME_MAX_BYTES - suffix.length)
  return { name: head ? `${head}${suffix}` : PASSKEY_FALLBACK_NAME, displayName }
}
