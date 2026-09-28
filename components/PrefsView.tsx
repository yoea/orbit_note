'use client'

import { useLayoutEffect, useState } from 'react'
import Link from 'next/link'
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

// 偏好设置页（原生路由 /settings/prefs）。
// 这些开关原本挂在设置页里，占据约 40% 页高导致页面需要滚动，故整体独立成页；
// 全部状态与首帧读取机制一并搬过来（设置页不再保留任何偏好 state，避免两处不同步）。
export default function PrefsView() {
  const [locationEnabled, setLocationEnabled] = useState(true)
  const [showStreak, setShowStreak] = useState(true)
  const [showPrompt, setShowPrompt] = useState(true)
  const [saveWeather, setSaveWeather] = useState(true)
  const [showOtd, setShowOtd] = useState(true)
  const [autoPlaceName, setAutoPlaceName] = useState(true)
  // 偏好加载完成前渲染中性占位（避免「默认开启→真实状态」的闪烁）
  const [prefsReady, setPrefsReady] = useState(false)

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

  // 先写 localStorage（立即生效），再异步同步数据库（多端）
  function toggle(key: string, current: boolean, set: (v: boolean) => void) {
    const next = !current
    set(next)
    try {
      localStorage.setItem(key, next ? '1' : '0')
      syncPrefToServer(key, next)
    } catch { /* 忽略存储失败（隐私模式等） */ }
  }

  return (
    <main className="animate-fade-in mx-auto h-full w-full max-w-md overflow-y-auto px-5 safe-pt safe-pb">
      {/* viewTransitionName：页面切换动画中页头保持固定（空间锚点） */}
      <header className="relative flex items-center justify-between py-3">
        <Link href="/settings" aria-label="返回" className="-ml-1 px-1 text-2xl leading-none text-neutral-400">
          ‹
        </Link>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold">偏好设置</h1>
        <span className="w-8" />
      </header>
      <ul className="mt-2 divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-neutral-50/60 dark:divide-neutral-800 dark:bg-neutral-900/40">
        <li className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">保存时记录位置</p>
            <p className="mt-0.5 text-xs text-neutral-400">关闭后保存日记不再请求定位</p>
          </div>
          <PrefSwitch enabled={locationEnabled} ready={prefsReady} onToggle={() => toggle(LOCATION_KEY, locationEnabled, setLocationEnabled)} />
        </li>
        <li className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">保存时记录天气</p>
            <p className="mt-0.5 text-xs text-neutral-400">关闭后保存日记不再获取实时天气</p>
          </div>
          <PrefSwitch enabled={saveWeather} ready={prefsReady} onToggle={() => toggle(WEATHER_KEY, saveWeather, setSaveWeather)} />
        </li>
        <li className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">自动补全地点名</p>
            <p className="mt-0.5 text-xs text-neutral-400">关闭后只显示坐标</p>
          </div>
          <PrefSwitch enabled={autoPlaceName} ready={prefsReady} onToggle={() => toggle(GEOCODE_KEY, autoPlaceName, setAutoPlaceName)} />
        </li>
        <li className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">显示连续写作天数</p>
            <p className="mt-0.5 text-xs text-neutral-400">首页日期旁显示连续写了 N 天</p>
          </div>
          <PrefSwitch enabled={showStreak} ready={prefsReady} onToggle={() => toggle(STREAK_KEY, showStreak, setShowStreak)} />
        </li>
        <li className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">显示每日提示</p>
            <p className="mt-0.5 text-xs text-neutral-400">首页输入框上方的写作灵感提示</p>
          </div>
          <PrefSwitch enabled={showPrompt} ready={prefsReady} onToggle={() => toggle(PROMPT_KEY, showPrompt, setShowPrompt)} />
        </li>
        <li className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className="text-neutral-800 dark:text-neutral-200">显示去年的今天</p>
            <p className="mt-0.5 text-xs text-neutral-400">首页顶部往年今日回忆卡片</p>
          </div>
          <PrefSwitch enabled={showOtd} ready={prefsReady} onToggle={() => toggle(OTD_KEY, showOtd, setShowOtd)} />
        </li>
      </ul>
    </main>
  )
}
