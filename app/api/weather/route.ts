import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/ratelimit'
import { fetchWeather } from '@/lib/server/weather'

// 天气代理：服务器生成和风 JWT（私钥不下发前端）后调和风天气，返回天气文本
export async function GET(req: Request) {
  if (!(await requireAuth(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!rateLimit('weather', 30, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 })
  const url = new URL(req.url)
  const lat = Number(url.searchParams.get('lat'))
  const lon = Number(url.searchParams.get('lon'))
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  const weather = await fetchWeather(lat, lon)
  return NextResponse.json({ weather })
}
