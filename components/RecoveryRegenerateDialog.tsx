'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { fetchSession, fetchWrappers } from '@/lib/client/session'
import { createWrappedDek, unwrapWithRecoveryKey } from '@/lib/client/crypto/setup'
import { decodeRecoveryKey, generateRecoveryKey, sha256Hex } from '@/lib/client/crypto/recovery-key'
import { copyText } from '@/lib/client/clipboard'

// 重新生成恢复密钥弹窗（iOS Alert 风格卡片）：输入当前密钥验证（能解开 wrapper 才算正确）→
// 生成新密钥 → 用新密钥重新包裹 DEK 并更新服务器（wrapper + SHA-256 哈希）。旧密钥立即失效。
export default function RecoveryRegenerateDialog({ onClose }: { onClose: () => void }) {
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
      // 生成新 key，用新 key 包裹 DEK 并更新服务器（IKM 必须是 decodeRecoveryKey 解码后的 32 字节）
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
        if (!s.authenticated) { onClose(); router.replace('/login'); return }
      } catch { /* 网络错误保持原提示 */ }
      setError('验证失败（当前恢复密钥不正确？）')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-8" onClick={onClose}>
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="重新生成恢复密钥"
      >
        <div className="max-h-[70dvh] overflow-y-auto px-5 py-6">
          {!result ? (
            /* 验证阶段 */
            <>
              <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">重新生成恢复密钥</p>
              <p className="mt-1 text-xs text-neutral-400">先输入当前恢复密钥验证身份，验证通过后生成新密钥</p>
              <input
                value={currentKey}
                onChange={(e) => setCurrentKey(e.target.value)}
                placeholder="当前恢复密钥"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                autoFocus
                className="mt-4 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-base outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
              <button
                onClick={() => void verifyAndProceed()}
                disabled={busy || !currentKey.trim()}
                className="mt-3 w-full rounded-xl bg-neutral-900 py-3 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {busy ? '验证中…' : '验证'}
              </button>
              {error && <p className="mt-3 text-center text-sm text-red-500">{error}</p>}
            </>
          ) : (
            /* 结果阶段：新密钥仅显示一次 */
            <>
              <p className="text-sm text-neutral-500">新的恢复密钥已生成，仅显示一次：</p>
              <code className="mt-2 block break-all rounded-xl bg-neutral-100 px-3 py-2.5 text-sm dark:bg-neutral-900">{result}</code>
              <button
                onClick={() => void handleCopyResult()}
                className="mt-2 text-sm text-neutral-500 underline"
              >
                {copyState === 'copied' ? '已复制 ✓' : copyState === 'failed' ? '复制失败，请手动选择复制' : '复制恢复密钥'}
              </button>
              <p className="mt-3 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
                保存后旧密钥立即失效——请先妥善保存再关闭弹窗
              </p>
            </>
          )}
        </div>
        <div className="border-t border-neutral-200 p-3 dark:border-neutral-700">
          <button
            onClick={() => {
              if (result) void copyText(result) // 尽力复制，失败不阻塞关闭
              onClose()
            }}
            className="w-full rounded-xl py-2.5 text-base font-medium text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-700"
          >
            {result ? '完成' : '取消'}
          </button>
        </div>
      </div>
    </div>
  )
}
