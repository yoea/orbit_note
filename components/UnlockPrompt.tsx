'use client'

import { useState } from 'react'

// 手动解锁入口（留在当前页，用户手势下 Face ID 正常）；支持错误信息展示
export default function UnlockPrompt({ onUnlock }: { onUnlock: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUnlock() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const err = await onUnlock()
      if (err) setError(err)
    } catch {
      setError('解锁失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 safe-pb">
      {/* 应用图标 */}
      <div className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-neutral-900 text-3xl font-bold text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900">
        O
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-neutral-800 dark:text-neutral-100">Orbit</h1>
        <p className="mt-2 text-sm text-neutral-400">安全 · 私密 · 只属于你</p>
      </div>
      <div className="w-full max-w-xs">
        <button
          onClick={() => void handleUnlock()}
          disabled={busy}
          className="w-full rounded-2xl bg-neutral-900 px-6 py-4 text-base font-medium text-white active:scale-[0.98] disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {busy ? '正在验证…' : '使用通行密钥登录'}
        </button>
        <p className="mt-3 text-center text-xs text-neutral-400">通过 Face ID 或 Windows Hello 快速安全登录</p>
        {error && <p className="mt-3 text-center text-sm text-red-500">{error}</p>}
      </div>
    </main>
  )
}
