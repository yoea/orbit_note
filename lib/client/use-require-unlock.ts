'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PRF_UNAVAILABLE, fetchSession, getDek, loginWithPasskey } from './session'

export type UnlockState = 'loading' | 'ready' | 'need-unlock' | 'error'

// 页面守卫 + 原地自动解锁：
// 已认证但 DEK 为空（刷新/后退恢复导致内存清空）时，在本页直接调用 Face ID 解锁——
// 成功后无需导航，当前页面继续渲染（避免 iOS 导航/重载丢内存 DEK 的循环）。
// 自动解锁失败/取消（如 bfcache 恢复时浏览器拦截非手势 WebAuthn 调用）→ 进入
// 'need-unlock'：留在本页显示手动解锁按钮（用户手势下 Face ID 正常），不跳转登录页。
// 仅 PRF 不可用（需恢复密钥）或未认证时跳转 /login。
export function useRequireUnlock(): { state: UnlockState; retryUnlock: () => Promise<void> } {
  const router = useRouter()
  const [state, setState] = useState<UnlockState>('loading')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const s = await fetchSession()
        if (!s.initialized) { router.replace('/setup'); return }
        if (!s.authenticated) { router.replace('/login'); return }
        if (getDek()) { setState('ready'); return }
        // 自动解锁仅每会话自动弹一次（sessionStorage 标记）：
        // iOS Safari 在 Face ID 弹窗后可能重载页面 → 内存 DEK 丢失 → 若不限制会重复弹窗。
        // 重载后不再自动弹，显示手动解锁按钮（用户手势下 Face ID 正常）。
        let autoAllowed = true
        try { autoAllowed = sessionStorage.getItem('qo-auto-unlock-attempted') !== '1' } catch { /* ignore */ }
        if (!autoAllowed) { setState('need-unlock'); return }
        try { sessionStorage.setItem('qo-auto-unlock-attempted', '1') } catch { /* ignore */ }
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
