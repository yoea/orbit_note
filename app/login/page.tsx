'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { INCOMPLETE_CREDENTIAL, LOGIN_ERRORS, PRF_UNAVAILABLE, fetchSession, getDek, unlockWithRecoveryKey, unlockWithPasskeyAuto } from '@/lib/client/session'
import { isOfflineUnlockAvailable } from '@/lib/client/offline'
import OrbitLogo from '@/components/OrbitLogo'
import VersionFooter from '@/components/VersionFooter'
import { BRAND_GRADIENT_CLASS, PRIMARY_BUTTON_CLASS } from '@/lib/client/ui'

export default function LoginPage() {
  const router = useRouter()
  // 首页守卫踢回时携带原因（诊断）；`incomplete` 是解锁入口带过来的「这把钥匙没完成设置」。
  // ★ 必须放在 useState 之前：要用它给 mode 做**惰性初值**（见下），而不是在 effect 里 setState
  //   （react-hooks/set-state-in-effect 会把 effect 内的直接 setState 判为错误）。
  const reason = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('reason')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  // reason=incomplete 时直接以恢复密钥模式开场 —— 此刻那是用户唯一的出路
  // （登录进去之后可以在「设置 → 通行密钥」里删掉那把坏钥匙）。
  const [mode, setMode] = useState<'passkey' | 'recovery'>(reason === 'incomplete' ? 'recovery' : 'passkey')
  const [recoveryKey, setRecoveryKey] = useState('')
  // 通行密钥登录失败过 → 才显示"使用恢复密钥"入口（平时不打扰）
  const [passkeyFailed, setPasskeyFailed] = useState(false)
  useEffect(() => {
    void (async () => {
      try {
        const s = await fetchSession()
        if (!s.initialized) { router.replace('/setup'); return }
        // 已认证且 DEK 在内存才进首页；否则停留本页重新解锁（DEK 刷新即清空，规格二十六节）。
        // 已认证但 DEK 为空：由目标页守卫原地自动解锁（useRequireUnlock，无跳转不丢内存态），
        // 本页保持手动入口（未认证/PRF 降级恢复密钥时使用）。
        if (s.authenticated && getDek()) { router.replace('/'); return }
      } catch {
        // 网络不可达：离线解锁缓存可用则停留本页（按钮走本地 PRF 解锁），
        // 不可用才提示连接错误（与无离线能力时行为一致）
        if (await isOfflineUnlockAvailable()) return
        setLoadError(true)
      }
    })()
  }, [router])

  // 回到来源页面（守卫跳转时携带 ?from=），默认首页
  function goToFrom() {
    const from = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('from') : null
    router.replace(from && from.startsWith('/') ? from : '/')
  }

  async function handlePasskey() {
    setBusy(true); setError(null)
    try {
      // unlockWithPasskeyAuto：在线优先，网络不可达且离线缓存可用时回退本地 PRF 解锁
      const result = await unlockWithPasskeyAuto()
      if (result.ok) {
        // 防御：DEK 未真正载入内存时禁止跳转（否则目标页守卫会踢回形成循环）
        if (!getDek()) { setError('解锁未完成，请重试'); return }
        goToFrom()
        return
      }
      if (result.error === PRF_UNAVAILABLE) { setMode('recovery'); return }
      // 未完成设置的钥匙（注册最后一步没走完）：必须**说出原因**再送去恢复密钥。
      // ★ 不能与上面的 PRF_UNAVAILABLE 合并：那条是「浏览器不支持 PRF」的正常降级，
      //   静默切换是对的；这条静默切换就是用户报的「验证之后没反应」——Face ID 过了，
      //   界面只是默默换成了恢复密钥输入框。
      if (result.error === INCOMPLETE_CREDENTIAL) {
        setMode('recovery')
        setError(LOGIN_ERRORS[INCOMPLETE_CREDENTIAL])
        return
      }
      // 通行密钥被禁用：直接切到恢复密钥输入（可恢复的明确路径）。
      // 注意：恢复密钥只解锁数据，不会解除禁用——禁用状态要在设置页手动重新启用。
      if (result.error === LOGIN_ERRORS.disabled_credential) {
        setMode('recovery')
        setError('此通行密钥已被禁用。请使用恢复密钥登录，登录后可在设置中重新启用')
        return
      }
      // 通行密钥不存在：停留在登录页（不自动跳转），显示提示 + 「使用恢复密钥登录」入口
      if (result.error === LOGIN_ERRORS.unknown_credential) {
        setError('此通行密钥不存在或已被删除。请使用恢复密钥登录')
        setPasskeyFailed(true)
        return
      }
      setError(result.error ?? '登录失败')
      setPasskeyFailed(true)
    } catch {
      setError('登录失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleRecoverySubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const result = await unlockWithRecoveryKey(recoveryKey.trim())
      if (result.ok) {
        goToFrom()
        return
      }
      setError(result.error ?? '登录失败')
    } catch {
      setError('登录失败')
    } finally {
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-safe">
        <div className="m-auto flex flex-col items-center gap-4">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">连接失败，请检查网络后重试</p>
          <button onClick={() => window.location.reload()} className="rounded-xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-3 text-sm font-medium text-white">
            重试
          </button>
        </div>
        <VersionFooter />
      </main>
    )
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-safe">
      {/* m-auto：LOGO + 按钮整体在容器中完全垂直居中（比 justify-center 更稳健） */}
      <div className="m-auto flex w-full max-w-xs flex-col items-center gap-8">
        {/* 品牌标识：LOGO + 一句话说明。单独成块是为了让 tagline 与 LOGO 用 12px 间距，
            而整块与下方按钮区仍保持父级 gap-8 的 32px 间距；文字水平居中靠
            items-center + text-center 双重保证（宽度随内容收缩也不会偏）。
            ★ 身份标识在**主按钮里**（2026-10-12 用户定稿）：钥匙图标 + 「使用通行密钥登录」；
              解锁页是锁图标 + 「解锁」。身份**融进按钮**、不另占一行 —— 按钮是这屏最大、
              最先被看到的元素，比挂在 tagline 下面更容易扫到，也少一个元素。
              ★ 改文案/图标时两页必须同时看：tests/login-unlock-identity.test.ts 双向钉住
              「图标与词必须不同」，谁把两页抄成一样都会立刻变红。 */}
        <div className="flex flex-col items-center gap-3">
          <OrbitLogo size="lg" />
          <p className="text-center text-xs tracking-wide text-neutral-500 dark:text-neutral-400">
            端到端加密的私人日记。
          </p>
        </div>
      {mode === 'passkey' ? (
        <div className="w-full max-w-xs">
          <button
            onClick={() => void handlePasskey()}
            disabled={busy}
            /* 尺寸/圆角/字号与写页「保存」**同一个来源**（PRIMARY_BUTTON_CLASS，
               2026-10-12 用户要求统一）：这里原先手写了一份「小一档」的串
               （py-3 / text-sm / rounded-xl），那正是 primary-button.test.ts 要防的漂移。
               额外加 flex + justify-center + gap-2：按钮默认的 text-align:center 只能居中
               纯文本，里面放了图标就必须自己排（否则图标贴左、文字居中会散开）。 */
            className={`${PRIMARY_BUTTON_CLASS} ${BRAND_GRADIENT_CLASS} flex items-center justify-center gap-2`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden>
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
            {busy ? '正在验证…' : '使用通行密钥登录'}
          </button>
          {/* 按钮下方原本还有两行小字说明（重复解释通行密钥、并列举行指纹 / 面容 / Hello），
              已删除：按钮文案本身完整，再啰嗦一遍信息增量为零；且那两行是浅灰小字
              （neutral-400 浅色下 2.5:1，第二行叠加 /70 后仅 1.8:1），本就低于 WCAG AA、
              在手机上几乎看不清。通行密钥的能力说明已归位到「关于」弹窗与设置页功能列表。 */}
          {/* 恢复密钥入口：仅在通行密钥登录失败后出现（小字、居中、无下划线、淡色）。
              配色必须 500/400 这一对（浅 4.7:1 / 深 7.6:1，过 AA）——这是「通行密钥失败
              后的唯一出路」，恰恰最需要看得清；曾用 neutral-400/70（浅色 1.8:1），
              被删的那两行说明修完后它成了全站最差的一处对比度，已改。 */}
          {passkeyFailed && (
            <button onClick={() => setMode('recovery')} className="mt-3 text-center text-xs text-neutral-500 dark:text-neutral-400">
              使用恢复密钥登录
            </button>
          )}
        </div>
      ) : (
        <form onSubmit={(e) => void handleRecoverySubmit(e)} className="flex w-full max-w-xs flex-col gap-3">
          {/* 恢复密钥这条路也统一用「登录」：本页从头到尾只有一个身份词（登录），
              「解锁」那套词留给 components/UnlockPrompt.tsx —— 这是两页的区分手段之一。 */}
          <p className="text-sm text-neutral-500 dark:text-neutral-400">输入恢复密钥完成登录</p>
          <input
            value={recoveryKey}
            onChange={(e) => setRecoveryKey(e.target.value)}
            placeholder="粘贴恢复密钥"
              aria-label="恢复密钥"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="rounded-xl border border-neutral-200 px-4 py-3 text-base outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          {/* 与上面那颗主按钮**同一个样式源**（PRIMARY_BUTTON_CLASS）——
              同一页上的两个「登录」按钮不能一个高一个矮（这正是 primary-button.test.ts
              当初存在的理由）。它没有图标，所以不需要 flex/justify-center。 */}
          <button type="submit" disabled={busy || !recoveryKey.trim()} className={`${PRIMARY_BUTTON_CLASS} ${BRAND_GRADIENT_CLASS}`}>
            {busy ? '正在登录…' : '登录'}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {reason === 'no-dek' && <p className="text-sm text-amber-600 dark:text-amber-400">解锁未完成：密钥未载入内存（诊断 no-dek）</p>}
      {reason === 'no-auth' && <p className="text-sm text-amber-600 dark:text-amber-400">会话未建立（诊断 no-auth）</p>}
      {/* 从解锁入口跳来：那把钥匙没完成设置（详见 lib/client/session.ts 的 INCOMPLETE_CREDENTIAL） */}
      {reason === 'incomplete' && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          这把通行密钥没有完成设置，无法解锁日记。请用恢复密钥登录，登录后在「设置 → 通行密钥」中删除它
        </p>
      )}
      {mode === 'recovery' && (
        <button
          onClick={() => { setMode('passkey'); setPasskeyFailed(false); setError(null) }}
          className="text-sm text-neutral-500 dark:text-neutral-400 underline"
        >
          返回通行密钥登录
        </button>
      )}
      </div>
      <VersionFooter />
    </main>
  )
}

// 版本页脚已抽为共享组件 components/VersionFooter.tsx（登录页与 UnlockPrompt 同一份）——
// 两处曾各自维护，UnlockPrompt 漏了版本行导致用户长期看不到版本号（真实事故）。
// 排版细节（配色/底部留白）的坑见共享组件注释。
