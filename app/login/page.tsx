'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PRF_UNAVAILABLE, fetchSession, getDek, loginWithPasskey, unlockWithRecoveryKey } from '@/lib/client/session'

export default function LoginPage() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [mode, setMode] = useState<'passkey' | 'recovery'>('passkey')
  const [recoveryKey, setRecoveryKey] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const s = await fetchSession()
        if (!s.initialized) { router.replace('/setup'); return }
        // 已认证且 DEK 在内存才进首页；否则停留本页重新解锁（DEK 刷新即清空，规格二十六节）
        if (s.authenticated && getDek()) { router.replace('/'); return }
        // 已认证但 DEK 为空（passkey 验证成功、PRF 不可用、未完成加密解锁）：
        // 直接进入恢复密钥模式，避免重复 Face ID 认证
        if (s.authenticated && !getDek()) { setMode('recovery'); return }
      } catch {
        // 网络/服务错误：绝不走初始化分支，停留在本页提示
        setLoadError(true)
      }
    })()
  }, [router])

  async function handlePasskey() {
    setBusy(true); setError(null)
    try {
      const result = await loginWithPasskey()
      if (result.ok) { router.replace('/'); return }
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
        // 回到来源页面（守卫跳转时携带 ?from=），默认首页
        const from = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('from') : null
        router.replace(from && from.startsWith('/') ? from : '/')
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
      {mode === 'recovery' && (
        <button onClick={() => setMode('passkey')} className="text-sm text-neutral-400 underline">返回 Face ID</button>
      )}
    </main>
  )
}
