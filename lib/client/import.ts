// 导入编排：读文件 → 解析归一化 → 用 DEK 加密 → 分批写服务器 → 汇总报告。
//
// 三个刻意的设计：
//  1. **拒绝并报告**（而不是整批失败）：单条超长/无正文/时间无法解析的，只拒绝它自己，
//     其余照常导入，最后把拒绝清单给用户看——一份几百篇的备份不该被一条脏数据毁掉。
//  2. **按体积自适应分批**：反代默认 body 上限是 1MB。按条数分批在"某几篇特别长"时会撞上 413，
//     所以按累计密文字节数切批（目标 ~512KB、最多 50 条）。单条密文上限 300k 字符
//     ⇒ 每批请求必然远小于 1MB，正常情况不会触发 413。
//  3. **不碰离线队列**：导入是明确的在线操作（要写服务器），不往本地写队列里塞东西。
//  4. **只管数据库字段**：本机数据（打开次数等）不在备份里、也不写回，导入只负责把条目
//     写进服务器（原因见 lib/client/views.ts）。
import { encryptText } from './crypto/encryption'
import { fetchAllEntries } from './entries'
import {
  JOURNAL_JSON_NAME,
  MAX_CIPHERTEXT_CHARS,
  parseJournal,
  type RejectedEntry,
} from './journal-format'
import { listZipEntries, readZipEntry } from './zip'

/** 单批目标体积：留一半余量给反代的 1MB 默认上限（JSON 包装 + 其它字段也要占地方） */
const BATCH_BYTES = 512 * 1024
const BATCH_MAX_ENTRIES = 50
/** 429/5xx 的重试次数与退避基数（导入是长任务，短暂限流不该中断整次导入） */
const MAX_RETRY = 5

/**
 * 按体积切批（纯函数，便于单测——这是最容易写错的一段）。
 * 规则：累计字节 ≤ maxBytes 且条数 < maxCount；**单条超限也自成一批**（否则会死循环）。
 */
export function batchByBytes<T extends { bytes: number }>(
  items: T[],
  maxBytes = BATCH_BYTES,
  maxCount = BATCH_MAX_ENTRIES,
): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  let bytes = 0
  for (const it of items) {
    if (cur.length > 0 && (bytes + it.bytes > maxBytes || cur.length >= maxCount)) {
      out.push(cur)
      cur = []
      bytes = 0
    }
    cur.push(it)
    bytes += it.bytes
  }
  if (cur.length > 0) out.push(cur)
  return out
}

export interface ImportProgress {
  phase: 'reading' | 'parsing' | 'encrypting' | 'uploading' | 'refreshing' | 'done'
  done: number
  total: number
}

export interface ImportReport {
  /** 文件里的条目总数 */
  total: number
  imported: number
  /** 服务器上已存在（同 id）而跳过的——重复导入同一份文件时就是这个数 */
  existing: number
  rejected: RejectedEntry[]
  warnings: string[]
  aborted: boolean
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05)
}

/** 从文件里取出 JSON 文本：支持裸 .json 与 .zip（Day One / 本应用导出的压缩包） */
export async function readJournalText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!isZip(bytes)) {
    return new TextDecoder().decode(bytes).replace(/^\uFEFF/, '')
  }
  // 优先标准名 Journal.json；否则退而取根目录下任意 .json（不同工具的命名不完全一致）
  let inner = await readZipEntry(bytes, JOURNAL_JSON_NAME)
  if (!inner) {
    const candidates = listZipEntries(bytes).filter(
      (e) => !e.name.endsWith('/') && e.name.toLowerCase().endsWith('.json') && e.name.split('/').length <= 2,
    )
    // 根目录优先，其次取体积最大的那个（附件目录里的小 json 多半不是正主）
    candidates.sort((a, b) => a.name.split('/').length - b.name.split('/').length || b.uncompSize - a.uncompSize)
    if (candidates.length > 0) inner = await readZipEntry(bytes, candidates[0].name)
  }
  if (!inner) throw new Error('压缩包里没有找到 JSON 文件（既没有 Journal.json，也没有其它 .json）')
  return new TextDecoder().decode(inner).replace(/^\uFEFF/, '')
}

async function postBatch(
  payload: unknown,
  signal: AbortSignal | undefined,
  attempt = 0,
): Promise<{ inserted: number; existing: number; rejected: RejectedEntry[]; ok: true } | { ok: false; status: number }> {
  const res = await fetch('/api/diary/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  if (res.ok) {
    const data = (await res.json()) as { inserted: number; existing: number; rejected: { index: number; id?: string; reason: string }[] }
    return {
      ok: true,
      inserted: data.inserted,
      existing: data.existing,
      rejected: data.rejected.map((r) => ({ ref: r.id?.slice(0, 12) ?? `#${r.index + 1}`, reason: r.reason })),
    }
  }
  // 限流与服务端抖动：退避重试（导入中断的代价远大于等 2 秒）
  if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRY) {
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    return postBatch(payload, signal, attempt + 1)
  }
  return { ok: false, status: res.status }
}

/** 已加密、待上传的一条（`bytes` 只用于本地切批估算，不发给服务器） */
interface Ready {
  id: string
  ciphertext: string
  iv: string
  encryptionVersion: number
  latitude: number | null
  longitude: number | null
  locationAccuracy: number | null
  locationName: string | null
  weather: string | null
  timezone: string | null
  wordCount: number
  createdAt: string
  updatedAt: string
  bytes: number
}

/**
 * 上行 payload：**逐字段显式列出**而不是解构丢弃 `bytes`。
 * 一来避免 lint 报未使用变量，二来让「哪些字段真的发给服务器」一眼可见。
 */
function toPayload(e: Ready): Omit<Ready, 'bytes'> {
  return {
    id: e.id,
    ciphertext: e.ciphertext,
    iv: e.iv,
    encryptionVersion: e.encryptionVersion,
    latitude: e.latitude,
    longitude: e.longitude,
    locationAccuracy: e.locationAccuracy,
    locationName: e.locationName,
    weather: e.weather,
    timezone: e.timezone,
    wordCount: e.wordCount,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }
}

export async function importJournalFile(opts: {
  file: File
  dek: CryptoKey
  onProgress?: (p: ImportProgress) => void
  signal?: AbortSignal
}): Promise<ImportReport> {
  const { file, dek, onProgress, signal } = opts
  const report: ImportReport = { total: 0, imported: 0, existing: 0, rejected: [], warnings: [], aborted: false }
  const progress = (phase: ImportProgress['phase'], done: number, total: number) => onProgress?.({ phase, done, total })

  progress('reading', 0, 0)
  const text = await readJournalText(file)

  progress('parsing', 0, 0)
  let parsed: Awaited<ReturnType<typeof parseJournal>>
  try {
    parsed = await parseJournal(JSON.parse(text))
  } catch (e) {
    throw new Error(e instanceof SyntaxError ? '文件不是合法的 JSON' : e instanceof Error ? e.message : '文件解析失败')
  }
  report.total = parsed.entries.length + parsed.rejected.length
  report.rejected.push(...parsed.rejected)
  report.warnings.push(...parsed.warnings)

  // —— 加密 + 本地预检（超长条目按既定策略拒绝并报告，不等服务器 400）——
  progress('encrypting', 0, parsed.entries.length)
  const ready: Ready[] = []
  for (let i = 0; i < parsed.entries.length; i++) {
    const e = parsed.entries[i]
    const { ciphertext, iv } = await encryptText(dek, e.text)
    if (ciphertext.length > MAX_CIPHERTEXT_CHARS) {
      report.rejected.push({
        ref: e.id.slice(0, 12),
        reason: `正文过长（密文 ${ciphertext.length} 字符，上限 ${MAX_CIPHERTEXT_CHARS}）`,
      })
      continue
    }
    ready.push({
      id: e.id,
      ciphertext,
      iv,
      encryptionVersion: 1,
      latitude: e.latitude,
      longitude: e.longitude,
      locationAccuracy: e.locationAccuracy,
      locationName: e.locationName,
      weather: e.weather,
      timezone: e.timezone,
      wordCount: e.wordCount,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      bytes: ciphertext.length + iv.length + 256,
    })
    if (i % 25 === 0) progress('encrypting', i + 1, parsed.entries.length)
  }
  progress('encrypting', parsed.entries.length, parsed.entries.length)

  // —— 按体积切批上传 ——
  let sent = 0
  progress('uploading', 0, ready.length)
  for (const batch of batchByBytes(ready)) {
    if (signal?.aborted) {
      report.aborted = true
      break
    }
    const res = await postBatch({ entries: batch.map(toPayload) }, signal)
    if (!res.ok) {
      throw new Error(
        res.status === 413
          ? '单批数据过大被服务器拒绝（请把文件拆小后分批导入）'
          : `导入请求失败（HTTP ${res.status}）`,
      )
    }
    report.imported += res.inserted
    report.existing += res.existing
    report.rejected.push(...res.rejected)
    sent += batch.length
    progress('uploading', sent, ready.length)
  }

  // —— 刷新本地密文缓存：导入的条目必须立刻出现在离线列表里，且旧的残留要被清掉 ——
  if (!report.aborted) {
    progress('refreshing', 0, 0)
    try {
      await fetchAllEntries()
    } catch {
      report.warnings.push('本地缓存刷新失败（条目已入库，联网后打开列表会自动同步）')
    }
  }

  progress('done', report.imported, ready.length)
  return report
}
