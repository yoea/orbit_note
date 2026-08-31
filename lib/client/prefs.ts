// 首页显示偏好（localStorage，与定位开关同模式；不涉及敏感数据）
export const LOCATION_KEY = 'qo-location-enabled'
export const STREAK_KEY = 'qo-show-streak'
export const PROMPT_KEY = 'qo-show-prompt'
export const WEATHER_KEY = 'qo-save-weather'
export const OTD_KEY = 'qo-show-on-this-day'

export function isLocationEnabled(): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(LOCATION_KEY) !== '0'
}
export function isStreakEnabled(): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(STREAK_KEY) !== '0'
}
export function isPromptEnabled(): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(PROMPT_KEY) !== '0'
}
export function isWeatherEnabled(): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(WEATHER_KEY) !== '0'
}
export function isOnThisDayEnabled(): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(OTD_KEY) !== '0'
}
