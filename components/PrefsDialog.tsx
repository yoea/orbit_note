'use client'

import { useLayoutEffect, useState } from 'react'
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

// 偏好设置弹窗（交互同「关于」弹窗：居中卡片、遮罩点击关闭、底部完成按钮）。
// 这组开关原先是一整页（/settings/prefs），但只占约 40% 页高，跳页反而多一次导航与
// 一次返回；改弹窗后设置页一屏容纳，开关写完直接关闭，不用来回跳。
//
// 高度限制：列表区 max-h-[60dvh] 并内部滚动——开关以后还会增加，
// 限高让「完成」按钮始终留在视口内（否则内容一多，按钮会被挤出屏幕且无法滚动到）。
// 状态与首帧读取机制从原页面原样搬来（防两处不同步，设置页不保留任何偏好 state）。
export default function PrefsDialog({ onClose }: { onClose: () => void }) {
  const [locationEnabled, setLocationEnabled] = useState(true)
  const [showStreak, setShowStreak] = useState(true)
  const [showPrompt, setShowPrompt] = useState(true)
  const [saveWeather, setSaveWeather] = useState(true)
  const [showOtd, setShowOtd] = useState(true)
  const [autoPlaceName, setAutoPlaceName] = useState(true)
  // 偏好加载完成前渲染中性占位（避免「默认开启→真实状态」的闪烁）
  const [prefsReady, setPrefsReady] = useState(false)

  // useLayoutEffect：浏览器 paint 前同步读取 localStorage——首帧即真实开关状态，
  // 配合 PrefSwitch 的中性占位（同步读取后立即 ready），无「先开后关」闪烁。
  //
  // 为什么不用 useSyncExternalStore：它 hydration 后的取值校正走的是被动 effect
  // （paint 之后），会先渲染出默认值再切换 —— 正是这里要避免的闪烁。
  // 这个模式是刻意的，react-hooks/set-state-in-effect 在此为误报，故显式关闭。
  /* eslint-disable react-hooks/set-state-in-effect -- 客户端专属偏好需在 paint 前同步应用，否则开关会闪一下 */
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
  /* eslint-enable react-hooks/set-state-in-effect */

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={onClose}>
      <div
        className="flex w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="偏好设置"
      >
        <h2 className="shrink-0 px-5 pb-3 pt-5 text-center text-base font-semibold">偏好设置</h2>
        {/* 唯一的滚动区：限高后内容再多也只在内部滚动，标题与「完成」始终可见。
            桌面端用项目自带的细滚动条（thin-scrollbar） */}
        <div className="thin-scrollbar max-h-[60dvh] overflow-y-auto px-5 pb-5">
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-neutral-50/60 dark:divide-neutral-800 dark:bg-neutral-900/40">
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
                <p className="mt-0.5 text-xs text-neutral-400">关闭后不会自动把坐标转为地名</p>
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
        </div>
        <div className="shrink-0 border-t border-neutral-200 p-3 dark:border-neutral-700">
          <button
            onClick={onClose}
            className="w-full rounded-xl py-2.5 text-base font-medium text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-700"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
