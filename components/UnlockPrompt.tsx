'use client'

import { useState } from 'react'
import OrbitLogo from './OrbitLogo'

// 手动解锁入口（留在当前页）；单次认证完成登录+解锁。
// 点击后立即唤起系统通行密钥弹窗（userVerification: discouraged——不自动识别，
// 用户点击通行密钥后由系统决定是否 Face ID）。
export default function UnlockPrompt({ onUnlock }: { onUnlock: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUnlock() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const err = await onUnlock() // 立即唤起系统通行密钥弹窗
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
            className="w-full rounded-2xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-4 text-base font-medium text-white active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? '正在验证…' : '使用通行密钥登录'}
          </button>
          <p className="mt-3 text-center text-xs text-neutral-400">通过通行密钥快速安全登录</p>
          <p className="mt-1 text-center text-[10px] text-neutral-400/70">支持指纹、Face ID、Windows Hello 等</p>
          {error && <p className="mt-3 text-center text-sm text-red-500">{error}</p>}
        </div>
      </div>
    </main>
  )
}
