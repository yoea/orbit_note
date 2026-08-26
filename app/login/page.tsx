'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fetchSession, getDek, loginWithPasskey, unlockWithRecoveryKey } from '@/lib/client/session'

export default function LoginPage() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'passkey' | 'recovery'>('passkey')
  const [recoveryKey, setRecoveryKey] = useState('')

  useEffect(() => {
    void (async () => {
      const s = await fetchSession()
      if (!s.initialized) { router.replace('/setup'); return }
      // 已认证且 DEK 在内存才进首页；否则停留本页重新解锁（DEK 刷新即清空，规格二十六节）
      if (s.authenticated && getDek()) { router.replace('/'); return }
    })()
  }, [router])

  async function handlePasskey() {
    setBusy(true); setError(null)
    const result = await loginWithPasskey()
    if (result.ok) { router.replace('/'); return }
    if (result.error === 'prf_unavailable') { setMode('recovery'); setBusy(false); return }
    setError(result.error ?? '登录失败'); setBusy(false)
  }

  async function handleRecoverySubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const result = await unlockWithRecoveryKey(recoveryKey.trim())
    if (result.ok) { router.replace('/'); return }
    setError(result.error ?? '登录失败'); setBusy(false)
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
          <p className="text-sm text-neutral-500">此浏览器不支持 PRF，请输入恢复密钥解锁</p>
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
