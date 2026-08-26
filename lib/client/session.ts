import { authenticatePasskey } from './webauthn'
import { derivePrfKek, unwrapWithRecoveryKey } from './crypto/setup'
import { unwrapDekFromWrapper } from './crypto/encryption'
import type { WrappedKeyRow } from './types'

export interface SessionState {
  initialized: boolean
  authenticated: boolean
  credentialCount: number
  prfWrappers: number
  hasRecoveryWrapper: boolean
}

export interface LoginResult {
  ok: boolean
  error?: string
  via: 'prf' | 'recovery' | null
}

// 解锁后的 DEK 仅存内存（模块级变量），刷新即清空 —— 规格二十六节
let dek: CryptoKey | null = null

export function getDek(): CryptoKey | null {
  return dek
}
export function clearDek(): void {
  dek = null
}

export async function fetchSession(): Promise<SessionState> {
  const res = await fetch('/api/auth/session')
  return res.json()
}

export async function fetchWrappers(): Promise<WrappedKeyRow[]> {
  const res = await fetch('/api/keys/wrappers')
  if (!res.ok) throw new Error('获取密钥包装失败')
  const data = await res.json()
  return data.wrappers as WrappedKeyRow[]
}

// Passkey + PRF 解锁（正常路径）
export async function loginWithPasskey(): Promise<LoginResult> {
  const optionsRes = await fetch('/api/auth/login/options')
  if (!optionsRes.ok) return { ok: false, error: '获取登录选项失败', via: null }
  const { token, options, prfEval } = await optionsRes.json()

  const { assertion, prfResult } = await authenticatePasskey(options, prfEval)
  const loginRes = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, assertion }),
  })
  if (!loginRes.ok) return { ok: false, error: '登录验证失败', via: null }

  // 登录成功后拉取 wrappers 并解锁
  if (prfResult) {
    const wrappers = await fetchWrappers()
    const prfWrapper = wrappers.find((w) => w.wrapperType === 'passkey_prf')
    if (prfWrapper) {
      try {
        const kek = await derivePrfKek(prfResult, prfWrapper.salt)
        dek = await unwrapDekFromWrapper(kek, prfWrapper.encryptedDek)
        return { ok: true, via: 'prf' }
      } catch {
        return { ok: false, error: '解锁失败', via: null }
      }
    }
    return { ok: false, error: 'prf_unavailable', via: null }
  }
  // PRF 无结果（浏览器不支持）→ 前端转入 recovery 输入模式
  return { ok: false, error: 'prf_unavailable', via: null }
}

// Recovery Key 解锁统一入口：
//  - 已有 session（passkey 已认证但 PRF 不可用）→ 直接拉 wrappers 解包
//  - 无 session（丢失全部 passkey）→ 先调 recovery-login（服务器 SHA-256 校验后签发 session），再解包
export async function unlockWithRecoveryKey(recoveryKey: string): Promise<LoginResult> {
  let wrappers: WrappedKeyRow[]
  try {
    wrappers = await fetchWrappers()
  } catch {
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
    dek = await unwrapWithRecoveryKey(recWrapper.encryptedDek, recWrapper.salt, recoveryKey)
    return { ok: true, via: 'recovery' }
  } catch {
    return { ok: false, error: '恢复密钥解密失败', via: null }
  }
}
