// 用户名（可识别身份的元数据）：
// 用 DEK 加密后存服务器（/api/profile），服务器只见密文；读取需要 DEK。
// 因此名字只在**解锁后**可得——所有展示位置都在解锁之后，不影响使用。
// 懒创建：首次需要时若库里为空，生成默认名 Orbit_xxx 并落库（setup 流程不参与）。
import { decryptText, encryptText } from './crypto/encryption'
import { getDek } from './session'

// 名字长度上限（与展示布局、API 上限保持一致）
export const USER_NAME_MAX = 20

// 默认名：Orbit_ + UUID 去掉连字符后的前 3 位（形如 Orbit_a3f）
export function generateDefaultName(): string {
  const fragment = crypto.randomUUID().replace(/-/g, '').slice(0, 3)
  return `Orbit_${fragment}`
}

// 会话级缓存：解锁后读一次即可，避免每个页面重复「拉取 + 解密」。
// 同时作为极简的订阅源——改名后所有正在显示名字的组件都要跟着更新，
// 否则设置页改完名字，别的页面（以及它自己）还显示旧值。
let cached: string | null = null
const listeners = new Set<() => void>()

function setCached(name: string | null): void {
  if (cached === name) return
  cached = name
  for (const listener of listeners) listener()
}

export function getUserName(): string | null {
  return cached
}

// 供 useSyncExternalStore 订阅（返回值需稳定，故缓存用原始字符串）
export function subscribeUserName(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// 退出登录 / 清空 DEK 时调用，避免下一个人看到上一个人的名字
export function clearUserNameCache(): void {
  setCached(null)
}

async function putName(dek: CryptoKey, name: string): Promise<void> {
  const { ciphertext, iv } = await encryptText(dek, name)
  const res = await fetch('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nameCiphertext: ciphertext, nameIv: iv }),
  })
  if (!res.ok) throw new Error('保存名字失败')
}

// 读取用户名；库里没有则生成默认名并落库。需要 DEK（未解锁时抛错）。
export async function loadUserName(): Promise<string> {
  if (cached) return cached
  const dek = getDek()
  if (!dek) throw new Error('未解锁')
  const res = await fetch('/api/profile')
  if (!res.ok) throw new Error('读取名字失败')
  const data = await res.json() as { profile: { nameCiphertext: string; nameIv: string } | null }
  if (data.profile) {
    try {
      const name = await decryptText(dek, data.profile.nameCiphertext, data.profile.nameIv)
      if (name) { setCached(name); return name }
    } catch { /* 解密失败（如换过 DEK）→ 视为未设置，重建默认名 */ }
  }
  const name = generateDefaultName()
  await putName(dek, name)
  setCached(name)
  return name
}

// 改名（设置页）。空名拒绝；超长按上限截断。
export async function saveUserName(name: string): Promise<void> {
  const dek = getDek()
  if (!dek) throw new Error('未解锁')
  const trimmed = name.trim().slice(0, USER_NAME_MAX)
  if (!trimmed) throw new Error('名字不能为空')
  await putName(dek, trimmed)
  setCached(trimmed)
}
