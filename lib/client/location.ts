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

// ── 结构化地名（省 / 市 / 区）───────────────────────────────────────────────
//
// 反查接口（见本目录 geocode.ts）本来就**分级**返回
// （principalSubdivision / city / locality），早先把它拼成一个「区 市」字符串是**有损**的：
// 既分不出「昆明」是市还是区，也没法按「省」或「市」筛选。
//
// ★ 这里定义的展示口径是**唯一**的：列表、详情、搜索、导出全都要走 displayLocationName，
//   否则同一个地点在不同页面显示成不同的名字（「上海市 黄浦区」/「黄浦区 上海市」并存）。
//   判定与拼接都是纯函数，可直接单测（tests/location-structured.test.ts）。
export interface LocationParts {
  province: string | null
  city: string | null
  district: string | null
}

/** 带地名四项的条目（EncryptedEntry / 离线队列项 / 导出用的条目都满足） */
export interface LocationedEntry {
  locationProvince: string | null
  locationCity: string | null
  locationDistrict: string | null
  /** 已废弃：只有本功能上线前的老数据才有值，仅作展示兜底 */
  locationName: string | null
}

function normPlace(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  return s.length > 0 ? s : null
}

/** 条目上的结构化三级（缺级为 null） */
export function locationParts(e: LocationedEntry): LocationParts {
  return { province: e.locationProvince, city: e.locationCity, district: e.locationDistrict }
}

/** 是否已有结构化地名——详情页据此判断「老数据要不要重新反查一次」 */
export function hasStructuredLocation(e: LocationedEntry): boolean {
  return Boolean(normPlace(e.locationProvince) || normPlace(e.locationCity) || normPlace(e.locationDistrict))
}

/**
 * 结构化三级 → 展示串：**大→小**（省 市 区）拼接，空级跳过，重复项去掉。
 * 去重不是可选项：直辖市（上海市 / 北京市 / 重庆市）的「省」与「市」是同一个名字，
 * 不去重会显示成「上海市 上海市 黄浦区」。
 */
export function formatLocationName(parts: LocationParts): string | null {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [parts.province, parts.city, parts.district]) {
    const s = normPlace(raw)
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out.length > 0 ? out.join(' ') : null
}

/**
 * 条目的展示地名：**结构化优先**，老数据（本功能上线前的单一地名串）回退到 location_name。
 * 老条目在详情页被打开时会自动重新反查 → 写入结构化三级 → 之后就走结构化那条路。
 */
export function displayLocationName(e: LocationedEntry): string | null {
  return formatLocationName(locationParts(e)) ?? normPlace(e.locationName)
}

/**
 * 结构化三级 → PATCH body。缺失的级**显式写 null**：否则「之前查到的区名」会在
 * 某次只查到市级结果时残留下来，变成张冠李戴。
 */
export function locationPatch(parts: LocationParts): Record<string, string | null> {
  return {
    locationProvince: parts.province,
    locationCity: parts.city,
    locationDistrict: parts.district,
  }
}
