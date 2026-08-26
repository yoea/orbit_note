'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ConfirmDialog from '@/components/ConfirmDialog'
import { clearDek, fetchSession } from '@/lib/client/session'
import { authenticatePasskey } from '@/lib/client/webauthn'
import { idbClearAll } from '@/lib/client/idb'

// 二次确认：通过 WebAuthn 认证（iOS 原生 Face ID 弹窗）确认用户在场。
// 认证成功（服务端验证 assertion）才视为确认——防止误触/他人操作删除。
async function confirmWithFaceId(): Promise<boolean> {
  try {
    const optsRes = await fetch('/api/auth/login/options')
    if (!optsRes.ok) return false
    const { token, options } = await optsRes.json()
    const { assertion } = await authenticatePasskey(options, null) // 仅认证，不需要 PRF
    const loginRes = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, assertion }),
    })
    return loginRes.ok
  } catch {
    return false // 用户取消/认证失败
  }
}

// 定位开关（与 DiaryEditor 的 isLocationEnabled 共用 localStorage key）
const LOCATION_KEY = 'qo-location-enabled'

// 设置视图（原生路由页 /settings 渲染；DEK 会话级持久化，导航/重载自动恢复）
export default function SettingsView() {
  const router = useRouter()
  const [info, setInfo] = useState<{ credentialCount: number; prfWrappers: number } | null>(null)
  const [locationEnabled, setLocationEnabled] = useState(true)
  const [wiping, setWiping] = useState(false)
  const [wipeConfirmStep, setWipeConfirmStep] = useState<0 | 1 | 2>(0) // 0=无确认, 1=第一次, 2=第二次

  useEffect(() => {
    void fetchSession().then((s) => setInfo({ credentialCount: s.credentialCount, prfWrappers: s.prfWrappers })).catch(() => setInfo(null))
    // 读取定位开关（默认开启）——异步延迟 setState 避免 cascading render
    const t = setTimeout(() => {
      try {
        setLocationEnabled(localStorage.getItem(LOCATION_KEY) !== '0')
      } catch { /* localStorage 不可用则保持默认 */ }
    }, 0)
    return () => clearTimeout(t)
  }, [])

  function toggleLocation() {
    const next = !locationEnabled
    setLocationEnabled(next)
    try {
      localStorage.setItem(LOCATION_KEY, next ? '1' : '0')
    } catch { /* 忽略存储失败（隐私模式等） */ }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    clearDek()
    router.replace('/login')
  }

  async function wipe() {
    setWiping(true)
    try {
      // 二次确认（ConfirmDialog 已通过）：Face ID 生物识别验证（认证成功才执行删除）
      const ok = await confirmWithFaceId()
      if (!ok) {
        window.alert('身份验证未完成，未执行删除')
        return
      }
      const res = await fetch('/api/admin/wipe', { method: 'POST' })
      if (!res.ok) throw new Error()
      await idbClearAll()
      clearDek()
      router.replace('/setup')
    } catch {
      window.alert('删除失败，请重试')
    } finally {
      setWiping(false)
    }
  }

  return (
    <main className="min-h-dvh px-5 safe-pt safe-pb">
      <header className="flex items-center justify-between py-3">
        {/* iOS 原生风格返回：chevron 箭头（原生路由返回，右滑手势同样生效） */}
        <Link href="/" aria-label="返回" className="-ml-1 px-1 text-2xl leading-none text-neutral-400">
          ‹
        </Link>
        <h1 className="text-lg font-semibold">设置</h1>
        <span className="w-8" />
      </header>
      <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
        <li className="flex items-center justify-between py-4">
          <span className="text-neutral-800 dark:text-neutral-200">Passkey</span>
          <span className="text-sm text-neutral-400">已启用（{info ? info.credentialCount : '—'} 个）</span>
        </li>
        <li className="py-4"><Link href="/settings/passkey" className="text-neutral-800 dark:text-neutral-200">注册新的 Passkey</Link></li>
        <li className="flex items-center justify-between py-4">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">保存时记录位置</p>
            <p className="mt-0.5 text-xs text-neutral-400">关闭后保存日记不再请求定位</p>
          </div>
          <button
            onClick={toggleLocation}
            role="switch"
            aria-checked={locationEnabled}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${locationEnabled ? 'bg-neutral-900 dark:bg-neutral-100' : 'bg-neutral-300 dark:bg-neutral-700'}`}
          >
            {/* 圆点：left-0.5(2px) 基础偏移 + 开启时 translate-x-5(20px) → 22+24=46px ≤ 48px 不溢出 */}
            <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${locationEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </li>
        <li className="py-4"><Link href="/settings/recovery?mode=regenerate" className="text-neutral-800 dark:text-neutral-200">重新生成恢复密钥</Link></li>
        <li className="py-4"><button onClick={() => void logout()} className="text-neutral-800 dark:text-neutral-200">退出登录</button></li>
        <li className="py-4"><button onClick={() => setWipeConfirmStep(1)} disabled={wiping} className="text-red-500 disabled:opacity-50">{wiping ? '验证中…' : '删除所有数据'}</button></li>
        <li className="py-4">
          <p className="text-sm font-medium text-neutral-400">关于</p>
          <p className="mt-1 text-xs text-neutral-400">版本：{process.env.NEXT_PUBLIC_VERSION ?? 'dev'}</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-400">
            端到端加密的私人日记，只为一个人服务。<br />数据只属于你，服务器永远看不到你的文字。
          </p>
        </li>
      </ul>
      {wipeConfirmStep === 1 && (
        <ConfirmDialog
          title="确定删除所有数据吗？"
          message="此操作不可恢复！请先确认已保存你的恢复密钥。"
          confirmText="删除"
          cancelText="取消"
          destructive
          onConfirm={() => setWipeConfirmStep(2)}
          onCancel={() => setWipeConfirmStep(0)}
        />
      )}
      {wipeConfirmStep === 2 && (
        <ConfirmDialog
          title="再次确认"
          message="所有日记、密钥包装、Passkey 凭证都将被永久删除。点击删除后将通过 Face ID 验证身份。"
          confirmText="删除"
          cancelText="取消"
          destructive
          onConfirm={() => { setWipeConfirmStep(0); void wipe() }}
          onCancel={() => setWipeConfirmStep(0)}
        />
      )}
    </main>
  )
}
