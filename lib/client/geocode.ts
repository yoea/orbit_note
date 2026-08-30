// 客户端直调 BigDataCloud reverse-geocode（免费无 key）：
// 大陆网络实测可达（~5s，CORS 开放 Access-Control-Allow-Origin: *），
// localityLanguage=zh-Hans 返回简体中文（如"黄浦区"）。
// 服务器端调用被放弃：nominatim 大陆不可达，BigDataCloud 服务器端偶发失败且
// 用户网络直连更可靠。失败返回 null（界面退回显示经纬度）。
// 隐私注意：坐标会从浏览器直接发送给 BigDataCloud（用户已确认接受）。
export async function clientReverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh-Hans`
    const res = await fetch(url)
    if (!res.ok) return null
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
    return null
  }
}
