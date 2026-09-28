'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { registerPasskey, authenticatePasskey } from '@/lib/client/webauthn'
import { detectDeviceName } from '@/lib/client/device'
import { getDek } from '@/lib/client/session'
import { derivePrfKek, wrapWithKek } from '@/lib/client/crypto/setup'
import { fromBase64Url } from '@/lib/client/crypto/base64'
import UnlockPrompt from '@/components/UnlockPrompt'
import { useRequireUnlock } from '@/lib/client/use-require-unlock'

// 页面守卫 + 解锁：与 /settings 一致——直接访问/刷新时从 sessionStorage 恢复 DEK，
// 未解锁则显示手动解锁按钮（此前无守卫，直接访问时 getDek() 为空被跳转到 /login）
export default function AddPasskeyPage() {
  const { state, retryUnlock } = useRequireUnlock()
  if (state === 'need-unlock') return <UnlockPrompt onUnlock={retryUnlock} />
  if (state !== 'ready') return <main className="flex-1 min-h-0 px-5 safe-pt" />
  return (
      <AddPasskeyInner />
  )
}

function AddPasskeyInner() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    setBusy(true); setError(null)
    try {
      const dek = getDek()
      if (!dek) { router.replace('/login'); return }

      // 1. 获取现有 S（PRF eval 输入不变量：所有 passkey 共用第一个 wrapper 的 salt）
      const loginOptsRes = await fetch('/api/auth/login/options')
      if (!loginOptsRes.ok) throw new Error('网络错误，请重试')
      const { prfEval } = await loginOptsRes.json()
      if (!prfEval) throw new Error('未找到现有通行密钥包装，请先在主设备完成初始化')
      const prfEvalBytes = fromBase64Url(prfEval)

      // 2. 注册新 Passkey（注入同一个 S，绝不生成新的）
      const optsRes = await fetch('/api/auth/register/options')
      if (!optsRes.ok) throw new Error('网络错误，请重试')
      const { token, options } = await optsRes.json()
      const { registration, prfEnabled } = await registerPasskey(options, prfEvalBytes)
      if (!prfEnabled) throw new Error('此设备不支持 PRF，无法添加通行密钥解锁')

      const regResp = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, registration, device: detectDeviceName(navigator.userAgent) }),
      })
      if (!regResp.ok) throw new Error('注册失败')

      // 3. 重新获取登录选项（新 token）→ 认证新 Passkey 获取 PRF 输出（eval 输入仍是同一个 S）
      const authOptsRes = await fetch('/api/auth/login/options')
      if (!authOptsRes.ok) throw new Error('网络错误，请重试')
      const authOpts = await authOptsRes.json()
      const { assertion, prfResult } = await authenticatePasskey(authOpts.options, prfEval)
      const loginResp = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: authOpts.token, assertion }),
      })
      if (!loginResp.ok || !prfResult) throw new Error('PRF 验证失败')

      // 4. 用同一 S 派生 KEK → 包裹 DEK → 保存 wrapper（salt = S）
      const kek = await derivePrfKek(prfResult, prfEval)
      const wrapped = await wrapWithKek(dek, kek)
      const wrapRes = await fetch('/api/keys/wrappers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wrapperType: 'passkey_prf',
          credentialId: (registration as { id?: string }).id ?? '',
          encryptedDek: wrapped.encryptedDek,
          salt: prfEval, // 复用同一个 S！
          encryptionVersion: 1,
        }),
      })
      if (!wrapRes.ok) throw new Error('保存包装失败')
      router.replace('/settings')
    } catch (e) {
      setError(e instanceof Error ? e.message : '添加失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex flex-1 min-h-0 flex-col px-6 safe-pt safe-pb">
      {/* viewTransitionName：页面切换动画中页头保持固定（空间锚点） */}
      <header className="relative flex items-center justify-between py-3">
        {/* iOS 原生风格返回：chevron 箭头（原生路由返回，右滑手势同样生效）；标题绝对居中 */}
        <Link href="/settings" aria-label="返回" className="-ml-1 px-1 text-2xl leading-none text-neutral-400">
          ‹
        </Link>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">添加通行密钥</h1>
        <span className="w-8" />
      </header>
      {/* m-auto：按钮整体垂直居中；描述文字在按钮下方 */}
      <div className="m-auto flex w-full max-w-xs flex-col gap-4">
        <button
          onClick={() => void add()}
          disabled={busy}
          className="w-full rounded-2xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-4 text-base font-medium text-white active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? '添加中…' : '注册新的通行密钥'}
        </button>
        <p className="text-center text-xs text-neutral-400">新增一个通行密钥后，将可以用它解锁同一份日记</p>
        {error && <p className="text-center text-sm text-red-500">{error}</p>}
      </div>
    </main>
  )
}
