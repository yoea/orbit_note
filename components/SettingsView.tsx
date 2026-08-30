'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ConfirmDialog from '@/components/ConfirmDialog'
import AboutDialog from '@/components/AboutDialog'
import InputConfirmDialog from '@/components/InputConfirmDialog'
import PasskeysDialog, { type PasskeyInfo } from '@/components/PasskeysDialog'
import { clearDek } from '@/lib/client/session'
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
// 删除所有数据：必须手动输入这段文字才能通过（防误触强确认）
const WIPE_CONFIRM_TEXT = '永久删除'

// 设置视图（原生路由页 /settings 渲染；DEK 会话级持久化，导航/重载自动恢复）
export default function SettingsView() {
  const router = useRouter()
  const [locationEnabled, setLocationEnabled] = useState(true)
  const [wiping, setWiping] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [wipeConfirmStep, setWipeConfirmStep] = useState<0 | 1>(0) // 0=无确认, 1=输入文字验证
  const [showAbout, setShowAbout] = useState(false)
  const [showPasskeys, setShowPasskeys] = useState(false)
  // 预取的 Passkey 列表：点击前 fetch 完成，弹窗打开第一帧即完整列表（无加载闪烁）
  const [passkeysData, setPasskeysData] = useState<PasskeyInfo[] | null>(null)

  // 先取数据再打开弹窗；fetch 失败也打开（弹窗内显示错误 + 重试）
  async function openPasskeysDialog() {
    try {
      const res = await fetch('/api/keys/passkeys')
      if (res.ok) {
        const data = await res.json() as { passkeys: PasskeyInfo[] }
        setPasskeysData(data.passkeys)
      } else {
        setPasskeysData(null)
      }
    } catch {
      setPasskeysData(null)
    }
    setShowPasskeys(true)
  }

  useEffect(() => {
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
      // 输入文字验证后：通行密钥生物识别验证（认证成功才执行删除）
      const ok = await confirmWithFaceId()
      if (!ok) {
        window.alert('身份验证未完成，未执行删除')
        return
      }
      const res = await fetch('/api/admin/wipe', { method: 'POST' })
      if (!res.ok) throw new Error()
      // 物理删除完成：清本地缓存与 DEK，跳转重新初始化
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
    <main className="h-full overflow-y-auto px-5 safe-pt safe-pb">
      <header className="relative flex items-center justify-between py-3">
        {/* iOS 原生风格返回：chevron 箭头（原生路由返回，右滑手势同样生效）；标题绝对居中 */}
        <Link href="/" aria-label="返回" className="-ml-1 px-1 text-2xl leading-none text-neutral-400">
          ‹
        </Link>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">设置</h1>
        <span className="w-8" />
      </header>
      {/* iOS 风格分组卡片：安全 → 偏好 → 数据（危险操作置底并红色标出） */}
      <p className="px-1 pb-2 pt-1 text-xs font-medium text-neutral-400">安全</p>
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-neutral-50/60 dark:divide-neutral-800 dark:bg-neutral-900/40">
        <li>
          {/* 点击查看各设备 Passkey，可禁用指定设备（先预取数据再打开，无加载闪烁） */}
          <button onClick={() => void openPasskeysDialog()} className="flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60">
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">Passkey</p>
              <p className="mt-0.5 text-xs text-neutral-400">Face ID / Windows Hello 快速解锁</p>
            </div>
            <span className="text-lg text-neutral-300">›</span>
          </button>
        </li>
        <li>
          <Link href="/settings/passkey" className="flex items-center justify-between px-4 py-3.5 active:opacity-60">
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">注册新的 Passkey</p>
              <p className="mt-0.5 text-xs text-neutral-400">添加新设备，用同样方式解锁同一份日记</p>
            </div>
            <span className="text-lg text-neutral-300">›</span>
          </Link>
        </li>
        <li>
          <Link href="/settings/recovery?mode=regenerate" className="flex items-center justify-between px-4 py-3.5 active:opacity-60">
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">重新生成恢复密钥</p>
              <p className="mt-0.5 text-xs text-neutral-400">更换新的恢复密钥，旧密钥立即失效</p>
            </div>
            <span className="text-lg text-neutral-300">›</span>
          </Link>
        </li>
      </ul>
      <p className="px-1 pb-2 pt-5 text-xs font-medium text-neutral-400">偏好</p>
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-neutral-50/60 dark:divide-neutral-800 dark:bg-neutral-900/40">
        <li className="flex items-center justify-between px-4 py-3.5">
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
      </ul>
      <p className="px-1 pb-2 pt-5 text-xs font-medium text-neutral-400">数据</p>
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-neutral-50/60 dark:divide-neutral-800 dark:bg-neutral-900/40">
        <li>
          <button onClick={() => setConfirmLogout(true)} className="flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60">
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">退出登录</p>
              <p className="mt-0.5 text-xs text-neutral-400">退出后需重新验证通行密钥才能解锁</p>
            </div>
            <span className="text-lg text-neutral-300">›</span>
          </button>
        </li>
      </ul>
      <p className="px-1 pb-2 pt-5 text-xs font-medium text-neutral-400">关于</p>
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-neutral-50/60 dark:divide-neutral-800 dark:bg-neutral-900/40">
        <li>
          <button onClick={() => setShowAbout(true)} className="flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60">
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">关于 Orbit</p>
              <p className="mt-0.5 text-xs text-neutral-400">端到端加密的私人日记，只为一个人服务</p>
            </div>
            <span className="text-lg text-neutral-300">›</span>
          </button>
        </li>
      </ul>
      {/* 危险操作弱化入口：小字置底，防误触（真正的删除还需文字验证 + 通行密钥验证） */}
      <div className="pt-6 text-center">
        <button
          onClick={() => setWipeConfirmStep(1)}
          disabled={wiping}
          className="text-xs text-neutral-400/70 disabled:opacity-50"
        >
          {wiping ? '验证中…' : '删除所有数据'}
        </button>
      </div>
      {confirmLogout && (
        <ConfirmDialog
          title="确定退出登录吗？"
          message="退出后需重新验证通行密钥才能解锁日记。"
          confirmText="退出"
          cancelText="取消"
          onConfirm={() => { setConfirmLogout(false); void logout() }}
          onCancel={() => setConfirmLogout(false)}
        />
      )}
      {wipeConfirmStep === 1 && (
        <InputConfirmDialog
          title="输入验证"
          message={`所有日记、通行密钥与恢复密钥将全部删除，无法恢复，账号也将被删除。请输入「${WIPE_CONFIRM_TEXT}」确认，之后将通过通行密钥验证身份。`}
          expected={WIPE_CONFIRM_TEXT}
          placeholder={WIPE_CONFIRM_TEXT}
          confirmText="删除"
          onConfirm={() => { setWipeConfirmStep(0); void wipe() }}
          onCancel={() => setWipeConfirmStep(0)}
        />
      )}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {showPasskeys && (
        <PasskeysDialog initialData={passkeysData} onClose={() => setShowPasskeys(false)} />
      )}
    </main>
  )
}
