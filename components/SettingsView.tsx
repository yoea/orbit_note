'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ConfirmDialog from '@/components/ConfirmDialog'
import AboutDialog from '@/components/AboutDialog'
import PasskeysDialog, { type PasskeyInfo } from '@/components/PasskeysDialog'
import RecoveryRegenerateDialog from '@/components/RecoveryRegenerateDialog'
import { clearDek } from '@/lib/client/session'
import { PROMPT_KEY, STREAK_KEY, WEATHER_KEY } from '@/lib/client/prefs'

// 定位开关（与 DiaryEditor 的 isLocationEnabled 共用 localStorage key）
const LOCATION_KEY = 'qo-location-enabled'

// 设置视图（原生路由页 /settings 渲染；DEK 会话级持久化，导航/重载自动恢复）
export default function SettingsView() {
  const router = useRouter()
  const [locationEnabled, setLocationEnabled] = useState(true)
  const [showStreak, setShowStreak] = useState(true)
  const [showPrompt, setShowPrompt] = useState(true)
  const [saveWeather, setSaveWeather] = useState(true)
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

  useEffect(() => {
    // 读取定位开关（默认开启）——异步延迟 setState 避免 cascading render
    const t = setTimeout(() => {
      try {
        setLocationEnabled(localStorage.getItem(LOCATION_KEY) !== '0')
        setShowStreak(localStorage.getItem(STREAK_KEY) !== '0')
        setShowPrompt(localStorage.getItem(PROMPT_KEY) !== '0')
        setSaveWeather(localStorage.getItem(WEATHER_KEY) !== '0')
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

  function toggleStreak() {
    const next = !showStreak
    setShowStreak(next)
    try {
      localStorage.setItem(STREAK_KEY, next ? '1' : '0')
    } catch { /* 忽略存储失败（隐私模式等） */ }
  }

  function togglePrompt() {
    const next = !showPrompt
    setShowPrompt(next)
    try {
      localStorage.setItem(PROMPT_KEY, next ? '1' : '0')
    } catch { /* 忽略存储失败（隐私模式等） */ }
  }

  function toggleWeather() {
    const next = !saveWeather
    setSaveWeather(next)
    try {
      localStorage.setItem(WEATHER_KEY, next ? '1' : '0')
    } catch { /* 忽略存储失败（隐私模式等） */ }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    clearDek()
    router.replace('/login')
  }

  return (
    <main className="mx-auto h-full w-full max-w-md overflow-y-auto px-5 safe-pt safe-pb">
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
              <p className="text-neutral-800 dark:text-neutral-200">Passkey</p>
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
          <button
            onClick={toggleLocation}
            role="switch"
            aria-checked={locationEnabled}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${locationEnabled ? 'bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
          >
            <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${locationEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </li>
        <li className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">保存时记录天气</p>
            <p className="mt-0.5 text-xs text-neutral-400">关闭后保存日记不再获取实时天气</p>
          </div>
          <button
            onClick={toggleWeather}
            role="switch"
            aria-checked={saveWeather}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${saveWeather ? 'bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
          >
            <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${saveWeather ? 'translate-x-5' : ''}`} />
          </button>
        </li>
        <li className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">显示连续写作天数</p>
            <p className="mt-0.5 text-xs text-neutral-400">首页日期旁显示 🔥 连续写了 N 天</p>
          </div>
          <button
            onClick={toggleStreak}
            role="switch"
            aria-checked={showStreak}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${showStreak ? 'bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
          >
            <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${showStreak ? 'translate-x-5' : ''}`} />
          </button>
        </li>
        <li className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">显示每日提示</p>
            <p className="mt-0.5 text-xs text-neutral-400">首页输入框上方的写作灵感提示</p>
          </div>
          <button
            onClick={togglePrompt}
            role="switch"
            aria-checked={showPrompt}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${showPrompt ? 'bg-gradient-to-r from-orange-500 via-rose-400 to-violet-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
          >
            <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${showPrompt ? 'translate-x-5' : ''}`} />
          </button>
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
