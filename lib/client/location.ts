// 定位：失败/拒绝/超时均返回 null，绝不阻塞保存流程（规格第十二节）
export async function getPosition(
  timeoutMs = 3000,
): Promise<{ latitude: number; longitude: number; accuracy: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 60_000,
      })
    })
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }
  } catch {
    return null
  }
}

// 解析用户手动输入的坐标。接受 "25.049642, 102.676280" 这种形式：
// 逗号分隔（半角 , 与中文全角 ，都支持），逗号前后的空格自动忽略。
// 格式非法或超出经纬度范围时返回 null。
export function parseCoords(input: string): { latitude: number; longitude: number } | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(input)
  if (!m) return null
  const latitude = Number(m[1])
  const longitude = Number(m[2])
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90) return null
  if (longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}
