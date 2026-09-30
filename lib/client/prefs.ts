// 显示偏好：日常读取走 localStorage（同步，无异步时序/闪烁）；
// 登录成功时从数据库拉取写入 localStorage（多端同步）；
// 设置页改动：先写 localStorage（立即生效），再异步同步数据库。

export const LOCATION_KEY = 'qo-location-enabled'
export const WEATHER_KEY = 'qo-save-weather'
export const STREAK_KEY = 'qo-show-streak'
export const PROMPT_KEY = 'qo-show-prompt'
export const OTD_KEY = 'qo-show-on-this-day'
// 自动补全地点名：控制所有「把坐标发给第三方换取地名」的自动行为
// （保存时反查 + 打开详情页自动反查）。关闭后不再自动外发坐标，
// 但点击坐标仍可手动查询一次。
export const GEOCODE_KEY = 'qo-auto-place-name'
export const SAVE_SOUND_KEY = 'qo-save-sound'
export const SHOW_VIEWS_KEY = 'qo-show-views'
export const HEATMAP_KEY = 'qo-show-heatmap'
// 离线缓存：断网时仍可用（本地 PRF 解锁 + 密文缓存读写）。
// 刻意不加入 ALL_KEYS（不与服务器同步）：缓存是设备本地属性——
// 手机可能开着、电脑可能关着，跨端同步开关反而会互相覆盖出错误状态。
export const OFFLINE_KEY = 'qo-offline-cache'
// 主题外观：'system' | 'light' | 'dark'。
// 刻意不加入 ALL_KEYS（不与服务器同步）：外观是设备属性（手机常跟随系统、
// 桌面可能固定浅色），跨端同步会互相覆盖。也刻意不进 /api/prefs 的白名单——
// 该通道目前只接受 '0'/'1' 布尔值。
export const THEME_KEY = 'qo-theme'
export const THEME_VALUES = ['system', 'light', 'dark'] as const
export type ThemeValue = (typeof THEME_VALUES)[number]
// 每日提示出现时机：'always'（总是，默认）| 'empty'（仅在正文为空时）。
// 布尔语义（'0'/'1'）表达不了三态以上，这里是两档但语义不是「开关」而是「时机」，
// 因此同样走字符串值 + 不进服务器同步（避免再扩 /api/prefs 的布尔校验通道）。
export const PROMPT_TIMING_KEY = 'qo-prompt-timing'
export const PROMPT_TIMINGS = ['always', 'empty'] as const
export type PromptTiming = (typeof PROMPT_TIMINGS)[number]

const ALL_KEYS = [LOCATION_KEY, WEATHER_KEY, STREAK_KEY, PROMPT_KEY, OTD_KEY, GEOCODE_KEY, SAVE_SOUND_KEY, SHOW_VIEWS_KEY, HEATMAP_KEY]

function get(key: string): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(key) !== '0'
}

// 登录/解锁成功后调用：从数据库拉取全部偏好写入 localStorage（多端同步的入口点）
export async function syncPrefsFromServer(): Promise<void> {
  try {
    const res = await fetch('/api/prefs')
    if (!res.ok) return
    const { prefs } = await res.json() as { prefs?: Record<string, string> }
    if (!prefs) return
    for (const key of ALL_KEYS) {
      const v = prefs[key]
      if (v === '0' || v === '1') {
        try { localStorage.setItem(key, v) } catch { /* 忽略 */ }
      }
    }
  } catch { /* 网络失败静默（保持本地值） */ }
}

// 设置页改动后：先写 localStorage（调用方已写），再异步同步数据库（尽力而为）
export function syncPrefToServer(key: string, value: boolean): void {
  void fetch('/api/prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value: value ? '1' : '0' }),
  }).catch(() => {})
}

export function isLocationEnabled(): boolean {
  return get(LOCATION_KEY)
}
export function isWeatherEnabled(): boolean {
  return get(WEATHER_KEY)
}
export function isStreakEnabled(): boolean {
  return get(STREAK_KEY)
}
export function isPromptEnabled(): boolean {
  return get(PROMPT_KEY)
}
export function isOnThisDayEnabled(): boolean {
  return get(OTD_KEY)
}
export function isAutoPlaceNameEnabled(): boolean {
  return get(GEOCODE_KEY)
}
// 保存成功音效（默认开：保持既有行为，不想要声音的用户可关掉）
export function isSaveSoundEnabled(): boolean {
  return get(SAVE_SOUND_KEY)
}
// 详情页显示打开次数（默认开：只控制「显示」，计数本身照常由服务器自增）
export function isShowViewsEnabled(): boolean {
  return get(SHOW_VIEWS_KEY)
}
// 日记页显示贡献热力图（默认开）
export function isHeatmapEnabled(): boolean {
  return get(HEATMAP_KEY)
}
// 离线缓存开关（设备本地，默认开启——与其它偏好相反：这是能力开关而非隐私外发开关，
// 默认给能力；不想要的用户可在偏好里关掉并一键清除本地数据）
export function isOfflineCacheEnabled(): boolean {
  return get(OFFLINE_KEY)
}

// 主题外观：读当前档位（异常/未设置一律回退 'system'）。
// 与布尔偏好不同，这里不能用 get()——它把非 '0' 一律当真。
export function getTheme(): ThemeValue {
  if (typeof window === 'undefined') return 'system'
  try {
    const v = localStorage.getItem(THEME_KEY)
    return (THEME_VALUES as readonly string[]).includes(v ?? '') ? (v as ThemeValue) : 'system'
  } catch { return 'system' }
}

// 写主题档位（纯本地，不同步服务器）+ 立即应用到 <html> 的 class
export function setTheme(value: ThemeValue): void {
  try { localStorage.setItem(THEME_KEY, value) } catch { /* 忽略 */ }
  applyTheme(value)
}

// 把主题档位落到 <html>：只有 'dark' 加 .dark 类，其余（system/light）都不加。
// 'light' 与 'system' 的区别由 CSS 侧的 @custom-variant 处理：
// system 档跟随 prefers-color-scheme，light 档强制浅色（用 .theme-light 标记）。
export function applyTheme(value: ThemeValue): void {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.classList.toggle('dark', value === 'dark')
  el.classList.toggle('theme-light', value === 'light')
}

// 每日提示出现时机：读当前档位（异常/未设置一律回退 'always' = 保持既有行为）
export function getPromptTiming(): PromptTiming {
  if (typeof window === 'undefined') return 'always'
  try {
    const v = localStorage.getItem(PROMPT_TIMING_KEY)
    return (PROMPT_TIMINGS as readonly string[]).includes(v ?? '') ? (v as PromptTiming) : 'always'
  } catch { return 'always' }
}

export function setPromptTiming(value: PromptTiming): void {
  try { localStorage.setItem(PROMPT_TIMING_KEY, value) } catch { /* 忽略 */ }
}
