'use client'

import { useLayoutEffect, useState } from 'react'
import {
  GEOCODE_KEY, HEATMAP_KEY, LOCATION_KEY, OFFLINE_KEY, OTD_KEY, PROMPT_KEY,
  PROMPT_TIMINGS, SAVE_SOUND_KEY, SHOW_VIEWS_KEY, STREAK_KEY,
  THEME_KEY, THEME_VALUES, WEATHER_KEY,
  getPromptTiming, getTheme, setPromptTiming, setTheme, syncPrefToServer,
  type PromptTiming, type ThemeValue,
} from '@/lib/client/prefs'
import { clearOfflineData, getQueuedCount } from '@/lib/client/offline'
import { DIALOG_FOOTER_BUTTON_CLASS } from '@/lib/client/ui'

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

// 主题档位标签（顺序即界面顺序：跟随系统 / 浅色 / 深色）
const THEME_LABEL: Record<ThemeValue, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
}

// 每日提示时机标签（顺序即界面顺序）
const PROMPT_TIMING_LABEL: Record<PromptTiming, string> = {
  always: '总是',
  empty: '仅空白时',
}

// 分段单选控件（radio 组）：主题外观、提示时机都用它。
// 与布尔开关不同，这是「在几个互斥档位里选一个」，用 role=radiogroup + role=radio。
// 未加载时整块渲染中性占位（同 PrefSwitch 的理由：避免首帧显示错档）。
function SegmentedPicker<T extends string>({
  label, options, labels, value, ready, onPick,
}: {
  label: string
  options: readonly T[]
  labels: Record<T, string>
  value: T
  ready: boolean
  onPick: (v: T) => void
}) {
  if (!ready) {
    return <span className="h-7 shrink-0 rounded-lg bg-neutral-200 opacity-60 dark:bg-neutral-700" style={{ width: 168 }} aria-hidden />
  }
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 gap-0.5 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-700">
      {options.map((v) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          onClick={() => onPick(v)}
          className={`rounded-md px-2 py-1 text-xs transition-colors ${value === v ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}
        >
          {labels[v]}
        </button>
      ))}
    </div>
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
// 节流：外观（主题）放第一行，其后是「记录」（位置/天气/地点名）、「显示」（连续天数/
// 每日提示/去年今日/打开次数/热力图）、「行为」（音效/离线缓存）。改动这一顺序时
// tests/settings-structure.test.ts 的相关断言需同步。
export default function PrefsDialog({ onClose }: { onClose: () => void }) {
  const [locationEnabled, setLocationEnabled] = useState(true)
  const [showStreak, setShowStreak] = useState(true)
  const [showPrompt, setShowPrompt] = useState(true)
  const [saveWeather, setSaveWeather] = useState(true)
  const [showOtd, setShowOtd] = useState(true)
  const [autoPlaceName, setAutoPlaceName] = useState(true)
  const [offlineCache, setOfflineCache] = useState(true)
  const [saveSound, setSaveSound] = useState(true)
  const [showViews, setShowViews] = useState(true)
  const [heatmap, setHeatmap] = useState(true)
  const [theme, setThemeState] = useState<ThemeValue>('system')
  const [promptTiming, setPromptTimingState] = useState<PromptTiming>('always')
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
      setSaveSound(localStorage.getItem(SAVE_SOUND_KEY) !== '0')
      setShowViews(localStorage.getItem(SHOW_VIEWS_KEY) !== '0')
      setHeatmap(localStorage.getItem(HEATMAP_KEY) !== '0')
      setThemeState(getTheme())
      setPromptTimingState(getPromptTiming())
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

  // 主题档位：纯本地（设备属性，不同步服务器——见 prefs.ts 注释），
  // 写 localStorage 后立即 applyTheme（class 落到 <html>），无需刷新。
  function pickTheme(v: ThemeValue) {
    setThemeState(v)
    setTheme(v)
  }

  // 每日提示时机：纯本地（与主题同理，字符串值不进布尔偏好通道）
  function pickPromptTiming(v: PromptTiming) {
    setPromptTimingState(v)
    setPromptTiming(v)
  }

  // 开关行清单：文案、落盘键与状态并排一处，省掉多段几乎相同的 JSX。
  // 新增开关只需在此加一行（键与文案不会在复制粘贴中走样）。
  const rows = [
    { key: OFFLINE_KEY, label: '离线缓存', hint: queuedCount > 0 ? `有 ${queuedCount} 篇待同步日记，关闭开关将丢弃` : '断网时仍可解锁并新建和查看日记', enabled: offlineCache, setEnabled: setOfflineCache },
    { key: LOCATION_KEY, label: '保存时记录位置', hint: '关闭后保存日记不再请求定位', enabled: locationEnabled, setEnabled: setLocationEnabled },
    { key: WEATHER_KEY, label: '保存时记录天气', hint: '关闭后保存日记不再获取实时天气', enabled: saveWeather, setEnabled: setSaveWeather },
    { key: GEOCODE_KEY, label: '自动补全地点名', hint: '关闭后不会自动把坐标转为地名', enabled: autoPlaceName, setEnabled: setAutoPlaceName },
    { key: STREAK_KEY, label: '显示连续写作天数', hint: '首页日期旁显示连续写了 N 天', enabled: showStreak, setEnabled: setShowStreak },
    { key: PROMPT_KEY, label: '显示每日提示', hint: '首页输入框上方的写作灵感提示', enabled: showPrompt, setEnabled: setShowPrompt },
    { key: OTD_KEY, label: '显示去年的今天', hint: '首页顶部往年今日回忆卡片', enabled: showOtd, setEnabled: setShowOtd },
    { key: SHOW_VIEWS_KEY, label: '显示打开次数', hint: '详情页底部的打开次数（仅隐藏显示，仍会统计）', enabled: showViews, setEnabled: setShowViews },
    { key: HEATMAP_KEY, label: '显示写作热力图', hint: '日记页顶部的年度写作热力图', enabled: heatmap, setEnabled: setHeatmap },
    { key: SAVE_SOUND_KEY, label: '保存音效', hint: '保存成功时播放提示音', enabled: saveSound, setEnabled: setSaveSound },
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
          {/* 外观：主题三档（单选，非开关）——排在第一位，因为它影响整页观感 */}
          <li key={THEME_KEY} className="flex items-center justify-between gap-4 border-b border-neutral-100 py-3.5 last:border-b-0 dark:border-neutral-700">
            <div>
              <p className="text-neutral-800 dark:text-neutral-200">主题外观</p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">深色 / 浅色，或跟随系统设置</p>
            </div>
            <SegmentedPicker
              label="主题外观"
              options={THEME_VALUES}
              labels={THEME_LABEL}
              value={theme}
              ready={prefsReady}
              onPick={pickTheme}
            />
          </li>
          {/* 开关清单：其中「显示每日提示」一行的右侧换成时机单选（开关 + 时机同处一行，
              语义相邻且不额外占一行）。其余行都是布尔开关。 */}
          {rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-4 border-b border-neutral-100 py-3.5 last:border-b-0 dark:border-neutral-700">
              <div>
                <p className="text-neutral-800 dark:text-neutral-200">{row.label}</p>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{row.hint}</p>
              </div>
              {row.key === PROMPT_KEY ? (
                <SegmentedPicker
                  label="每日提示出现时机"
                  options={PROMPT_TIMINGS}
                  labels={PROMPT_TIMING_LABEL}
                  value={promptTiming}
                  ready={prefsReady}
                  onPick={pickPromptTiming}
                />
              ) : (
                <PrefSwitch enabled={row.enabled} ready={prefsReady} onToggle={() => toggle(row.key, row.enabled, row.setEnabled)} />
              )}
            </li>
          ))}
        </ul>
        {/* 底部「完成」：整宽一行，样式取共享常量（与 AboutDialog / PasskeysDialog /
            RecoveryRegenerateDialog 的「完成」同一份）。
            注：本卡片是 flex flex-col，按钮作为 flex item 本来就会被拉满，
            但**不能因此省掉常量里的 w-full**——同族的其余三个弹窗卡片是块级容器，
            在那里没有 w-full 就会收缩（见常量注释）。统一用一份才不会再各自漂移。 */}
        <button onClick={onClose} className={DIALOG_FOOTER_BUTTON_CLASS}>
          完成
        </button>
      </div>
    </div>
  )
}
