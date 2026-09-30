import { idbGet, idbSet } from './idb'

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
// 缓存内容是「模糊到 ≈1km 的坐标 → 区/市名」，属于**本地**数据、不上传；而且它让向
// 第三方（BigDataCloud）暴露的次数下降约 3/4 —— 隐私上是净收益。
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

async function readCachedName(key: string): Promise<string | null> {
  try {
    const map = await idbGet<Record<string, string>>(CACHE_IDB_KEY)
    return map?.[key] ?? null
  } catch {
    return null // 缓存读失败绝不能影响反查本身
  }
}

async function writeCachedName(key: string, name: string): Promise<void> {
  try {
    await withCacheLock(async () => {
      const map = (await idbGet<Record<string, string>>(CACHE_IDB_KEY)) ?? {}
      const merged: Record<string, string> = { ...map, [key]: name }
      const keys = Object.keys(merged)
      const kept: Record<string, string> = {}
      for (const k of keys.length > CACHE_MAX ? keys.slice(keys.length - CACHE_MAX) : keys) kept[k] = merged[k]
      await idbSet(CACHE_IDB_KEY, kept)
    })
  } catch {
    /* 缓存写失败静默：下次再查一遍 API 而已，比抛出去打断保存流程好得多 */
  }
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
export async function clientReverseGeocode(lat: number, lon: number): Promise<string | null> {
  const qLat = coarsenCoordinate(lat)
  const qLon = coarsenCoordinate(lon)
  const key = geocodeCacheKey(qLat, qLon)

  const cached = await readCachedName(key)
  if (cached) return cached

  const url = `https://api-bdc.io/data/reverse-geocode-client?latitude=${qLat}&longitude=${qLon}&localityLanguage=zh-Hans`
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
      const name = parts.length > 0 ? parts.join(' ') : null
      if (name) await writeCachedName(key, name)
      return name
    } catch {
      if (attempt >= 2) return null // 最后一次失败放弃
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1))) // 间隔重试（800ms / 1.6s）
    }
  }
  return null
}
