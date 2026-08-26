'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fetchSession, fetchWrappers } from '@/lib/client/session'
import { createWrappedDek, unwrapWithRecoveryKey } from '@/lib/client/crypto/setup'
import { decodeRecoveryKey, generateRecoveryKey, sha256Hex } from '@/lib/client/crypto/recovery-key'
import { copyText } from '@/lib/client/clipboard'

type Mode = 'export' | 'regenerate'

export default function RecoverySettingsPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const router = useRouter()
  const sp = use(searchParams)
  const [mode, setMode] = useState<Mode>(() => (sp.mode === 'regenerate' ? 'regenerate' : 'export'))
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
      const dek = await unwrapWithRecoveryKey(rec.encryptedDek, rec.salt, currentKey.trim())
      if (mode === 'export') {
        // 已通过验证（成功解开 wrapper），显示当前密钥
        setResult(currentKey.trim())
      } else {
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
      }
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
    <main className="min-h-dvh px-5 safe-pt safe-pb">
      <header className="flex items-center justify-between py-3">
        <Link href="/settings" className="text-neutral-400">‹ 设置</Link>
        <h1 className="text-lg font-semibold">{mode === 'export' ? '导出恢复密钥' : '重新生成恢复密钥'}</h1>
        <span className="w-8" />
      </header>
      <div className="flex gap-2 py-2">
        <button onClick={() => { setMode('export'); setResult(null); setError(null) }} className={`rounded-full px-4 py-1.5 text-sm ${mode === 'export' ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800'}`}>导出</button>
        <button onClick={() => { setMode('regenerate'); setResult(null); setError(null) }} className={`rounded-full px-4 py-1.5 text-sm ${mode === 'regenerate' ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800'}`}>重新生成</button>
      </div>
      <p className="text-sm text-neutral-500">先输入当前恢复密钥验证身份</p>
      <input
        value={currentKey}
        onChange={(e) => setCurrentKey(e.target.value)}
        placeholder="当前恢复密钥"
        autoCapitalize="none" autoCorrect="off" spellCheck={false}
        className="mt-4 w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-base outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      />
      <button
        onClick={() => void verifyAndProceed()}
        disabled={busy || !currentKey.trim()}
        className="mt-4 w-full rounded-2xl bg-neutral-900 py-4 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {busy ? '验证中…' : '验证'}
      </button>
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      {result && (
        <div className="mt-6">
          <p className="text-sm text-neutral-500">请立即保存，此密钥仅显示一次：</p>
          {mode === 'regenerate' && (
            <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">保存新密钥前不要关闭页面——保存后旧密钥立即失效</p>
          )}
          <code className="mt-2 block break-all rounded-xl bg-neutral-100 px-4 py-3 text-sm dark:bg-neutral-800">{result}</code>
          <button onClick={() => void handleCopyResult()} className="mt-2 text-sm text-neutral-500 underline">
            {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败，请手动选择复制' : '复制'}
          </button>
        </div>
      )}
    </main>
  )
}
