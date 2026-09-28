'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PRF_UNAVAILABLE, fetchSession, getDek, initDek, loginWithPasskey } from './session'

export type UnlockState = 'loading' | 'ready' | 'need-unlock' | 'error'

// 页面守卫 + 解锁：
// 1. 先从 sessionStorage 恢复 DEK（会话级持久化——导航/重载后自动恢复，无需重复 Face ID）
// 2. 已认证但 DEK 为空（冷启动/新会话）→ 'need-unlock'：显示手动解锁按钮。
//    不做无手势自动 WebAuthn 调用——iOS PWA 冷启动时会被拦截（弹了 Face ID 也失败，
//    造成"识别了却没登录"的困惑）；用户点击一次（有手势）即成功。
// 3. 未认证 → /login；PRF 不可用（解锁时返回）→ /login（恢复密钥模式）
export function useRequireUnlock(): { state: UnlockState; retryUnlock: () => Promise<string | null> } {
  const router = useRouter()
  const [state, setState] = useState<UnlockState>('loading')
  // 自动重试标记：iOS PWA 冷启动后首次 WebAuthn 认证偶发失败（弹窗识别后无响应），
  // 失败时自动重试一次（页面实例级），仍失败则返回错误信息供界面显示
  const retriedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // 会话级恢复（导航/重载后 DEK 自动回来）
        await initDek()
        const s = await fetchSession()
        if (!s.initialized) { router.replace('/setup'); return }
        if (!s.authenticated) { router.replace('/login'); return }
        if (getDek()) { setState('ready'); return }
        // 无 DEK：手动解锁（一次点击，Face ID 正常）
        setState('need-unlock')
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => { cancelled = true }
  }, [router])

  // 手动解锁（用户手势下 WebAuthn 正常）：成功 → ready；PRF 不可用 → 登录页（恢复密钥）；
  // 失败 → 自动重试一次（iOS PWA 首次 get 偶发失败），仍失败返回错误信息。
  // 递归体抽成内部函数：避免在 useCallback 初始化器里引用 retryUnlock 自身
  // （react-hooks/immutability 会判定为「未声明先使用」）。
  const retryUnlock = useCallback(async (): Promise<string | null> => {
    async function attempt(isRetry: boolean): Promise<string | null> {
      const result = await loginWithPasskey()
      if (result.ok && getDek()) { setState('ready'); return null }
      if (result.error === PRF_UNAVAILABLE) { router.replace('/login'); return null }
      if (!isRetry) {
        retriedRef.current = true
        // 首次失败不向调用方报错，稍后自动重试一次
        setTimeout(() => { void attempt(true) }, 400)
        return null
      }
      return result.error ?? '解锁失败，请重试'
    }
    return attempt(retriedRef.current)
  }, [router])

  return { state, retryUnlock }
}
