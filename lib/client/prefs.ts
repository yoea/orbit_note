// 显示偏好：日常读取走 localStorage（同步，无异步时序/闪烁）；
// 登录成功时从数据库拉取写入 localStorage（多端同步）；
// 设置页改动：先写 localStorage（立即生效），再异步同步数据库。

export const LOCATION_KEY = 'qo-location-enabled'
export const WEATHER_KEY = 'qo-save-weather'
export const STREAK_KEY = 'qo-show-streak'
export const PROMPT_KEY = 'qo-show-prompt'
export const OTD_KEY = 'qo-show-on-this-day'

const ALL_KEYS = [LOCATION_KEY, WEATHER_KEY, STREAK_KEY, PROMPT_KEY, OTD_KEY]

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
