// 客户端直调 BigDataCloud reverse-geocode（免费无 key）：
// 直连 CDN 域名 api-bdc.io（bigdatacloud.net 会 307 重定向过来，iOS Safari 对
// 重定向后 CORS 兼容性差——直连绕过重定向，实测 ~1.2s，CORS 开放 *）。
// localityLanguage=zh-Hans 返回简体中文（如"黄浦区"）。
// 网络抖动（手机流量出海链路偶发不稳）→ 超时 + 自动重试 2 次；仍失败返回 null
// （界面退回显示经纬度，点击坐标可再次查询）。
// 隐私注意：坐标会从浏览器直接发送给 BigDataCloud（用户已确认接受）。
export async function clientReverseGeocode(lat: number, lon: number): Promise<string | null> {
  const url = `https://api-bdc.io/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh-Hans`
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json() as {
        city?: string       // 区/市（黄浦区 / 上海市）
        locality?: string   // 街道/区（黄浦区）
        principalSubdivision?: string // 省/直辖市（上海市）
      } | null
      if (!d) return null
      // 拼接「区 市」两级，去重（直辖市 city 与 principalSubdivision 相同）
      const parts = [d.locality ?? d.city, d.city ?? d.principalSubdivision].filter(
        (s, i, arr): s is string => Boolean(s) && arr.indexOf(s) === i,
      )
      return parts.length > 0 ? parts.join(' ') : null
    } catch {
      if (attempt >= 2) return null // 最后一次失败放弃
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1))) // 间隔重试（800ms / 1.6s）
    }
  }
  return null
}
