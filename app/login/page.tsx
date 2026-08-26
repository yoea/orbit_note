'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PRF_UNAVAILABLE, fetchSession, getDek, loginWithPasskey, unlockWithRecoveryKey } from '@/lib/client/session'

export default function LoginPage() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [mode, setMode] = useState<'passkey' | 'recovery'>('passkey')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [reason, setReason] = useState<string | null>(() => {
    // 首页守卫踢回时携带原因（诊断）
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('reason')
  })
  // 自动解锁尝试标记：session 有效但 DEK 为空时（刷新后），自动触发一次 Face ID 认证，
  // 避免"刷新 → 登录页 → 再点一次"的重复操作（WebAuthn get 无需用户手势，iOS 弹 Face ID 确认一次即可）。
  const autoUnlockTriedRef = useRef(false)

  useEffect(() => {
    void (async () => {
      try {
        const s = await fetchSession()
        if (!s.initialized) { router.replace('/setup'); return }
        // 已认证且 DEK 在内存才进首页；否则停留本页重新解锁（DEK 刷新即清空，规格二十六节）
        if (s.authenticated && getDek()) { router.replace('/'); return }
        // 已认证但 DEK 为空（刷新后）：自动触发一次 Face ID 解锁（PRF 可用时直接进入；
        // 失败/取消则停留在 Face ID 按钮，用户可手动重试或切恢复密钥）
        if (s.authenticated && !getDek() && !autoUnlockTriedRef.current) {
          autoUnlockTriedRef.current = true
          setTimeout(() => void handlePasskey(), 300) // 延迟到首帧渲染后，避免 effect 内同步 setState
        }
      } catch {
        // 网络/服务错误：绝不走初始化分支，停留在本页提示
        setLoadError(true)
      }
    })()
  }, [router])

  // 回到来源页面（守卫跳转时携带 ?from=），默认首页
  function goToFrom() {
    const from = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('from') : null
    router.replace(from && from.startsWith('/') ? from : '/')
  }

  async function handlePasskey() {
    setBusy(true); setError(null)
    try {
      const result = await loginWithPasskey()
      if (result.ok) { goToFrom(); return }
      if (result.error === PRF_UNAVAILABLE) { setMode('recovery'); return }
      setError(result.error ?? '登录失败')
    } catch {
      setError('登录失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleRecoverySubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const result = await unlockWithRecoveryKey(recoveryKey.trim())
      if (result.ok) {
        goToFrom()
        return
      }
      setError(result.error ?? '登录失败')
    } catch {
      setError('登录失败')
    } finally {
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 safe-pb">
        <p className="text-sm text-neutral-500">连接失败，请检查网络后重试</p>
        <button onClick={() => window.location.reload()} className="rounded-xl bg-neutral-900 px-6 py-3 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
          重试
        </button>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 safe-pb">
      <h1 className="text-2xl font-semibold text-neutral-800 dark:text-neutral-100">我的日记</h1>
      {mode === 'passkey' ? (
        <button
          onClick={() => void handlePasskey()}
          disabled={busy}
          className="w-full max-w-xs rounded-2xl bg-neutral-900 px-6 py-4 text-base font-medium text-white active:scale-[0.98] disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {busy ? '正在验证…' : '使用 Face ID 解锁'}
        </button>
      ) : (
        <form onSubmit={(e) => void handleRecoverySubmit(e)} className="flex w-full max-w-xs flex-col gap-3">
          <p className="text-sm text-neutral-500">通行密钥已验证 ✓，请输入恢复密钥完成解锁</p>
          <input
            value={recoveryKey}
            onChange={(e) => setRecoveryKey(e.target.value)}
            placeholder="粘贴恢复密钥"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-base outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <button type="submit" disabled={busy || !recoveryKey.trim()} className="rounded-xl bg-neutral-900 px-6 py-4 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">
            {busy ? '正在解锁…' : '解锁'}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {reason === 'no-dek' && <p className="text-sm text-amber-600 dark:text-amber-400">解锁未完成：密钥未载入内存（诊断 no-dek）</p>}
      {reason === 'no-auth' && <p className="text-sm text-amber-600 dark:text-amber-400">会话未建立（诊断 no-auth）</p>}
      {mode === 'recovery' && (
        <button onClick={() => setMode('passkey')} className="text-sm text-neutral-400 underline">返回 Face ID</button>
      )}
    </main>
  )
}
