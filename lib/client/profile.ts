// 用户资料（可识别身份的元数据）：
// 名字用 DEK 加密后存服务器（/api/profile），服务器只见密文；读取需要 DEK。
// 因此名字只在**解锁后**可得——所有展示位置都在解锁之后，不影响使用。
// 懒创建：首次需要时若库里没有名字，生成默认名 Orbit_xxx 并落库（setup 流程不参与）。
//
// createdAt（注册时间）是明文时间戳、不含身份信息：仅「首次注册」时由服务端写入；
// 本功能上线之前注册的老用户为 null，界面回退为「第一篇日记」的日期。
import { decryptText, encryptText } from './crypto/encryption'
import { getDek } from './session'
import { cacheProfile, getCachedProfile } from './offline'

// 名字长度上限（与展示布局、API 上限保持一致）
export const USER_NAME_MAX = 20

// 默认名：Orbit_ + UUID 去掉连字符后的前 3 位（形如 Orbit_a3f）
export function generateDefaultName(): string {
  const fragment = crypto.randomUUID().replace(/-/g, '').slice(0, 3)
  return `Orbit_${fragment}`
}

interface ProfileState {
  name: string
  createdAt: string | null
}

// 会话级缓存：解锁后读一次即可，避免每个页面重复「拉取 + 解密」。
// 同时作为极简订阅源——改名后所有正在显示名字的组件都要跟着更新，
// 否则设置页改完名字，别的页面（以及它自己）还显示旧值。
let cached: ProfileState | null = null
const listeners = new Set<() => void>()

function setCached(next: ProfileState | null): void {
  if (cached?.name === next?.name && cached?.createdAt === next?.createdAt) return
  cached = next
  for (const listener of listeners) listener()
}

// 供 useSyncExternalStore 订阅：返回值必须是稳定的原始值（不能每次新建对象）
export function getUserName(): string | null {
  return cached?.name ?? null
}

export function getProfileCreatedAt(): string | null {
  return cached?.createdAt ?? null
}

export function subscribeProfile(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// 退出登录 / 清空 DEK 时调用，避免下一个人看到上一个人的名字
export function clearUserNameCache(): void {
  setCached(null)
}

async function putName(dek: CryptoKey, name: string): Promise<{ ciphertext: string; iv: string }> {
  const { ciphertext, iv } = await encryptText(dek, name)
  const res = await fetch('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nameCiphertext: ciphertext, nameIv: iv }),
  })
  if (!res.ok) throw new Error('保存名字失败')
  return { ciphertext, iv }
}

// 读取资料；库里没有名字则生成默认名并落库。需要 DEK（未解锁时抛错）。
// 网络不可达时回退本地密文缓存（离线时设置页的名字靠它显示，而非永远「加载中」）。
export async function loadUserName(): Promise<string> {
  if (cached) return cached.name
  const dek = getDek()
  if (!dek) throw new Error('未解锁')
  const res = await fetch('/api/profile').catch(() => null)
  if (res === null) {
    // 网络不可达：解密本地缓存的密文名字（无缓存/解密失败则照常抛错，界面按无名字降级）
    const offlineProfile = await getCachedProfile()
    if (offlineProfile) {
      try {
        const name = await decryptText(dek, offlineProfile.nameCiphertext, offlineProfile.nameIv)
        if (name) {
          setCached({ name, createdAt: offlineProfile.createdAt })
          return name
        }
      } catch { /* 缓存解密失败（换过 DEK）→ 视为无兜底 */ }
    }
    throw new Error('读取名字失败')
  }
  if (!res.ok) throw new Error('读取名字失败')
  const data = await res.json() as {
    profile: { nameCiphertext: string; nameIv: string } | null
    createdAt: string | null
  }
  const createdAt = data.createdAt ?? null
  if (data.profile) {
    try {
      const name = await decryptText(dek, data.profile.nameCiphertext, data.profile.nameIv)
      if (name) {
        setCached({ name, createdAt })
        // 在线成功顺手缓存密文（离线兜底用），异步不阻塞
        void cacheProfile({ nameCiphertext: data.profile.nameCiphertext, nameIv: data.profile.nameIv, createdAt })
        return name
      }
    } catch { /* 解密失败（如换过 DEK）→ 视为未设置，重建默认名 */ }
  }
  const name = generateDefaultName()
  const { ciphertext, iv } = await putName(dek, name)
  setCached({ name, createdAt })
  void cacheProfile({ nameCiphertext: ciphertext, nameIv: iv, createdAt })
  return name
}

// 改名（设置页）。空名拒绝；超长按上限截断。createdAt 不受影响。
export async function saveUserName(name: string): Promise<void> {
  const dek = getDek()
  if (!dek) throw new Error('未解锁')
  const trimmed = name.trim().slice(0, USER_NAME_MAX)
  if (!trimmed) throw new Error('名字不能为空')
  const { ciphertext, iv } = await putName(dek, trimmed)
  const createdAt = cached?.createdAt ?? null
  setCached({ name: trimmed, createdAt })
  void cacheProfile({ nameCiphertext: ciphertext, nameIv: iv, createdAt })
}
