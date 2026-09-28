import { authenticatePasskey } from './webauthn'
import { detectDeviceName } from './device'
import { syncPrefsFromServer } from './prefs'
import { derivePrfKek, unwrapWithRecoveryKey } from './crypto/setup'
import { unwrapDekFromWrapper } from './crypto/encryption'
import type { WrappedKeyRow } from './types'

// PRF 不可用/无结果错误码：登录页据此切换到 Recovery Key 输入模式
export const PRF_UNAVAILABLE = 'prf_unavailable'

// 服务器错误码 → 用户可读的中文提示（登录页显示；未列出的码原样透传便于定位）
export const LOGIN_ERRORS: Record<string, string> = {
  unknown_credential: '此通行密钥不存在或已被删除',
  disabled_credential: '此通行密钥已被禁用',
  verification_failed: '通行密钥验证失败，请重试',
  counter_replay_detected: '通行密钥验证异常，请重新注册',
  challenge_expired: '验证已过期，请重试',
  too_many_requests: '操作太频繁，请稍后再试',
}

// credentialCount / prfWrappers / hasRecoveryWrapper 仅在已认证时由服务端返回
// （未认证响应不含这三个字段，见 /api/auth/session）；客户端当前无人读取，留作诊断。
export interface SessionState {
  initialized: boolean
  authenticated: boolean
  credentialCount?: number
  prfWrappers?: number
  hasRecoveryWrapper?: boolean
}

export interface LoginResult {
  ok: boolean
  error?: string
  via: 'prf' | 'recovery' | null
}

// 解锁后的 DEK：globalThis 内存缓存 + sessionStorage 会话级持久化。
// iOS PWA（standalone）中任何页面导航都会触发完整重载，纯内存 DEK 每次导航后丢失、
// 被迫重复 Face ID——sessionStorage 在导航/重载后保留（同标签页会话），DEK 自动恢复。
// 安全权衡（用户确认）：sessionStorage 为会话级（关闭标签页清除、不落盘），
// XSS 威胁模型下与内存持有等价（脚本均可访问）。
import { fromBase64, toBase64, toBase64Url } from './crypto/base64'
import { cacheWrappersForOffline, getCachedWrappers, isOfflineUnlockAvailable, requestPersistentStorage } from './offline'

const DEK_KEY = '__orbit_dek__'
const DEK_SESSION_KEY = 'qo_dek'

export function getDek(): CryptoKey | null {
  return (globalThis as Record<string, unknown>)[DEK_KEY] as CryptoKey | null ?? null
}
export function setDek(key: CryptoKey): void {
  ;(globalThis as Record<string, unknown>)[DEK_KEY] = key
}
export function clearDek(): void {
  ;(globalThis as Record<string, unknown>)[DEK_KEY] = null
  try { sessionStorage.removeItem(DEK_SESSION_KEY) } catch { /* ignore */ }
}

// 将内存 DEK 持久化到 sessionStorage（登录/解锁成功后调用）
export async function persistDek(): Promise<void> {
  const key = getDek()
  if (!key) return
  try {
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key))
    sessionStorage.setItem(DEK_SESSION_KEY, toBase64(raw))
  } catch { /* 导出失败忽略 */ }
}

// 从 sessionStorage 恢复 DEK（页面重载后调用；成功则已写入内存）
export async function initDek(): Promise<boolean> {
  if (getDek()) return true
  try {
    const b64 = sessionStorage.getItem(DEK_SESSION_KEY)
    if (!b64) return false
    const raw = fromBase64(b64)
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    ;(globalThis as Record<string, unknown>)[DEK_KEY] = key
    return true
  } catch {
    return false
  }
}

export async function fetchSession(): Promise<SessionState> {
  const res = await fetch('/api/auth/session')
  if (!res.ok) throw new Error('会话状态获取失败')
  return res.json()
}

export async function fetchWrappers(): Promise<WrappedKeyRow[]> {
  const res = await fetch('/api/keys/wrappers')
  if (!res.ok) throw new Error('获取密钥包装失败')
  const data = await res.json()
  return data.wrappers as WrappedKeyRow[]
}

// Passkey + PRF 解锁（正常路径）。契约：绝不 throw——所有失败以 LoginResult.error 返回。
// 单次认证（1 次 get 带 PRF，1 次 Face ID 完成登录+解锁）：
// iOS 弹窗会自动尝试 Face ID——若用户未准备好（刚点击未注视镜头）会识别失败需重试。
// 调用方（UnlockPrompt）会在 get 前展示"请注视屏幕"准备提示，让自动识别一次成功。
export async function loginWithPasskey(): Promise<LoginResult> {
  try {
    const optionsRes = await fetch('/api/auth/login/options')
    if (!optionsRes.ok) return { ok: false, error: '获取登录选项失败', via: null }
    const { token, options, prfEval } = await optionsRes.json()

    // 单次 get（带 PRF eval）：认证 + PRF 输出一次完成
    const { assertion, prfResult } = await authenticatePasskey(options, prfEval)
    const loginRes = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // device：登录时上报设备名——凭证从未打标时服务器自动补标（设置页区分设备）
      body: JSON.stringify({ token, assertion, device: detectDeviceName(navigator.userAgent) }),
    })
    if (!loginRes.ok) {
      // 服务器只返回错误码不返回敏感信息；这里把错误码映射成中文提示
      const serverError = (await loginRes.json().catch(() => null)) as { error?: string } | null
      const code = serverError?.error
      return { ok: false, error: code ? (LOGIN_ERRORS[code] ?? code) : '登录验证失败', via: null }
    }

    // 登录成功后拉取 wrappers 并解锁
    if (prfResult) {
      const wrappers = await fetchWrappers()
      // 关键：PRF 输出按凭证隔离——每把通行密钥有自己的 PRF 密钥，同一 eval 输入 S 的
      // 输出也各不相同。必须用"与本次认证凭证匹配"的 wrapper 解包（每把钥匙一个 wrapper，
      // credentialId 对应）。取第一个 wrapper 在单钥匙时恰好正确，多钥匙时必然解包失败。
      const assertionId = typeof assertion.id === 'string' ? assertion.id : null
      const prfWrapper = wrappers.find((w) => w.wrapperType === 'passkey_prf' && w.credentialId === assertionId)
      if (prfWrapper) {
        try {
          const kek = await derivePrfKek(prfResult, prfWrapper.salt)
          setDek(await unwrapDekFromWrapper(kek, prfWrapper.encryptedDek))
          await persistDek() // 会话级持久化（PWA 导航重载后自动恢复，无需重复 Face ID）
          // 离线缓存：wrappers 是密文（与服务器存的一致），缓存后断网时也能本地解锁
          await cacheWrappersForOffline(wrappers)
          void requestPersistentStorage() // 防 iOS 存储压力下回收 IndexedDB
          void syncPrefsFromServer() // 登录成功：数据库偏好 → localStorage（多端同步）
          return { ok: true, via: 'prf' }
        } catch {
          return { ok: false, error: '解锁失败', via: null }
        }
      }
      return { ok: false, error: PRF_UNAVAILABLE, via: null }
    }
    // PRF 无结果（浏览器不支持）→ 前端转入 recovery 输入模式
    return { ok: false, error: PRF_UNAVAILABLE, via: null }
  } catch (e) {
    // 用户取消 Face ID 弹窗（NotAllowedError）是必然路径，需与网络/服务错误区分
    if (e instanceof Error && e.name === 'NotAllowedError') {
      return { ok: false, error: '已取消认证', via: null }
    }
    // 其他错误透传具体信息（诊断：iOS 弹窗"无效识别"会抛 NotSupportedError/SecurityError 等）
    return { ok: false, error: e instanceof Error ? `认证失败：${e.message}` : '解锁失败', via: null }
  }
}

// Recovery Key 解锁统一入口：
//  - 已有 session（passkey 已认证但 PRF 不可用）→ 直接拉 wrappers 解包
//  - 无 session（丢失全部 passkey）→ 先调 recovery-login（服务器 SHA-256 校验后签发 session），再解包
// 契约：绝不 throw——所有失败以 LoginResult.error 返回。
export async function unlockWithRecoveryKey(recoveryKey: string): Promise<LoginResult> {
  try {
    let wrappers: WrappedKeyRow[]
    try {
      wrappers = await fetchWrappers()
    } catch {
      // 网络失败：先试离线缓存的 recovery wrapper——恢复密钥解包全程本地（PRF 不涉及），
      // 有缓存即可离线解锁。无缓存才走在线 recovery-login（其失败原样返回错误）。
      const cached = (await getCachedWrappers())?.find((w) => w.wrapperType === 'recovery')
      if (cached) {
        try {
          setDek(await unwrapWithRecoveryKey(cached.encryptedDek, cached.salt, recoveryKey))
          await persistDek()
          void requestPersistentStorage()
          return { ok: true, via: 'recovery' }
        } catch {
          return { ok: false, error: '恢复密钥解密失败', via: null }
        }
      }
      const res = await fetch('/api/auth/recovery-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryKey }),
      })
      if (!res.ok) return { ok: false, error: '恢复密钥验证失败', via: null }
      wrappers = await fetchWrappers()
    }
    const recWrapper = wrappers.find((w) => w.wrapperType === 'recovery')
    if (!recWrapper) return { ok: false, error: '无恢复包装', via: null }
    try {
      setDek(await unwrapWithRecoveryKey(recWrapper.encryptedDek, recWrapper.salt, recoveryKey))
      await persistDek() // 会话级持久化
      await cacheWrappersForOffline(wrappers) // 离线缓存（含 recovery wrapper：恢复密钥也可离线解锁）
      void requestPersistentStorage()
      void syncPrefsFromServer() // 登录成功：数据库偏好 → localStorage（多端同步）
      return { ok: true, via: 'recovery' }
    } catch {
      return { ok: false, error: '恢复密钥解密失败', via: null }
    }
  } catch {
    return { ok: false, error: '解锁失败', via: null }
  }
}

// 离线解锁（飞行模式 / 服务器不可达时的本地 PRF 流程）：
// WebAuthn 的 PRF 输出派生与 DEK 解包全程本地，无需服务器验签。本地生成随机 challenge
// 只为驱动 authenticator 产出 PRF 输出——assertion 不被任何一方验证（离线本就没有验证方），
// 安全性来自「物理 possession + 生物识别」这道门本身。
// 契约与 loginWithPasskey 相同：绝不 throw，失败以 LoginResult.error 返回。
export async function offlineUnlockWithPasskey(): Promise<LoginResult> {
  try {
    const wrappers = (await getCachedWrappers())?.filter((w) => w.wrapperType === 'passkey_prf') ?? []
    if (!wrappers.length) return { ok: false, error: '离线解锁数据不可用，请联网后重试', via: null }
    // PRF eval 输入 S 对所有 passkey 一致（注册时复用同一 S 的不变量），取任一 wrapper 的 salt
    const salt = wrappers[0].salt
    const options = {
      challenge: toBase64Url(crypto.getRandomValues(new Uint8Array(32))),
      rpId: window.location.hostname,
      userVerification: 'preferred',
      timeout: 60_000,
    }
    const { assertion, prfResult } = await authenticatePasskey(options, salt)
    if (!prfResult) return { ok: false, error: PRF_UNAVAILABLE, via: null }
    // PRF 输出按凭证隔离：必须用「与本次认证凭证匹配」的 wrapper 解包（同在线流程）
    const assertionId = typeof assertion.id === 'string' ? assertion.id : null
    const prfWrapper = wrappers.find((w) => w.credentialId === assertionId)
    if (!prfWrapper) return { ok: false, error: '此通行密钥不支持离线解锁', via: null }
    try {
      const kek = await derivePrfKek(prfResult, prfWrapper.salt)
      setDek(await unwrapDekFromWrapper(kek, prfWrapper.encryptedDek))
      await persistDek()
      void requestPersistentStorage()
      return { ok: true, via: 'prf' }
    } catch {
      return { ok: false, error: '解锁失败', via: null }
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'NotAllowedError') {
      return { ok: false, error: '已取消认证', via: null }
    }
    return { ok: false, error: e instanceof Error ? `认证失败：${e.message}` : '解锁失败', via: null }
  }
}

// 统一解锁入口（登录页与守卫都用这个）：在线优先，拿不到登录选项（网络不可达）且
// 离线缓存可用时回退离线解锁。在线路径行为不变——只有原会立刻失败的网络分支多一次回退。
export async function unlockWithPasskeyAuto(): Promise<LoginResult> {
  const online = typeof navigator === 'undefined' || navigator.onLine
  if (!online) {
    return (await isOfflineUnlockAvailable()) ? offlineUnlockWithPasskey() : loginWithPasskey()
  }
  const result = await loginWithPasskey()
  if (result.ok) return result
  // 「获取登录选项失败」= login/options 请求本身没到达（网络断/服务器不可达）
  if (result.error === '获取登录选项失败' && (await isOfflineUnlockAvailable())) {
    return offlineUnlockWithPasskey()
  }
  return result
}
