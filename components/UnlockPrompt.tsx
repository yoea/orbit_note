'use client'

import { useState } from 'react'
import OrbitLogo from './OrbitLogo'

// 手动解锁入口（留在当前页，用户手势下 Face ID 正常）；支持错误信息展示。
// 点击后延迟 300ms 再发起认证——iOS PWA 冷启动后立即调用 WebAuthn 偶发失败，
// 短暂延迟让系统稳定，减少"首次识别无响应"。
export default function UnlockPrompt({ onUnlock }: { onUnlock: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUnlock() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      await new Promise((r) => setTimeout(r, 300))
      const err = await onUnlock()
      if (err) setError(err)
    } catch {
      setError('解锁失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col px-6 safe-pb">
      {/* m-auto：LOGO + 按钮整体垂直居中 */}
      <div className="m-auto flex w-full max-w-xs flex-col items-center gap-8">
        {/* 品牌 LOGO */}
        <OrbitLogo size="lg" />
        <div className="w-full">
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
      </div>
    </main>
  )
}
