// 实时天气：走服务器代理 /api/weather（和风 JWT 认证，私钥只存服务器不下发前端）。
// 保存时配合经纬度获取；失败返回 null（静默，不阻塞保存）。
export async function fetchWeather(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`)
    if (!res.ok) return null
    const d = await res.json() as { weather: string | null }
    return d.weather
  } catch {
    return null
  }
}

// 天气现象 → emoji（按文本包含匹配；未匹配返回空串，界面只显示文本）
const WEATHER_EMOJI: Record<string, string> = {
  晴: '☀️',
  多云: '⛅',
  阴: '☁️',
  雷阵雨: '⛈️',
  暴雨: '⛈️',
  大雨: '🌧️',
  中雨: '🌧️',
  小雨: '🌦️',
  阵雨: '🌦️',
  大雪: '❄️',
  中雪: '🌨️',
  小雪: '🌨️',
  雪: '❄️',
  冰雹: '🧊',
  雾: '🌫️',
  霾: '🌫️',
  风: '🌬️',
}

export function weatherEmoji(weather: string): string {
  for (const [key, emoji] of Object.entries(WEATHER_EMOJI)) {
    if (weather.includes(key)) return emoji
  }
  return ''
}
