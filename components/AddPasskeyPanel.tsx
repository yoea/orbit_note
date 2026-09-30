'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { registerPasskey, authenticatePasskey } from '@/lib/client/webauthn'
import { detectDeviceName } from '@/lib/client/device'
import { getDek } from '@/lib/client/session'
import { derivePrfKek, wrapWithKek } from '@/lib/client/crypto/setup'
import { fromBase64Url } from '@/lib/client/crypto/base64'
import { BRAND_GRADIENT_CLASS, PRIMARY_BUTTON_CLASS } from '@/lib/client/ui'

// 「在这台设备上注册一把新的通行密钥」——PasskeysDialog 的子视图。
//
// 原先这是一个独立整页（/settings/passkey），由弹窗右上角的 ＋ 跳过去。那是混合导航：
// 用户在弹窗里点一下变成整页，返回时落回设置页而不是那个弹窗，体感是断的。
// 现在改成弹窗内的视图切换，返回即回到列表，不动路由。
//
// PRF 不变量（别改）：所有通行密钥必须共用**同一个** PRF eval 输入 S，即第一个 wrapper 的 salt。
// 新注册时把现有 S 注入 registration，之后用同一个 S 派生 KEK 包裹 DEK——若这里生成新 S，
// 新旧凭据将解不开同一份 DEK。
export default function AddPasskeyPanel({ onAdded }: {
  onAdded: () => void
}) {
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

      // 成功后交回上层：它负责刷新列表并切回列表视图（不再跳转路由）
      onAdded()
    } catch (e) {
      setError(e instanceof Error ? e.message : '添加失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        新增一个通行密钥后，将可以用它解锁同一份日记。请在这台设备上完成系统的
        指纹 / Face ID / Windows Hello 验证。
      </p>
      <button
        onClick={() => void add()}
        disabled={busy}
        className={`${PRIMARY_BUTTON_CLASS} ${BRAND_GRADIENT_CLASS}`}
      >
        {busy ? '添加中…' : '注册新的通行密钥'}
      </button>
      {error && <p className="text-center text-sm text-red-500">{error}</p>}
    </div>
  )
}
