'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LOGIN_ERRORS, PRF_UNAVAILABLE, fetchSession, getDek, loginWithPasskey, unlockWithRecoveryKey } from '@/lib/client/session'
import OrbitLogo from '@/components/OrbitLogo'

export default function LoginPage() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [mode, setMode] = useState<'passkey' | 'recovery'>('passkey')
  const [recoveryKey, setRecoveryKey] = useState('')
  // 通行密钥登录失败过 → 才显示"使用恢复密钥"入口（平时不打扰）
  const [passkeyFailed, setPasskeyFailed] = useState(false)
  // 首页守卫踢回时携带原因（诊断）
  const reason = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('reason')
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
        // 网络/服务错误：绝不走初始化分支，停留在本页提示
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
      const result = await loginWithPasskey()
      if (result.ok) {
        // 防御：DEK 未真正载入内存时禁止跳转（否则目标页守卫会踢回形成循环）
        if (!getDek()) { setError('解锁未完成，请重试'); return }
        goToFrom()
        return
      }
      if (result.error === PRF_UNAVAILABLE) { setMode('recovery'); return }
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
      <main className="flex min-h-0 flex-1 flex-col px-6 safe-pb">
        <div className="m-auto flex flex-col items-center gap-4">
          <p className="text-sm text-neutral-500">连接失败，请检查网络后重试</p>
          <button onClick={() => window.location.reload()} className="rounded-xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-3 text-sm font-medium text-white">
            重试
          </button>
        </div>
        <VersionFooter />
      </main>
    )
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col px-6 safe-pb">
      {/* m-auto：LOGO + 按钮整体在容器中完全垂直居中（比 justify-center 更稳健） */}
      <div className="m-auto flex w-full max-w-xs flex-col items-center gap-8">
        {/* 品牌 LOGO */}
        <OrbitLogo size="lg" />
      {mode === 'passkey' ? (
        <div className="w-full max-w-xs">
          <button
            onClick={() => void handlePasskey()}
            disabled={busy}
            className="w-full rounded-2xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-4 text-base font-medium text-white active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? '正在验证…' : '使用通行密钥登录'}
          </button>
          <p className="mt-3 text-center text-xs text-neutral-400">通过通行密钥快速安全登录</p>
          <p className="mt-1 text-center text-[10px] text-neutral-400/70">支持指纹、Face ID、Windows Hello 等</p>
          {/* 恢复密钥入口：仅在通行密钥登录失败后出现（小字、居中、无下划线、淡色） */}
          {passkeyFailed && (
            <button onClick={() => setMode('recovery')} className="mt-2 text-center text-xs text-neutral-400/70">
              使用恢复密钥登录
            </button>
          )}
        </div>
      ) : (
        <form onSubmit={(e) => void handleRecoverySubmit(e)} className="flex w-full max-w-xs flex-col gap-3">
          <p className="text-sm text-neutral-500">输入恢复密钥完成解锁</p>
          <input
            value={recoveryKey}
            onChange={(e) => setRecoveryKey(e.target.value)}
            placeholder="粘贴恢复密钥"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="rounded-xl border border-neutral-200 px-4 py-3 text-base outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <button type="submit" disabled={busy || !recoveryKey.trim()} className="rounded-xl bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500 px-6 py-4 font-medium text-white disabled:opacity-50">
            {busy ? '正在解锁…' : '解锁'}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {reason === 'no-dek' && <p className="text-sm text-amber-600 dark:text-amber-400">解锁未完成：密钥未载入内存（诊断 no-dek）</p>}
      {reason === 'no-auth' && <p className="text-sm text-amber-600 dark:text-amber-400">会话未建立（诊断 no-auth）</p>}
      {mode === 'recovery' && (
        <button
          onClick={() => { setMode('passkey'); setPasskeyFailed(false); setError(null) }}
          className="text-sm text-neutral-400 underline"
        >
          返回通行密钥登录
        </button>
      )}
      </div>
      <VersionFooter />
    </main>
  )
}

// 页脚：版本号 + 版权（原全局页脚的登录页形态——全局页脚已由 TabBar 取代，
// 但登录页在组外、不渲染 TabBar，值得公开的版本/版权信息在这里展示；
// 完整的「关于」内容仍在应用内的关于弹窗）
function VersionFooter() {
  return (
    <footer className="pb-1 text-center text-[10px] text-neutral-300 dark:text-neutral-600" aria-hidden>
      Orbit {process.env.NEXT_PUBLIC_VERSION ?? 'dev'} · © 2026 {process.env.NEXT_PUBLIC_COPYRIGHT_NAME ?? 'Orbit'}
    </footer>
  )
}
