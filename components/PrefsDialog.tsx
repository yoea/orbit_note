'use client'

import { useLayoutEffect, useState } from 'react'
import { GEOCODE_KEY, LOCATION_KEY, OFFLINE_KEY, OTD_KEY, PROMPT_KEY, STREAK_KEY, WEATHER_KEY, syncPrefToServer } from '@/lib/client/prefs'
import { clearOfflineData, getQueuedCount } from '@/lib/client/offline'

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
// 层级刻意压平：遮罩 → 卡片 →（标题 / 开关列表 / 完成按钮），开关行直接落在卡片上。
// 此前列表外还套了一层「灰底圆角」容器，在白色卡片里形成「卡中卡」，既无信息量又
// 让左右缩进多出 16px；现改为分隔线 + 整行触达区，与 ConfirmDialog 的底部按钮同一风格。
//
// 高度限制：列表自身 max-h-[60dvh] 并内部滚动（不再多一层滚动容器）——开关以后还会增加，
// 限高让「完成」按钮始终留在视口内（否则内容一多，按钮会被挤出屏幕且无法滚动到）。
// 状态与首帧读取机制从原页面原样搬来（防两处不同步，设置页不保留任何偏好 state）。
export default function PrefsDialog({ onClose }: { onClose: () => void }) {
  const [locationEnabled, setLocationEnabled] = useState(true)
  const [showStreak, setShowStreak] = useState(true)
  const [showPrompt, setShowPrompt] = useState(true)
  const [saveWeather, setSaveWeather] = useState(true)
  const [showOtd, setShowOtd] = useState(true)
  const [autoPlaceName, setAutoPlaceName] = useState(true)
  const [offlineCache, setOfflineCache] = useState(true)
  // 打开弹窗时顺带读队列条数：有待同步条目时在「离线缓存」开关的说明里提醒
  // （关闭开关会连同队列一起清除 = 丢弃这些未上传的离线日记）
  const [queuedCount, setQueuedCount] = useState(0)
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
      setOfflineCache(localStorage.getItem(OFFLINE_KEY) !== '0')
    } catch { /* localStorage 不可用则保持默认 */ }
    setPrefsReady(true)
    void getQueuedCount().then(setQueuedCount)
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  // 先写 localStorage（立即生效），再异步同步数据库（多端）。
  // OFFLINE_KEY 是设备本地开关（不同步服务器——缓存本身是设备属性）；关闭即清除本机
  // 离线数据（密文缓存 + 待同步队列）——因此不设单独的「清除离线数据」动作行，
  // 关开关本身就是清除操作。
  function toggle(key: string, current: boolean, set: (v: boolean) => void) {
    const next = !current
    set(next)
    try {
      localStorage.setItem(key, next ? '1' : '0')
      if (key !== OFFLINE_KEY) syncPrefToServer(key, next)
      if (key === OFFLINE_KEY && !next) void clearOfflineData().then(() => setQueuedCount(0))
    } catch { /* 忽略存储失败（隐私模式等） */ }
  }

  // 开关行清单：文案、落盘键与状态并排一处，省掉 6 段几乎相同的 JSX。
  // 新增开关只需在此加一行（键与文案不会在复制粘贴中走样）。
  const rows = [
    { key: OFFLINE_KEY, label: '离线缓存', hint: queuedCount > 0 ? `有 ${queuedCount} 篇待同步日记，关闭开关将丢弃` : '断网时仍可解锁并新建和查看日记', enabled: offlineCache, setEnabled: setOfflineCache },
    { key: LOCATION_KEY, label: '保存时记录位置', hint: '关闭后保存日记不再请求定位', enabled: locationEnabled, setEnabled: setLocationEnabled },
    { key: WEATHER_KEY, label: '保存时记录天气', hint: '关闭后保存日记不再获取实时天气', enabled: saveWeather, setEnabled: setSaveWeather },
    { key: GEOCODE_KEY, label: '自动补全地点名', hint: '关闭后不会自动把坐标转为地名', enabled: autoPlaceName, setEnabled: setAutoPlaceName },
    { key: STREAK_KEY, label: '显示连续写作天数', hint: '首页日期旁显示连续写了 N 天', enabled: showStreak, setEnabled: setShowStreak },
    { key: PROMPT_KEY, label: '显示每日提示', hint: '首页输入框上方的写作灵感提示', enabled: showPrompt, setEnabled: setShowPrompt },
    { key: OTD_KEY, label: '显示去年的今天', hint: '首页顶部往年今日回忆卡片', enabled: showOtd, setEnabled: setShowOtd },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={onClose}>
      <div
        className="flex w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="偏好设置"
      >
        <h2 className="shrink-0 px-5 pb-1 pt-5 text-center text-base font-semibold">偏好设置</h2>
        {/* 唯一的滚动区就是列表自身：限高后内容再多也只在内部滚动，标题与「完成」始终可见。
            桌面端用项目自带的细滚动条（thin-scrollbar） */}
        <ul className="thin-scrollbar max-h-[60dvh] overflow-y-auto px-5 py-2">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-4 border-b border-neutral-100 py-3.5 last:border-b-0 dark:border-neutral-700">
              <div>
                <p className="text-neutral-800 dark:text-neutral-200">{row.label}</p>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{row.hint}</p>
              </div>
              <PrefSwitch enabled={row.enabled} ready={prefsReady} onToggle={() => toggle(row.key, row.enabled, row.setEnabled)} />
            </li>
          ))}
        </ul>
        <button
          onClick={onClose}
          className="shrink-0 border-t border-neutral-200 py-3.5 text-base font-medium text-neutral-500 dark:text-neutral-400 active:bg-neutral-100 dark:border-neutral-700 dark:active:bg-neutral-700"
        >
          完成
        </button>
      </div>
    </div>
  )
}
