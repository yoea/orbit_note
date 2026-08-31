import 'server-only'
import { SignJWT, importPKCS8 } from 'jose'
import { env } from './env'

// 和风天气 JWT 认证（API key 认证即将停用）：
// 私钥只存服务器（QWEATHER_PRIVATE_KEY），生成 EdDSA JWT 后调用——私钥绝不下发前端。
// 未配置密钥时返回 null（天气功能静默停用，不阻塞保存）。
let cachedKeyPromise: Promise<CryptoKey> | null = null

function getSigningKey(): Promise<CryptoKey> | null {
  if (!env.QWEATHER_KID || !env.QWEATHER_SUB || !env.QWEATHER_PRIVATE_KEY || !env.QWEATHER_HOST) return null
  if (!cachedKeyPromise) {
    cachedKeyPromise = importPKCS8(env.QWEATHER_PRIVATE_KEY, 'EdDSA')
  }
  return cachedKeyPromise
}

async function buildJwt(): Promise<string | null> {
  const key = await getSigningKey()
  if (!key) return null
  // 和风 JWT 规范：header.kid = 凭据 ID（Credential ID），payload.sub = 项目 ID（Project ID），
  // 均为控制台-项目管理查看；exp 最长 24h（这里 1h）；勿加 iss/aud/typ 等保留字段
  return new SignJWT({ sub: env.QWEATHER_SUB! })
    .setProtectedHeader({ alg: 'EdDSA', kid: env.QWEATHER_KID! })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key)
}

// 实时天气（和风新版 API）：GET /weather/v1/current/{lat}/{lon}（路径参数，纬/经度最多两位小数）。
// 返回「晴 32°C」；服务器出海链路偶发抖动 → 超时 + 重试 2 次；仍失败返回 null（静默）
export async function fetchWeather(lat: number, lon: number): Promise<string | null> {
  try {
    const jwt = await buildJwt()
    if (!jwt) return null
    const url = `https://${env.QWEATHER_HOST}/weather/v1/current/${lat.toFixed(2)}/${lon.toFixed(2)}`
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${jwt}` },
          signal: AbortSignal.timeout(8000),
        })
        if (!res.ok) return null
        const d = await res.json() as {
          condition?: { text?: string }
          temperature?: { value?: number; unit?: string }
        } | null
        if (!d?.condition?.text) return null
        return `${d.condition.text} ${Math.round(d.temperature?.value ?? 0)}°C`
      } catch {
        if (attempt >= 2) return null
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
    return null
  } catch {
    return null
  }
}
