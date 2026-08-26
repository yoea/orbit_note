'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { registerPasskey, authenticatePasskey } from '@/lib/client/webauthn'
import { generateDek } from '@/lib/client/crypto/encryption'
import { createWrappedDek, derivePrfKek, wrapWithKek } from '@/lib/client/crypto/setup'
import { generateRecoveryKey, decodeRecoveryKey, sha256Hex } from '@/lib/client/crypto/recovery-key'
import { prfEvalB64 } from '@/lib/client/crypto/prf'
import { fetchSession } from '@/lib/client/session'

export default function SetupPage() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<'intro' | 'recovery'>('intro')
  const [error, setError] = useState<string | null>(null)
  const [recoveryKey, setRecoveryKey] = useState('')

  useEffect(() => {
    void (async () => {
      const s = await fetchSession()
      if (s.initialized) router.replace('/login')
    })()
  }, [router])

  async function start() {
    setBusy(true); setError(null)
    try {
      // 1. 生成 DEK 与 PRF eval 输入 S
      const dek = await generateDek()
      const prfEval = crypto.getRandomValues(new Uint8Array(32))

      // 2. 获取注册选项并注册 Passkey（PRF 扩展由 registerPasskey 注入，eval.first = S）
      const optsRes = await fetch('/api/auth/register/options')
      if (!optsRes.ok) throw new Error('初始化被拒绝（系统可能已初始化）')
      const { token, options } = await optsRes.json()
      const { registration, prfEnabled } = await registerPasskey(options, prfEval)

      // 3. 先注册 credential（成功后设置 session）——wrapper 保存需要认证
      const regResp = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, registration }),
      })
      if (!regResp.ok) throw new Error('注册失败')

      // 4. 若 PRF 可用：立即认证同一 passkey 获取 PRF 输出 → KEK → 包裹 DEK → 保存 wrapper_p
      if (prfEnabled) {
        const loginRes = await fetch('/api/auth/login/options')
        const loginOpts = await loginRes.json()
        const { assertion, prfResult } = await authenticatePasskey(loginOpts.options, prfEvalB64(prfEval))
        const loginResp = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: loginOpts.token, assertion }),
        })
        if (!loginResp.ok) throw new Error('Passkey 验证失败')
        if (!prfResult) throw new Error('PRF 未返回结果')
        const kek = await derivePrfKek(prfResult, prfEvalB64(prfEval))
        const { encryptedDek } = await wrapWithKek(dek, kek)
        const wrapP = await fetch('/api/keys/wrappers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wrapperType: 'passkey_prf',
            credentialId: registration.id ?? '',
            encryptedDek,
            salt: prfEvalB64(prfEval),
            encryptionVersion: 1,
          }),
        })
        if (!wrapP.ok) throw new Error('保存 Passkey 包装失败')
      }

      // 5. 生成 Recovery Key 与 wrapper_r（含服务器校验哈希），保存
      const recoveryKey = generateRecoveryKey()
      const recoveryWrapper = await createWrappedDek(dek, decodeRecoveryKey(recoveryKey), 'recovery-kek')
      const wrapR = await fetch('/api/keys/wrappers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wrapperType: 'recovery',
          encryptedDek: recoveryWrapper.encryptedDek,
          salt: recoveryWrapper.salt,
          encryptionVersion: 1,
          recoveryKeyHash: await sha256Hex(recoveryKey),
        }),
      })
      if (!wrapR.ok) throw new Error('保存恢复包装失败')

      setRecoveryKey(recoveryKey)
      setStep('recovery')
    } catch (e) {
      setError(e instanceof Error ? e.message : '初始化失败')
    } finally {
      setBusy(false)
    }
  }

  function finish() {
    if (!recoveryKey) return
    void navigator.clipboard?.writeText(recoveryKey).catch(() => {})
    router.replace('/')
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 safe-pb">
      {step === 'intro' && (
        <>
          <h1 className="text-2xl font-semibold">创建你的私人日记</h1>
          <p className="max-w-xs text-center text-sm text-neutral-500">日记内容将端到端加密，只有你的设备能解密。</p>
          <button onClick={() => void start()} disabled={busy} className="w-full max-w-xs rounded-2xl bg-neutral-900 px-6 py-4 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">
            {busy ? '正在创建…' : '使用 Face ID 创建通行密钥'}
          </button>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </>
      )}
      {step === 'recovery' && (
        <>
          <h1 className="text-xl font-semibold">保存你的恢复密钥</h1>
          <p className="text-center text-sm text-neutral-500">它只显示一次，请保存到安全密码管理器。丢失后无法恢复日记。</p>
          <code className="break-all rounded-xl bg-neutral-100 px-4 py-3 text-sm dark:bg-neutral-800">{recoveryKey}</code>
          <button onClick={() => void navigator.clipboard?.writeText(recoveryKey).catch(() => {})} className="text-sm text-neutral-500 underline">复制恢复密钥</button>
          <button onClick={finish} className="w-full max-w-xs rounded-2xl bg-neutral-900 px-6 py-4 font-medium text-white">我已保存，进入日记</button>
        </>
      )}
    </main>
  )
}
