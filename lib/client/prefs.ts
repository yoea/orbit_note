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
// 已删除的键（2026-10-01 用户拍板，勿加回来）：
//   qo-theme（主题外观三档）——应用恒跟随系统 prefers-color-scheme，不再提供切换；
//   qo-prompt-timing（每日提示出现时机）——「显示每日提示」回归纯开关。

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
