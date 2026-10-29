'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { registerPasskey, authenticatePasskey } from '@/lib/client/webauthn'
import { detectDeviceName } from '@/lib/client/device'
import { getDek } from '@/lib/client/session'
import { useUserName } from '@/lib/client/use-user-name'
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
//
// ★ 不变量：**要么跑完，要么清理**（2026-10-10 补）。
//   本流程是四段：①取 S → ②注册凭据（服务器落库）→ ③用新钥匙认证一次拿 PRF 输出 →
//   ④存 wrapper。②③之间用户放弃（取消系统弹窗）或失败（网络断），库里就会留下
//   一把「认证能过、解不开日记」的坏钥匙。因此 catch 里会用刚拿到的 credentialId
//   调 purge 尽力清掉；清不掉就明确引导去设置页删除（那边会标成「未完成」）。
//   列表接口（/api/keys/passkeys）返回的 `ready` 就是「④是否完成」。
/**
 * 尽力删掉「注册已登记、但后续步骤没跑完」的凭据（见下方 add 的注释）。
 * 404 也算成功 —— 注册请求本身可能就没落库，我们的目的只是**别留下坏钥匙**，
 * 而不是精确报告服务器状态。失败时返回一句给用户看的话（引导去设置页手动删除）。
 */
async function purgeRegistered(credentialId: string): Promise<string> {
  const fallback = '这把通行密钥未完成设置，请在「设置 → 通行密钥」中删除它'
  try {
    const res = await fetch(`/api/keys/passkeys/${encodeURIComponent(credentialId)}/purge`, { method: 'POST' })
    return res.ok || res.status === 404 ? '已清理这次注册，可直接重试' : fallback
  } catch {
    return fallback
  }
}

export default function AddPasskeyPanel({ onAdded }: {
  onAdded: () => void
}) {
  const router = useRouter()
  const userName = useUserName()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    setBusy(true); setError(null)
    // 服务器已登记的凭据 id：从注册接口成功那一刻起，本函数就负责「要么跑完、要么清理」。
    // 不清理的后果是一把**认证能过、却解不开日记**的坏钥匙 —— 用户拿它登录会觉得
    // 「验证之后没反应」（根因与判定见 lib/client/session.ts 的 INCOMPLETE_CREDENTIAL）。
    let registeredId: string | null = null
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
      //    ?name= 让认证器把账户命名成「X的Orbit」（用户要求）；无用户名时服务器回退 Orbit_User。
      const optsRes = await fetch(
        `/api/auth/register/options${userName ? `?name=${encodeURIComponent(userName)}` : ''}`,
      )
      if (!optsRes.ok) throw new Error('网络错误，请重试')
      const { token, options } = await optsRes.json()
      const { registration, prfEnabled } = await registerPasskey(options, prfEvalBytes)
      if (!prfEnabled) throw new Error('此设备不支持 PRF，无法添加通行密钥解锁')

      const regResp = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, registration, device: detectDeviceName(navigator.userAgent) }),
      })
      if (!regResp.ok) throw new Error('注册失败')
      // 从这一刻起服务器已登记这把凭据：之后任何失败都必须在 catch 里把它清掉
      registeredId = (registration as { id?: string }).id ?? null

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
          credentialId: registeredId ?? '',
          encryptedDek: wrapped.encryptedDek,
          salt: prfEval, // 复用同一个 S！
          encryptionVersion: 1,
        }),
      })
      if (!wrapRes.ok) throw new Error('保存包装失败')

      // 成功后交回上层：它负责刷新列表并切回列表视图（不再跳转路由）
      onAdded()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '添加失败'
      // ★ 收尾清理：注册已登记、但「认证取 PRF / 存 wrapper」没跑完 ⇒ 这把钥匙是坏的。
      //   清掉它，用户就能直接重试；清不掉（离线等）就明确告诉他去设置页删。
      setError(registeredId ? `${msg}（${await purgeRegistered(registeredId)}）` : msg)
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
      {error && <p role="alert" className="text-center text-sm text-red-500">{error}</p>}
    </div>
  )
}
