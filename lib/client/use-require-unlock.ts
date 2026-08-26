'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PRF_UNAVAILABLE, fetchSession, getDek, initDek, loginWithPasskey } from './session'

export type UnlockState = 'loading' | 'ready' | 'need-unlock' | 'error'

// 页面守卫 + 解锁：
// 1. 先从 sessionStorage 恢复 DEK（会话级持久化——PWA 导航重载后自动恢复，无需重复 Face ID）
// 2. 已认证但 DEK 仍为空（新会话/清除过）→ 自动触发一次 Face ID 解锁（原地，不跳转）
// 3. 自动解锁失败/取消 → 'need-unlock'：留在本页显示手动解锁按钮（用户手势下 Face ID 正常）
// 4. 仅 PRF 不可用（需恢复密钥）或未认证时跳转 /login
export function useRequireUnlock(): { state: UnlockState; retryUnlock: () => Promise<void> } {
  const router = useRouter()
  const [state, setState] = useState<UnlockState>('loading')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // 会话级恢复（同步内存缓存；导航/重载后 DEK 自动回来）
        await initDek()
        const s = await fetchSession()
        if (!s.initialized) { router.replace('/setup'); return }
        if (!s.authenticated) { router.replace('/login'); return }
        if (getDek()) { setState('ready'); return }
        // 原地自动解锁（页面实例尝试一次；页面不重载，无循环风险）
        const result = await loginWithPasskey()
        if (cancelled) return
        if (result.ok && getDek()) { setState('ready'); return }
        if (result.error === PRF_UNAVAILABLE) { router.replace('/login'); return }
        // 其他失败（取消/浏览器拦截自动调用等）：留在本页，用户手动触发
        setState('need-unlock')
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => { cancelled = true }
  }, [router])

  // 手动解锁（用户手势下 WebAuthn 正常）：成功 → ready；PRF 不可用 → 登录页（恢复密钥）
  const retryUnlock = useCallback(async (): Promise<void> => {
    const result = await loginWithPasskey()
    if (result.ok && getDek()) { setState('ready'); return }
    if (result.error === PRF_UNAVAILABLE) { router.replace('/login'); return }
    setState('need-unlock') // 保持本页，可再试
  }, [router])

  return { state, retryUnlock }
}
