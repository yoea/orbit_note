'use client'

import { useLayoutEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import OrbitLogo from '@/components/OrbitLogo'
import ConfirmDialog from '@/components/ConfirmDialog'
import AboutDialog from '@/components/AboutDialog'
import PasskeysDialog, { type PasskeyInfo } from '@/components/PasskeysDialog'
import RecoveryRegenerateDialog from '@/components/RecoveryRegenerateDialog'
import { clearDek } from '@/lib/client/session'
import { GEOCODE_KEY, LOCATION_KEY, OTD_KEY, PROMPT_KEY, STREAK_KEY, WEATHER_KEY, syncPrefToServer } from '@/lib/client/prefs'

// 偏好开关组件：未加载时渲染中性占位（圆点居中，视觉上非开非关——
// 避免「先渲染默认开启、再变关闭」的闪烁）；加载完成后才是真实可切换开关
function PrefSwitch({ enabled, ready, onToggle }: { enabled: boolean; ready: boolean; onToggle: () => void }) {
  if (!ready) {
    return (
      <span className="relative h-7 w-12 shrink-0 rounded-full bg-neutral-300 opacity-60 dark:bg-neutral-600" aria-hidden>
        <span className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" />
      </span>
    )
  }
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={enabled}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${enabled ? 'bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
    >
      <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : ''}`} />
    </button>
  )
}

// 定位开关（与 DiaryEditor 的 isLocationEnabled 共用 localStorage key）

// 设置视图（原生路由页 /settings 渲染；DEK 会话级持久化，导航/重载自动恢复）
export default function SettingsView() {
  const router = useRouter()
  const [locationEnabled, setLocationEnabled] = useState(true)
  const [showStreak, setShowStreak] = useState(true)
  const [showPrompt, setShowPrompt] = useState(true)
  const [saveWeather, setSaveWeather] = useState(true)
  const [showOtd, setShowOtd] = useState(true)
  const [autoPlaceName, setAutoPlaceName] = useState(true)
  // 偏好加载完成前渲染中性占位（避免「默认开启→真实状态」的闪烁）
  const [prefsReady, setPrefsReady] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showPasskeys, setShowPasskeys] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
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

  // useLayoutEffect：浏览器 paint 前同步读取 localStorage——首帧即真实开关状态，
  // 配合 PrefSwitch 的中性占位（同步读取后立即 ready），无「先开后关」闪烁
  useLayoutEffect(() => {
    try {
      setLocationEnabled(localStorage.getItem(LOCATION_KEY) !== '0')
      setShowStreak(localStorage.getItem(STREAK_KEY) !== '0')
      setShowPrompt(localStorage.getItem(PROMPT_KEY) !== '0')
      setSaveWeather(localStorage.getItem(WEATHER_KEY) !== '0')
      setShowOtd(localStorage.getItem(OTD_KEY) !== '0')
      setAutoPlaceName(localStorage.getItem(GEOCODE_KEY) !== '0')
    } catch { /* localStorage 不可用则保持默认 */ }
    setPrefsReady(true)
  }, [])

  function toggleLocation() {
    const next = !locationEnabled
    setLocationEnabled(next)
    try {
      localStorage.setItem(LOCATION_KEY, next ? '1' : '0')
      syncPrefToServer(LOCATION_KEY, next) // 异步同步数据库（多端）
    } catch { /* 忽略存储失败（隐私模式等） */ }
  }

  function toggleStreak() {
    const next = !showStreak
    setShowStreak(next)
    try {
      localStorage.setItem(STREAK_KEY, next ? '1' : '0')
      syncPrefToServer(STREAK_KEY, next) // 异步同步数据库（多端）
    } catch { /* 忽略存储失败（隐私模式等） */ }
  }

  function togglePrompt() {
    const next = !showPrompt
    setShowPrompt(next)
    try {
      localStorage.setItem(PROMPT_KEY, next ? '1' : '0')
      syncPrefToServer(PROMPT_KEY, next) // 异步同步数据库（多端）
    } catch { /* 忽略存储失败（隐私模式等） */ }
  }

  function toggleWeather() {
    const next = !saveWeather
    setSaveWeather(next)
    try {
      localStorage.setItem(WEATHER_KEY, next ? '1' : '0')
      syncPrefToServer(WEATHER_KEY, next) // 异步同步数据库（多端）
    } catch { /* 忽略存储失败（隐私模式等） */ }
  }

  function toggleOtd() {
    const next = !showOtd
    setShowOtd(next)
    try {
      localStorage.setItem(OTD_KEY, next ? '1' : '0')
      syncPrefToServer(OTD_KEY, next) // 异步同步数据库（多端）
    } catch { /* 忽略存储失败（隐私模式等） */ }
  }

  function toggleAutoPlaceName() {
    const next = !autoPlaceName
    setAutoPlaceName(next)
    try {
      localStorage.setItem(GEOCODE_KEY, next ? '1' : '0')
      syncPrefToServer(GEOCODE_KEY, next) // 异步同步数据库（多端）
    } catch { /* 忽略存储失败（隐私模式等） */ }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    clearDek()
    router.replace('/login')
  }

  return (
    <main className="animate-fade-in mx-auto h-full w-full max-w-md overflow-y-auto px-5 safe-pt safe-pb">
      {/* 电脑版与主页同宽（手机视图宽度），不随屏幕拉伸 */}
      {/* viewTransitionName：页面切换动画中页头保持固定（空间锚点） */}
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
          {/* 点击查看各设备 Passkey，可禁用/启用指定设备、添加新设备（先预取数据再打开，无加载闪烁） */}
          <button onClick={() => void openPasskeysDialog()} className="flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60">
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">通行密钥</p>
              <p className="mt-0.5 text-xs text-neutral-400">指纹 / Face ID / Windows Hello 等</p>
            </div>
            <span className="text-lg text-neutral-300">›</span>
          </button>
        </li>
        <li>
          {/* 重新生成恢复密钥：弹窗完成（不再跳转独立页面） */}
          <button onClick={() => setShowRecovery(true)} className="flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60">
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">重新生成恢复密钥</p>
              <p className="mt-0.5 text-xs text-neutral-400">更换新的恢复密钥，旧密钥立即失效</p>
            </div>
            <span className="text-lg text-neutral-300">›</span>
          </button>
        </li>
      </ul>
      <p className="px-1 pb-2 pt-5 text-xs font-medium text-neutral-400">偏好</p>
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-neutral-50/60 dark:divide-neutral-800 dark:bg-neutral-900/40">
        <li className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">保存时记录位置</p>
            <p className="mt-0.5 text-xs text-neutral-400">关闭后保存日记不再请求定位</p>
          </div>
          <PrefSwitch enabled={locationEnabled} ready={prefsReady} onToggle={toggleLocation} />
        </li>
        <li className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">保存时记录天气</p>
            <p className="mt-0.5 text-xs text-neutral-400">关闭后保存日记不再获取实时天气</p>
          </div>
          <PrefSwitch enabled={saveWeather} ready={prefsReady} onToggle={toggleWeather} />
        </li>
        <li className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">自动补全地点名</p>
            <p className="mt-0.5 text-xs text-neutral-400">关闭后只显示坐标</p>
          </div>
          <PrefSwitch enabled={autoPlaceName} ready={prefsReady} onToggle={toggleAutoPlaceName} />
        </li>
        <li className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">显示连续写作天数</p>
            <p className="mt-0.5 text-xs text-neutral-400">首页日期旁显示连续写了 N 天</p>
          </div>
          <PrefSwitch enabled={showStreak} ready={prefsReady} onToggle={toggleStreak} />
        </li>
        <li className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">显示每日提示</p>
            <p className="mt-0.5 text-xs text-neutral-400">首页输入框上方的写作灵感提示</p>
          </div>
          <PrefSwitch enabled={showPrompt} ready={prefsReady} onToggle={togglePrompt} />
        </li>
        <li className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">显示去年的今天</p>
            <p className="mt-0.5 text-xs text-neutral-400">首页顶部往年今日回忆卡片</p>
          </div>
          <PrefSwitch enabled={showOtd} ready={prefsReady} onToggle={toggleOtd} />
        </li>
      </ul>
      <p className="px-1 pb-2 pt-5 text-xs font-medium text-neutral-400">数据</p>
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-neutral-50/60 dark:divide-neutral-800 dark:bg-neutral-900/40">
        <li>
          <Link href="/settings/export" className="flex w-full items-center justify-between px-4 py-3.5 text-left active:opacity-60">
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">导出笔记</p>
              <p className="mt-0.5 text-xs text-neutral-400">解密全部日记为 CSV 文件</p>
            </div>
            <span className="text-lg text-neutral-300">›</span>
          </Link>
        </li>
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
      {/* 底部品牌：Logo + 上下间距——「关于 Orbit」与页脚之间不再紧贴，视觉收尾平衡 */}
      <div className="flex justify-center pb-8 pt-6">
        <OrbitLogo />
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
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {showPasskeys && (
        <PasskeysDialog initialData={passkeysData} onClose={() => setShowPasskeys(false)} />
      )}
      {showRecovery && <RecoveryRegenerateDialog onClose={() => setShowRecovery(false)} />}
    </main>
  )
}
