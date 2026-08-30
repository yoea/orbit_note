'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fetchSession, fetchWrappers } from '@/lib/client/session'
import PageTransition from '@/components/PageTransition'
import { createWrappedDek, unwrapWithRecoveryKey } from '@/lib/client/crypto/setup'
import { decodeRecoveryKey, generateRecoveryKey, sha256Hex } from '@/lib/client/crypto/recovery-key'
import { copyText } from '@/lib/client/clipboard'

// 重新生成恢复密钥：输入当前密钥验证（能解开 wrapper 才算验证通过）→ 生成新密钥 →
// 用新密钥重新包裹 DEK 并更新服务器（wrapper + SHA-256 哈希）。旧密钥立即失效。
export default function RecoverySettingsPage() {
  const router = useRouter()
  const [currentKey, setCurrentKey] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function handleCopyResult() {
    if (!result) return
    const ok = await copyText(result)
    setCopyState(ok ? 'copied' : 'failed')
  }

  async function verifyAndProceed() {
    setBusy(true); setError(null)
    try {
      const wrappers = await fetchWrappers()
      const rec = wrappers.find((w) => w.wrapperType === 'recovery')
      if (!rec) throw new Error('未找到恢复包装')
      // 验证当前密钥：能解开 wrapper 才算正确
      const dek = await unwrapWithRecoveryKey(rec.encryptedDek, rec.salt, currentKey.trim())
      // 生成新 key，用新 key 包裹 DEK 并更新服务器
      // IKM 必须是 decodeRecoveryKey 解码后的 32 字节（与 setup/unlock 的 unwrapWithRecoveryKey 内部一致）——
      // 用 43 字符 ASCII 文本作 IKM 会导致新 wrapper 永远解不开（质量审查 C3）
      const next = generateRecoveryKey()
      const wrapped = await createWrappedDek(dek, decodeRecoveryKey(next), 'recovery-kek')
      const up = await fetch('/api/keys/wrappers/recovery', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encryptedDek: wrapped.encryptedDek,
          salt: wrapped.salt,
          encryptionVersion: 1,
          recoveryKeyHash: await sha256Hex(next),
        }),
      })
      if (!up.ok) throw new Error('更新失败')
      setResult(next)
    } catch {
      // session 过期（fetchWrappers 401）→ 回登录页重新解锁；其余错误保持"验证失败"提示
      try {
        const s = await fetchSession()
        if (!s.authenticated) { router.replace('/login'); return }
      } catch { /* 网络错误保持原提示 */ }
      setError('验证失败（当前恢复密钥不正确？）')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageTransition>
    <main className="flex flex-1 min-h-0 flex-col bg-neutral-100/50 px-6 safe-pt safe-pb dark:bg-neutral-900/50">
      {/* viewTransitionName：页面切换动画中页头保持固定（空间锚点） */}
      <header className="relative flex items-center justify-between py-3" style={{ viewTransitionName: 'site-header' }}>
        {/* iOS 原生风格返回：chevron 箭头（原生路由返回，右滑手势同样生效）；标题绝对居中 */}
        <Link href="/settings" aria-label="返回" transitionTypes={['nav-back']} className="-ml-1 px-1 text-2xl leading-none text-neutral-400">
          ‹
        </Link>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">重新生成恢复密钥</h1>
        <span className="w-8" />
      </header>
      {!result ? (
        /* 验证阶段：m-auto 垂直居中；描述文字在按钮下方 */
        <div className="m-auto flex w-full max-w-xs flex-col gap-3">
          <input
            value={currentKey}
            onChange={(e) => setCurrentKey(e.target.value)}
            placeholder="当前恢复密钥"
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-base outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <button
            onClick={() => void verifyAndProceed()}
            disabled={busy || !currentKey.trim()}
            className="w-full rounded-2xl bg-neutral-900 py-4 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {busy ? '验证中…' : '验证'}
          </button>
          <p className="text-center text-xs text-neutral-400">先输入当前恢复密钥验证身份，验证通过后生成新密钥</p>
          {error && <p className="text-center text-sm text-red-500">{error}</p>}
        </div>
      ) : (
        /* 结果阶段：新密钥仅显示一次，居中展示 */
        <div className="m-auto flex w-full max-w-xs flex-col gap-4">
          <p className="text-sm text-neutral-500">新的恢复密钥已生成，仅显示一次：</p>
          <code className="break-all rounded-xl bg-neutral-100 px-4 py-3 text-sm dark:bg-neutral-800">{result}</code>
          <button
            onClick={() => void handleCopyResult()}
            className="w-full rounded-2xl bg-neutral-900 py-4 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            {copyState === 'copied' ? '已复制 ✓' : copyState === 'failed' ? '复制失败，请手动选择复制' : '复制恢复密钥'}
          </button>
          <p className="text-center text-xs text-amber-600 dark:text-amber-400">保存后旧密钥立即失效——请先妥善保存再离开页面</p>
          <button onClick={() => router.replace('/settings')} className="w-full rounded-2xl border border-neutral-200 py-3.5 text-sm font-medium text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
            完成
          </button>
        </div>
      )}
    </main>
    </PageTransition>
  )
}
