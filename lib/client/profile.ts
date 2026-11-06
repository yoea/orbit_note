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
  /** 头像版本号（= avatarUpdatedAt 毫秒）；null = 没设置头像，界面回退首字母 */
  avatarVersion: number | null
}

// ── 头像版本号的同步持久化（2026-11-06：修「刷新 / 首次进设置页头像闪一下」）────
// 只存一个毫秒时间戳：不存图片，更不存任何签名 URL（签名地址会过期，落盘就是死链）。
// 目的：React 首帧**同步**就知道「有没有头像、该用哪个稳定 URL」，不必等 /api/profile。
// 图片本体由浏览器按 immutable 头缓存（GET /api/avatar?v=<version>）。
// 两层配合才成立：URL 稳定 ⇒ 缓存命中；version 同步可得 ⇒ 首帧就有 <img>。
const AVATAR_VERSION_KEY = 'qo-avatar-version'
let persistedAvatarVersion: number | null | undefined // undefined = 本次还没读过

function readPersistedAvatarVersion(): number | null {
  if (persistedAvatarVersion !== undefined) return persistedAvatarVersion
  // SSR 不读、也不缓存：服务端没有 localStorage，客户端 hydration 后要重新读。
  if (typeof window === 'undefined') return null
  let value: number | null = null
  try {
    const raw = window.localStorage.getItem(AVATAR_VERSION_KEY)
    const n = raw === null ? NaN : Number(raw)
    if (Number.isFinite(n) && n > 0) value = n
  } catch { /* 隐私模式 / 存储被禁：当作没有头像，纯走网络也能用 */ }
  persistedAvatarVersion = value
  return value
}

function writePersistedAvatarVersion(version: number | null): void {
  persistedAvatarVersion = version
  if (typeof window === 'undefined') return
  try {
    if (version === null) window.localStorage.removeItem(AVATAR_VERSION_KEY)
    else window.localStorage.setItem(AVATAR_VERSION_KEY, String(version))
  } catch { /* 写不进去只影响下次冷启动的首帧，功能照常 */ }
}

// 会话级缓存：解锁后读一次即可，避免每个页面重复「拉取 + 解密」。
// 同时作为极简订阅源——改名 / 换头像后所有正在显示的组件都要跟着更新，
// 否则设置页改完，别的页面（以及它自己）还显示旧值。
let cached: ProfileState | null = null
const listeners = new Set<() => void>()

function setCached(next: ProfileState | null): void {
  if (
    cached?.name === next?.name &&
    cached?.createdAt === next?.createdAt &&
    cached?.avatarVersion === next?.avatarVersion
  ) return
  // 每次资料变化都顺手同步版本号：换图、删图、/api/profile 校准都走这里
  writePersistedAvatarVersion(next?.avatarVersion ?? null)
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

/** 会话缓存是权威；首帧（缓存还没建立）用同步持久化的版本号。 */
export function getUserAvatarVersion(): number | null {
  if (cached) return cached.avatarVersion
  return readPersistedAvatarVersion()
}

/**
 * 头像的**稳定同源 URL**。字符串按值比较，可安全用作 useSyncExternalStore 快照。
 * ★ 只有换图才变 ⇒ 平时浏览器 immutable 缓存命中、刷新零请求；换图才重新加载。
 */
export function getAvatarSrc(): string | null {
  const version = getUserAvatarVersion()
  return version === null ? null : `/api/avatar?v=${version}`
}

export function subscribeProfile(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// 退出登录 / 清空 DEK 时调用，避免下一个人看到上一个人的名字。
// ★ 显式清持久化版本号：不能只靠 setCached(null) —— 名字还没加载时 cached 本来就是 null，
//   相等检查会短路，localStorage 里就留着上一任的头像版本。
export function clearUserNameCache(): void {
  writePersistedAvatarVersion(null)
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
export async function loadUserName(opts?: { force?: boolean }): Promise<string> {
  // ★ 默认缓存命中就返回；`force` 用于「头像刚改完，必须和服务端对一次」——
  //   之前没有这个参数，导致上传成功后调用它也被短路，界面拿不到新的签名 URL（真机事故）。
  if (cached && !opts?.force) return cached.name
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
          // 离线兜底：只有名字能解。头像版本号取同步持久化的那份（本次会话在线加载过就是新值），
          // 图片本身走浏览器 HTTP 缓存，离线也能显示。
          // ★ 用 getter 而不是直接读 `cached`：后者在这里会被 TS 收窄成 never。
          setCached({
            name,
            createdAt: offlineProfile.createdAt,
            avatarVersion: getUserAvatarVersion(),
          })
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
    avatar: { version: number } | null
  }
  const createdAt = data.createdAt ?? null
  // 头像版本号：进会话缓存的同时由 setCached 同步写进 localStorage，
  // 让下一轮冷启动的首帧就能拼出稳定 URL。图片本体不进 IndexedDB —— 交给浏览器
  // 按 immutable 头缓存，只有 version 变化才重新取。
  const avatarVersion = data.avatar?.version ?? null
  if (data.profile) {
    try {
      const name = await decryptText(dek, data.profile.nameCiphertext, data.profile.nameIv)
      if (name) {
        setCached({ name, createdAt, avatarVersion })
        // 在线成功顺手缓存密文（离线兜底用），异步不阻塞
        void cacheProfile({ nameCiphertext: data.profile.nameCiphertext, nameIv: data.profile.nameIv, createdAt })
        return name
      }
    } catch { /* 解密失败（如换过 DEK）→ 视为未设置，重建默认名 */ }
  }
  const name = generateDefaultName()
  const { ciphertext, iv } = await putName(dek, name)
  setCached({ name, createdAt, avatarVersion })
  void cacheProfile({ nameCiphertext: ciphertext, nameIv: iv, createdAt })
  return name
}

// 改名（设置页）。空名拒绝；超长按上限截断。createdAt / 头像都不受影响。
export async function saveUserName(name: string): Promise<void> {
  const dek = getDek()
  if (!dek) throw new Error('未解锁')
  const trimmed = name.trim().slice(0, USER_NAME_MAX)
  if (!trimmed) throw new Error('名字不能为空')
  const { ciphertext, iv } = await putName(dek, trimmed)
  const createdAt = cached?.createdAt ?? null
  setCached({
    name: trimmed,
    createdAt,
    avatarVersion: cached?.avatarVersion ?? null,
  })
  void cacheProfile({ nameCiphertext: ciphertext, nameIv: iv, createdAt })
}

// 上传/删除头像后立即更新版本号，让所有显示头像的地方（设置页卡片、大图弹窗）同步刷新。
// ★ 缓存还没建立时（名字仍在加载）也要能写入：之前这里是 `if (!cached) return`，
//   于是在名字没加载完的情况下换了头像，界面永远等不到更新（真机事故）。
// ★ 只传版本号：URL 由 getAvatarSrc() 统一拼，杜绝任何「临时签名地址」回到客户端。
export function setCachedAvatar(version: number | null): void {
  const base: ProfileState = cached ?? { name: '', createdAt: null, avatarVersion: null }
  setCached({ ...base, avatarVersion: version })
}
