'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PRF_UNAVAILABLE, fetchSession, getDek, loginWithPasskey } from './session'

// 页面守卫 + 原地自动解锁：
// 已认证但 DEK 为空（刷新后内存清空）时，在本页直接调用 Face ID 解锁——成功后**无需导航**，
// 当前页面继续渲染。避免"解锁成功 → 跳转 → iOS Safari 重载页面 → 内存 DEK 丢失 → 踢回登录"的循环。
// 失败/取消（或 PRF 不可用需恢复密钥）才跳转 /login。
export function useRequireUnlock(): 'loading' | 'ready' | 'need-login' | 'error' {
  const router = useRouter()
  const [state, setState] = useState<'loading' | 'ready' | 'need-login' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const s = await fetchSession()
        if (!s.initialized) { router.replace('/setup'); return }
        if (!s.authenticated) { router.replace('/login'); return }
        if (getDek()) { setState('ready'); return }
        // 原地自动解锁（本页面实例只尝试一次；页面不重载，无循环风险）
        const result = await loginWithPasskey()
        if (cancelled) return
        if (result.ok && getDek()) { setState('ready'); return }
        if (result.error === PRF_UNAVAILABLE) { router.replace('/login'); return }
        router.replace('/login?reason=no-dek')
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => { cancelled = true }
  }, [router])

  return state
}
