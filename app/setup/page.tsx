'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { registerPasskey, authenticatePasskey } from '@/lib/client/webauthn'
import { generateDek } from '@/lib/client/crypto/encryption'
import { createWrappedDek, derivePrfKek, wrapWithKek } from '@/lib/client/crypto/setup'
import { generateRecoveryKey, decodeRecoveryKey, sha256Hex } from '@/lib/client/crypto/recovery-key'
import { prfEvalB64 } from '@/lib/client/crypto/prf'
import { fetchSession, persistDek, setDek } from '@/lib/client/session'
import { copyText } from '@/lib/client/clipboard'

export default function SetupPage() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<'intro' | 'recovery'>('intro')
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [prfBindError, setPrfBindError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const s = await fetchSession()
        if (s.initialized) router.replace('/login')
      } catch {
        // 网络/服务错误：绝不走初始化分支，停留在本页提示
        setLoadError(true)
      }
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
      const { registration } = await registerPasskey(options, prfEval)

      // 3. 先注册 credential（成功后设置 session）——wrapper 保存需要认证
      const regResp = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, registration }),
      })
      if (!regResp.ok) throw new Error('注册失败')

      // 4. 无条件尝试认证取 PRF 输出（Windows Hello quirk：create 时 prf.enabled 可能为 false，
      //    但 get 时 authenticator 仍可能返回 PRF 值——需要 hmac-secret 能力，Windows 11 25H2+
      //    KB5077181 提供）。拿到结果 → 派生 KEK → 包裹 DEK → 保存 wrapper_p；
      //    拿不到（或用户取消弹窗）→ 降级为仅 Recovery 解锁，不中断初始化，但把原因显示给用户。
      try {
        const loginRes = await fetch('/api/auth/login/options')
        const loginOpts = await loginRes.json()
        const { assertion, prfResult } = await authenticatePasskey(loginOpts.options, prfEvalB64(prfEval))
        const loginResp = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: loginOpts.token, assertion }),
        })
        if (!loginResp.ok) {
          setPrfBindError('通行密钥验证未通过（服务器拒绝）')
        } else if (!prfResult) {
          setPrfBindError('此设备不支持 PRF 密钥派生（硬件/浏览器限制），解锁需使用恢复密钥')
        } else {
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
      } catch (e) {
        // 用户取消认证弹窗（NotAllowedError）最常见；其余错误也降级但告知用户
        setPrfBindError(e instanceof Error && e.name === 'NotAllowedError'
          ? '已跳过通行密钥解锁绑定（可稍后在设置中补录）'
          : `通行密钥绑定失败：${e instanceof Error ? e.message : String(e)}`)
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

      // 6. 把 DEK 交给 session 模块并会话级持久化：用户进入首页及后续导航均无需再次解锁
      setDek(dek)
      await persistDek()
      setRecoveryKey(recoveryKey)
      setStep('recovery')
    } catch (e) {
      setError(e instanceof Error ? e.message : '初始化失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleCopy() {
    const ok = await copyText(recoveryKey)
    setCopyState(ok ? 'copied' : 'failed')
  }

  function finish() {
    if (!recoveryKey) return
    void copyText(recoveryKey) // 尽力复制，失败不阻塞进入日记
    router.replace('/')
  }

  if (loadError) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-4 px-6 safe-pb">
        <p className="text-sm text-neutral-500">连接失败，请检查网络后重试</p>
        <button onClick={() => window.location.reload()} className="rounded-xl bg-neutral-900 px-6 py-3 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
          重试
        </button>
      </main>
    )
  }

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 px-6 safe-pb">
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
          {prfBindError && (
            <p className="text-center text-xs text-amber-600 dark:text-amber-400">{prfBindError}</p>
          )}
          <code className="break-all rounded-xl bg-neutral-100 px-4 py-3 text-sm dark:bg-neutral-800">{recoveryKey}</code>
          <button onClick={() => void handleCopy()} className="text-sm text-neutral-500 underline">
            {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败，请手动选择复制' : '复制恢复密钥'}
          </button>
          <button onClick={finish} className="w-full max-w-xs rounded-2xl bg-neutral-900 px-6 py-4 font-medium text-white">我已保存，进入日记</button>
        </>
      )}
    </main>
  )
}
