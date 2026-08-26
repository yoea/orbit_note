'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { fetchWrappers } from '@/lib/client/session'
import { createWrappedDek, unwrapWithRecoveryKey } from '@/lib/client/crypto/setup'
import { generateRecoveryKey, sha256Hex } from '@/lib/client/crypto/recovery-key'

type Mode = 'export' | 'regenerate'

export default function RecoverySettingsPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const sp = use(searchParams)
  const [mode, setMode] = useState<Mode>(() => (sp.mode === 'regenerate' ? 'regenerate' : 'export'))
  const [currentKey, setCurrentKey] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        const next = generateRecoveryKey()
        const wrapped = await createWrappedDek(dek, new TextEncoder().encode(next), 'recovery-kek')
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
          <code className="mt-2 block break-all rounded-xl bg-neutral-100 px-4 py-3 text-sm dark:bg-neutral-800">{result}</code>
          <button onClick={() => void navigator.clipboard?.writeText(result).catch(() => {})} className="mt-2 text-sm text-neutral-500 underline">复制</button>
        </div>
      )}
    </main>
  )
}
