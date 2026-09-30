// 日记的交换格式层：**Day One 兼容 JSON**（Day One 与 Journey 都能直接导入）。
//
// 为什么选 Day One 的 JSON 作为"行业标准"：不存在中立的日记交换标准，事实上被互认的就是它——
// Journey 官方支持导入 Day One JSON(zip)，Day One 也支持自家 JSON zip，Diarium / Obsidian 的
// 转换脚本同样以它为输入。所以这里不发明格式，而是**输出 Day One 结构**，自己的字段塞进
// `orbit` 命名空间下一次带出，保证「自家导出 → 再导入」往返无损。
//
// 注意（不要被需求误导）：**Apple Journal 不支持导入任何文件**，只能导出 ZIP/PDF，且没有第三方
// 能解析它的导出。所以"兼容 Apple Journal 导入"在物理上做不到；真正的互通目标是 Journey 与 Day One。
//
// 唯一有损的字段是天气：我们存一段文本（"晴 25°C"），而 Day One 是结构化对象
// （conditionsDescription + temperatureCelsius）。导出时整段文本放进 conditionsDescription，
// 同时把原文存进 orbit.weatherText，导入时优先取后者 ⇒ 自家往返仍无损。
import { countWords } from './markdown'
import { hex32ToUuid, isUuid, uuidToHex32, uuidV5 } from './uuid-v5'
import type { DecryptedEntry } from './entries'

/** Day One / Journey 的导入器认这个文件名（放在 zip 根目录） */
export const JOURNAL_JSON_NAME = 'Journal.json'
export const FORMAT_VERSION = 1

/** 与服务端 `ciphertext` 上限一致（lib/server/validation.ts）。导入侧先本地预检，
 *  超限的条目按既定策略「拒绝并报告」，不要等服务器 400 了才整批失败。**改动需两边同步。** */
export const MAX_CIPHERTEXT_CHARS = 300_000
/** 单次导入条数上限（防止病态文件把浏览器内存打满） */
export const MAX_IMPORT_ENTRIES = 20_000

export interface JournalLocation {
  latitude: number
  longitude: number
  placeName?: string
}

export interface JournalEntry {
  uuid: string
  creationDate: string
  modifiedDate: string
  timeZone?: string
  text: string
  starred: boolean
  location?: JournalLocation
  weather?: { conditionsDescription: string }
  /** 私有命名空间：往返无损所需、Day One 结构里放不下的字段 */
  orbit?: {
    id: string
    wordCount: number
    weatherText: string | null
    locationAccuracy: number | null
  }
}

export interface JournalFile {
  metadata: {
    app: 'Orbit'
    formatVersion: number
    exportedAt: string
    count: number
    /** 明确写进文件：坐标没有被模糊处理（这份文件泄露真实位置） */
    coordinatesBlurred: false
    /** 全文为明文——文件本身不设防，请自行保管 */
    encryption: 'none'
  }
  entries: JournalEntry[]
}

function iso(v: string | Date): string {
  return (v instanceof Date ? v : new Date(v)).toISOString()
}

/** 导出：把「已解密的条目」映射成 Day One 结构，保持传入顺序（服务端为 createdAt 倒序）。 */
export function buildJournalFile(items: DecryptedEntry[], now = new Date()): JournalFile {
  const entries: JournalEntry[] = items.map(({ entry: e, plain }) => ({
    uuid: uuidToHex32(e.id),
    creationDate: iso(e.createdAt),
    modifiedDate: iso(e.updatedAt),
    ...(e.timezone ? { timeZone: e.timezone } : {}),
    text: plain,
    starred: false,
    ...(e.latitude != null && e.longitude != null
      ? {
          location: {
            latitude: e.latitude,
            longitude: e.longitude,
            ...(e.locationName ? { placeName: e.locationName } : {}),
          },
        }
      : {}),
    ...(e.weather ? { weather: { conditionsDescription: e.weather } } : {}),
    orbit: {
      id: e.id,
      wordCount: e.wordCount,
      weatherText: e.weather,
      locationAccuracy: e.locationAccuracy,
    },
  }))
  return {
    metadata: {
      app: 'Orbit',
      formatVersion: FORMAT_VERSION,
      exportedAt: iso(now),
      count: entries.length,
      coordinatesBlurred: false,
      encryption: 'none',
    },
    entries,
  }
}

export function serializeJournal(file: JournalFile): string {
  return JSON.stringify(file, null, 2)
}

/** 解析结果：已归一化成本地字段，但**尚未加密**（加密在 import.ts，需要 DEK） */
export interface ParsedImportEntry {
  id: string
  createdAt: string
  updatedAt: string
  text: string
  wordCount: number
  timezone: string | null
  latitude: number | null
  longitude: number | null
  locationAccuracy: number | null
  locationName: string | null
  weather: string | null
}

export interface RejectedEntry {
  /** 便于用户在原文件里定位：优先 uuid、其次日期，都没有就退化成序号 */
  ref: string
  reason: string
}

export interface ParseResult {
  entries: ParsedImportEntry[]
  rejected: RejectedEntry[]
  /** 非致命但用户该知道的事（如"标签已忽略"） */
  warnings: string[]
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** 天气文本：优先自家往返字段，其次 Day One 结构（有温度就拼上） */
function readWeather(raw: Record<string, unknown>, orbit: Record<string, unknown>): string | null {
  const own = str(orbit.weatherText)
  if (own) return own
  const w = raw.weather
  if (!w || typeof w !== 'object') return null
  const o = w as Record<string, unknown>
  const desc = str(o.conditionsDescription)
  const t = num(o.temperatureCelsius)
  if (desc && t != null) return `${desc} ${t}°C`
  return desc
}

/**
 * 解析一个已 `JSON.parse` 的对象。容忍两种外壳：Day One / 本应用的 `{entries:[...]}`，以及裸数组。
 * 逐条校验：不合格的条目**只拒绝它自己**并给出原因，其它条目照常导入（一份大文件里有几条脏数据
 * 不该让整次导入失败）。异步是因为要算 UUIDv5。
 */
export async function parseJournal(data: unknown): Promise<ParseResult> {
  const entriesRaw = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { entries?: unknown }).entries)
      ? (data as { entries: unknown[] }).entries
      : null
  if (!entriesRaw) throw new Error('文件格式无法识别：既不是 {entries:[...]}，也不是条目数组')
  if (entriesRaw.length > MAX_IMPORT_ENTRIES) {
    throw new Error(`条目数 ${entriesRaw.length} 超过单次导入上限 ${MAX_IMPORT_ENTRIES} 篇，请拆分文件后再导入`)
  }

  const entries: ParsedImportEntry[] = []
  const rejected: RejectedEntry[] = []
  let tagCount = 0
  let mediaCount = 0
  let weatherTrimmed = 0
  let legacyWordCount = 0

  for (let i = 0; i < entriesRaw.length; i++) {
    const raw = entriesRaw[i]
    if (!raw || typeof raw !== 'object') {
      rejected.push({ ref: `#${i + 1}`, reason: '不是对象' })
      continue
    }
    const r = raw as Record<string, unknown>
    const orbit = (r.orbit && typeof r.orbit === 'object' ? r.orbit : {}) as Record<string, unknown>
    const ref = str(r.uuid)?.slice(0, 12) ?? str(r.creationDate)?.slice(0, 10) ?? `#${i + 1}`

    // —— 正文（必填）——
    const text = typeof r.text === 'string' ? r.text : (str(r.body) ?? '')
    if (!text.trim()) {
      rejected.push({ ref, reason: '正文为空' })
      continue
    }

    // —— 时间（创建时间必填：它决定日记落在哪一天，猜错代价很大）——
    const createdRaw = str(r.creationDate) ?? str(r.date)
    if (!createdRaw) {
      rejected.push({ ref, reason: '缺少创建时间（creationDate）' })
      continue
    }
    const createdMs = Date.parse(createdRaw)
    if (Number.isNaN(createdMs)) {
      rejected.push({ ref, reason: `创建时间无法解析（${createdRaw.slice(0, 32)}）` })
      continue
    }
    const modifiedRaw = str(r.modifiedDate)
    const modifiedMs = modifiedRaw ? Date.parse(modifiedRaw) : Number.NaN

    // —— 坐标（范围非法就当没有，不因此拒绝整条）——
    const loc = (r.location && typeof r.location === 'object' ? r.location : {}) as Record<string, unknown>
    const lat = num(loc.latitude) ?? num(r.latitude)
    const lng = num(loc.longitude) ?? num(r.longitude)
    const inRange = lat != null && lng != null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180

    // —— 天气（截断到 DB 列宽而不是丢整条）——
    let weather = readWeather(r, orbit)
    if (weather && weather.length > 64) {
      weather = weather.slice(0, 64)
      weatherTrimmed++
    }
    const locationName = (str(loc.placeName) ?? str(r.locationName))?.slice(0, 255) ?? null
    const tz = str(r.timeZone)
    const timezone = tz && tz.length <= 64 ? tz : null

    // —— id 解析：① 自家往返原样保留（真无损且天然幂等）；② 外部文件按源 uuid 确定性派生；
    //    ③ 连 uuid 都没有 → 用「创建时间|正文」派生（同一份文件重复导入仍然幂等）——
    const ownId = isUuid(orbit.id) ? (orbit.id as string) : null
    const sourceUuid = str(r.uuid)
    const derivedName = sourceUuid
      ? (hex32ToUuid(sourceUuid) ?? sourceUuid)
      : `${new Date(createdMs).toISOString()}|${text}`
    const id = ownId ?? (await uuidV5(derivedName))

    // 字数：自家导出的值可直接沿用（保留旧口径的历史快照）；外部文件按本应用口径重算
    const orbitWc = num(orbit.wordCount)
    const wordCount = orbitWc != null && Number.isInteger(orbitWc) && orbitWc >= 0 ? orbitWc : countWords(text)
    if (orbitWc != null) legacyWordCount++

    if (Array.isArray(r.tags) && r.tags.length > 0) tagCount++
    for (const k of ['photos', 'videos', 'audios', 'pdfs']) {
      if (Array.isArray(r[k]) && (r[k] as unknown[]).length > 0) mediaCount++
    }

    entries.push({
      id,
      createdAt: new Date(createdMs).toISOString(),
      updatedAt: new Date(Number.isNaN(modifiedMs) ? createdMs : modifiedMs).toISOString(),
      text,
      wordCount,
      timezone,
      latitude: inRange ? lat : null,
      longitude: inRange ? lng : null,
      locationAccuracy: num(orbit.locationAccuracy),
      locationName,
      weather,
    })
  }

  const warnings: string[] = []
  if (tagCount > 0) warnings.push(`${tagCount} 篇带标签（本应用暂无标签功能，已忽略）`)
  if (mediaCount > 0) warnings.push(`${mediaCount} 篇带照片/附件（本应用暂不支持媒体，已忽略）`)
  if (weatherTrimmed > 0) warnings.push(`${weatherTrimmed} 篇的天气文本超过 64 字，已截断`)
  if (legacyWordCount > 0) warnings.push(`${legacyWordCount} 篇沿用了文件里的字数（本应用旧口径快照）`)

  return { entries, rejected, warnings }
}
