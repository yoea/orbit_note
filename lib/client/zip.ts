// 最小 ZIP 读写实现（**不引第三方库**）。
//
// 写：只输出 STORE（method 0，不压缩）。理由——导入方（Day One / Journey）只关心目录结构与
//     JSON 内容，压缩与否不影响兼容性；而 STORE 让实现保持在百行内、零依赖、任何解压工具都能开。
//     文件名走 UTF-8（通用标志位 0x0800），否则非 ASCII 名字在 Windows 资源管理器里会乱码。
// 读：支持 STORE(0) 与 DEFLATE(8)。DEFLATE 走平台自带的 `DecompressionStream('deflate-raw')`
//     （Safari 16.4+ / Chrome 80+，本项目 iOS 基线远高于此），**依然零第三方依赖**——
//     这是必须的：Day One / Journey 导出的 zip 是压缩的，只能读 STORE 等于不能读别人的文件。
// 不支持：ZIP64（>4GB）、加密、多卷。日记导出碰不到；真遇到时明确报错，不静默出错。

const TE = new TextEncoder()
const TD = new TextDecoder()

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let n = 0
  for (const c of chunks) n += c.length
  const out = new Uint8Array(n)
  let p = 0
  for (const c of chunks) {
    out.set(c, p)
    p += c.length
  }
  return out
}

// DOS 日期时间（ZIP 头用的老格式：秒只有 2 秒精度，1980 年起算）
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f),
    date: ((((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f)),
  }
}

export interface ZipInput {
  name: string
  data: Uint8Array
}

export interface ZipEntryInfo {
  name: string
  method: number
  crc32: number
  compSize: number
  uncompSize: number
  offset: number
}

/** 生成 STORE 型 ZIP。目录条目由调用方用「空数据的 name + '/'」显式给出。 */
export function createZip(files: ZipInput[], opts: { date?: Date } = {}): Uint8Array<ArrayBuffer> {
  const { time, date } = dosDateTime(opts.date ?? new Date())
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const f of files) {
    const nameBytes = TE.encode(f.name)
    const crc = crc32(f.data)
    const size = f.data.length

    const lh = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(lh.buffer)
    lv.setUint32(0, 0x04034b50, true) // 本地文件头签名
    lv.setUint16(4, 20, true) // 解压所需版本
    lv.setUint16(6, 0x0800, true) // 通用标志位：文件名为 UTF-8
    lv.setUint16(8, 0, true) // method = STORE
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true) // 压缩后大小
    lv.setUint32(22, size, true) // 原始大小（STORE 两者相同）
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true) // extra 长度
    lh.set(nameBytes, 30)
    locals.push(lh, f.data)

    const ch = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(ch.buffer)
    cv.setUint32(0, 0x02014b50, true) // 中央目录签名
    cv.setUint16(4, 20, true) // 生成程序版本
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true) // extra
    cv.setUint16(32, 0, true) // comment
    cv.setUint16(34, 0, true) // 起始磁盘号
    cv.setUint16(36, 0, true) // 内部属性
    cv.setUint32(38, 0, true) // 外部属性
    cv.setUint32(42, offset, true) // 本地头相对偏移
    ch.set(nameBytes, 46)
    centrals.push(ch)

    offset += lh.length + size
  }

  const cd = concat(centrals)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, cd.length, true)
  ev.setUint32(16, offset, true) // 中央目录起始偏移
  ev.setUint16(20, 0, true) // 注释长度
  return concat([...locals, cd, eocd])
}

/** 列出 zip 内条目（读中央目录；损坏时抛错而不是返回空数组）
 *  形参显式写成 `Uint8Array<ArrayBuffer>`：否则 `.subarray()` 推成 ArrayBufferLike，
 *  传给 `new Blob([...])` 会因 BlobPart 不接受 SharedArrayBuffer 而 TS 报错。 */
export function listZipEntries(zip: Uint8Array<ArrayBuffer>): ZipEntryInfo[] {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  // EOCD 在文件末尾，但前面可能有最多 65535 字节注释 ⇒ 从尾部回扫
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件（找不到中央目录末尾记录）')

  const total = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const out: ZipEntryInfo[] = []
  for (let i = 0; i < total; i++) {
    if (p + 46 > zip.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP 中央目录损坏')
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    out.push({
      name: TD.decode(zip.subarray(p + 46, p + 46 + nameLen)),
      method: dv.getUint16(p + 10, true),
      crc32: dv.getUint32(p + 16, true),
      compSize: dv.getUint32(p + 20, true),
      uncompSize: dv.getUint32(p + 24, true),
      offset: dv.getUint32(p + 42, true),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** 按名字取一个条目的内容；不存在返回 null。（同时容忍 `x` 与 `./x` 两种写法） */
export async function readZipEntry(zip: Uint8Array<ArrayBuffer>, name: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const info = listZipEntries(zip).find((e) => e.name === name || e.name === `./${name}`)
  if (!info) return null
  if (info.compSize === 0 && info.name.endsWith('/')) return new Uint8Array(0) // 目录条目

  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  if (dv.getUint32(info.offset, true) !== 0x04034b50) throw new Error('ZIP 本地文件头损坏')
  // 本地头的 extra 长度可能与中央目录不同，必须按本地头算数据起点
  const nameLen = dv.getUint16(info.offset + 26, true)
  const extraLen = dv.getUint16(info.offset + 28, true)
  const start = info.offset + 30 + nameLen + extraLen
  const raw = zip.subarray(start, start + info.compSize)
  if (raw.length !== info.compSize) throw new Error('ZIP 数据被截断')

  if (info.method === 0) return raw.slice()
  if (info.method === 8) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前浏览器不支持解压该 ZIP（缺少 DecompressionStream）')
    }
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }
  throw new Error(`不支持的 ZIP 压缩方式（method=${info.method}）`)
}
