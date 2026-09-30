import { idbGet, idbSet } from './idb'
import { formatLocationName, type LocationParts } from './location'

// 反查只需要「区/市」级精度，因此发送前把坐标模糊掉：
// 保留 2 位小数 ≈ 0.01° ≈ 1.1km——足够定位到区/街道，但不再暴露精确位置。
export const GEOCODE_PRECISION = 2

// 保留 precision 位小数（四舍五入）。-0 归一为 0，避免 URL 里出现 "-0.00" 这种丑陋值。
export function coarsenCoordinate(value: number, precision: number = GEOCODE_PRECISION): number {
  const factor = 10 ** precision
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

// ── 本地缓存：坐标格子 → 地名 ─────────────────────────────────────────────
//
// 为什么值得做（2026-09-30 用生产库对 119 条有坐标的笔记实测）：
//   同一个人反复在同一片地方写日记，**精确格子命中率 74.8%**（真实 1km 半径 79.8%，
//   119 条只落在 31 个格子里，最集中的两格占 55%）。也就是约四分之三的外部调用可以
//   完全不打出去——省调用、省等待，也少一次失败机会（4 条缺地名的笔记里有 2 条，
//   其格子此前已经查过，缓存能直接把它们补上）。
//
// ★ 缓存键必须与**实际发给 API 的坐标严格同源**（都走 coarsenCoordinate）。
//   同一个格子的答案必然相同，所以「命中」等价于「再问一次 API」，确定性最强。
//   不要另造一套距离判定：距离匹配会在区界附近返回隔壁区的地名，而精确格子相比
//   1km 半径只少 5 个百分点，不值得换这个不确定性。
//   键与请求一旦不同源，症状是「缓存里有却每次都还打 API」，或更糟的「用 A 地的名字标 B 点」。
//
// 缓存内容是「模糊到 ≈1km 的坐标 → 结构化地名（省/市/区）」，属于**本地**数据、不上传；
// 而且它让向第三方（BigDataCloud）暴露的次数下降约 3/4 —— 隐私上是净收益。
// 存 IndexedDB 而非 localStorage，是为了随 idbClearAll()（设置 → 删除所有数据）一起清掉：
// localStorage 的 qo-* 键在清库与登出时都不会被清，而「你去过哪」不该留在设备上。
const CACHE_IDB_KEY = 'geo-cache'
// 上限：格子数天然很少（实测 119 篇只落 31 个格子），这里只是防无限增长。
const CACHE_MAX = 200

// 读-改-写串行化：与 offline.ts 的 withEntriesLock 是同一个教训（并发 RMW 丢失更新）。
// 这里的并发是真实存在的：保存后的后台反查与详情页的手动查询可能同时收尾。
let cacheLock: Promise<unknown> = Promise.resolve()

function withCacheLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = cacheLock.then(fn, fn)
  cacheLock = next.then(() => undefined, () => undefined)
  return next
}

/** 缓存键：直接用那对**已模糊**、也就是真正发给 API 的坐标拼成。导出以便守卫断言「同源」。 */
export function geocodeCacheKey(qLat: number, qLon: number): string {
  return `${qLat},${qLon}`
}

function trimmed(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

async function readCachedParts(key: string): Promise<LocationParts | null> {
  try {
    const map = await idbGet<Record<string, unknown>>(CACHE_IDB_KEY)
    const v = map?.[key]
    // ★ 旧版本缓存的是拼好的「区 市」字符串（没有分级）。这里**视为未命中**，重新反查一次
    //   顺手升级成结构化——不原地解析老值，因为一个字符串里根本分不出哪一级是哪一级，
    //   猜出来的结构只会是错的（与「不做错误猜测」的既定立场一致）。
    if (!v || typeof v !== 'object') return null
    const o = v as Record<string, unknown>
    const parts: LocationParts = {
      province: trimmed(o.province),
      city: trimmed(o.city),
      district: trimmed(o.district),
    }
    return formatLocationName(parts) ? parts : null
  } catch {
    return null // 缓存读失败绝不能影响反查本身
  }
}

async function writeCachedParts(key: string, parts: LocationParts): Promise<void> {
  try {
    await withCacheLock(async () => {
      const map = (await idbGet<Record<string, LocationParts>>(CACHE_IDB_KEY)) ?? {}
      const merged: Record<string, LocationParts> = { ...map, [key]: parts }
      const keys = Object.keys(merged)
      const kept: Record<string, LocationParts> = {}
      for (const k of keys.length > CACHE_MAX ? keys.slice(keys.length - CACHE_MAX) : keys) kept[k] = merged[k]
      await idbSet(CACHE_IDB_KEY, kept)
    })
  } catch {
    /* 缓存写失败静默：下次再查一遍 API 而已，比抛出去打断保存流程好得多 */
  }
}

/** BigDataCloud 反向地理编码返回的三级字段（localityLanguage=zh-Hans 时为简体中文） */
interface BdcPlace {
  /** 街道/区县（黄浦区） */
  locality?: string
  /** 市（上海市） */
  city?: string
  /** 省 / 直辖市 / 自治区（上海市、云南省） */
  principalSubdivision?: string
}

/** 把接口返回映射成结构化三级。三级全空 → null（调用方据此退回坐标显示）。 */
export function partsFromBdc(d: BdcPlace | null | undefined): LocationParts | null {
  if (!d) return null
  const parts: LocationParts = {
    province: trimmed(d.principalSubdivision),
    city: trimmed(d.city),
    district: trimmed(d.locality),
  }
  return formatLocationName(parts) ? parts : null
}

// 客户端直调 BigDataCloud reverse-geocode（免费无 key）：
// 直连 CDN 域名 api-bdc.io（bigdatacloud.net 会 307 重定向过来，iOS Safari 对
// 重定向后 CORS 兼容性差——直连绕过重定向，实测 ~1.2s，CORS 开放 *）。
// localityLanguage=zh-Hans 返回简体中文（如"黄浦区"）。
// 网络抖动（手机流量出海链路偶发不稳）→ 超时 + 自动重试 2 次；仍失败返回 null
// （界面退回显示经纬度，点击坐标可再次查询）。
// 隐私注意：坐标会从浏览器直接发送给 BigDataCloud（用户已确认接受），
// 但发送前会经 coarsenCoordinate 模糊到约 1km 粒度——精确坐标永不外发。
//
// ★ 只缓存**成功**结果：null 不入缓存。否则一次网络抖动会把那个格子永久标记成
//   「这里没有地名」，之后每次都直接命中缓存返回 null，比不缓存还糟。
//
// 返回**结构化三级**（province / city / district，缺级为 null）；三级全空时返回 null。
export async function clientReverseGeocode(lat: number, lon: number): Promise<LocationParts | null> {
  const qLat = coarsenCoordinate(lat)
  const qLon = coarsenCoordinate(lon)
  const key = geocodeCacheKey(qLat, qLon)

  const cached = await readCachedParts(key)
  if (cached) return cached

  const url = `https://api-bdc.io/data/reverse-geocode-client?latitude=${qLat}&longitude=${qLon}&localityLanguage=zh-Hans`
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const parts = partsFromBdc(await res.json() as BdcPlace | null)
      if (!parts) return null
      await writeCachedParts(key, parts)
      return parts
    } catch {
      if (attempt >= 2) return null // 最后一次失败放弃
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1))) // 间隔重试（800ms / 1.6s）
    }
  }
  return null
}
