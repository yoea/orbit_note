// ZIP 读写的守卫测试。
//
// 为什么值得写：读的路径服务的是**别人的文件**（Day One / Journey 的备份包），
// 而且 DEFLATE 解压走平台的 DecompressionStream——这条链路平时碰不到，
// 一旦写错，用户看到的是"导入失败"，而不是任何能定位的报错。
import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { createZip, crc32, listZipEntries, readZipEntry } from '@/lib/client/zip'

const TE = new TextEncoder()
const TD = new TextDecoder()

/** 手工拼一个 DEFLATE 压缩的 zip 条目（模拟 Day One 那种真压缩包） */
function deflateZip(name: string, content: string): Uint8Array<ArrayBuffer> {
  const nameBytes = TE.encode(name)
  const raw = TE.encode(content)
  const comp = new Uint8Array(deflateRawSync(raw))
  const crc = crc32(raw)

  const local = new Uint8Array(30 + nameBytes.length + comp.length)
  const lv = new DataView(local.buffer)
  lv.setUint32(0, 0x04034b50, true)
  lv.setUint16(4, 20, true)
  lv.setUint16(6, 0x0800, true)
  lv.setUint16(8, 8, true) // method = DEFLATE
  lv.setUint32(14, crc, true)
  lv.setUint32(18, comp.length, true)
  lv.setUint32(22, raw.length, true)
  lv.setUint16(26, nameBytes.length, true)
  local.set(nameBytes, 30)
  local.set(comp, 30 + nameBytes.length)

  const cd = new Uint8Array(46 + nameBytes.length)
  const cv = new DataView(cd.buffer)
  cv.setUint32(0, 0x02014b50, true)
  cv.setUint16(4, 20, true)
  cv.setUint16(6, 20, true)
  cv.setUint16(8, 0x0800, true)
  cv.setUint16(10, 8, true)
  cv.setUint32(16, crc, true)
  cv.setUint32(20, comp.length, true)
  cv.setUint32(24, raw.length, true)
  cv.setUint16(28, nameBytes.length, true)
  cv.setUint32(42, 0, true)
  cd.set(nameBytes, 46)

  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, 1, true)
  ev.setUint16(10, 1, true)
  ev.setUint32(12, cd.length, true)
  ev.setUint32(16, local.length, true)

  const out = new Uint8Array(local.length + cd.length + eocd.length)
  out.set(local, 0)
  out.set(cd, local.length)
  out.set(eocd, local.length + cd.length)
  return out
}

describe('ZIP：写（STORE）', () => {
  const zip = createZip([
    { name: 'Journal.json', data: TE.encode('{"entries":[]}') },
    { name: 'notes/readme.txt', data: TE.encode('hello') },
  ])

  it('签名与结构正确（本地头 / 中央目录 / EOCD 都在）', () => {
    const dv = new DataView(zip.buffer)
    expect(dv.getUint32(0, true)).toBe(0x04034b50)
    expect(dv.getUint32(zip.length - 22, true)).toBe(0x06054b50)
    expect(dv.getUint16(zip.length - 14, true)).toBe(2) // 条目数
  })

  it('文件名带 UTF-8 标志位（否则中文名在 Windows 上乱码）', () => {
    const dv = new DataView(zip.buffer)
    expect(dv.getUint16(6, true) & 0x0800).toBe(0x0800)
  })

  it('能列目录并读回内容（含子目录名）', () => {
    expect(listZipEntries(zip).map((e) => e.name)).toEqual(['Journal.json', 'notes/readme.txt'])
  })

  it('CRC32 与实际内容一致', () => {
    const info = listZipEntries(zip)[1]
    expect(info.crc32).toBe(crc32(TE.encode('hello')))
  })
})

describe('ZIP：读（STORE / DEFLATE）', () => {
  it('读回自己写的 STORE 条目', async () => {
    const zip = createZip([{ name: 'a.json', data: TE.encode('和平') }])
    const got = await readZipEntry(zip, 'a.json')
    expect(TD.decode(got!)).toBe('和平')
  })

  it('读得到 DEFLATE 压缩的条目（外部工具产物）', async () => {
    const zip = deflateZip('Journal.json', '{"entries":[{"text":"压缩过的内容"}]}')
    const got = await readZipEntry(zip, 'Journal.json')
    expect(TD.decode(got!)).toBe('{"entries":[{"text":"压缩过的内容"}]}')
  })

  it('容忍 ./ 前缀写法（本应用产物是 ./Journal.json，外部工具是 Journal.json）', async () => {
    const zip = deflateZip('./Journal.json', '{}')
    expect(await readZipEntry(zip, 'Journal.json')).not.toBeNull()
  })

  it('条目不存在返回 null，而不是抛错', async () => {
    const zip = createZip([{ name: 'a.json', data: TE.encode('x') }])
    expect(await readZipEntry(zip, 'nope.json')).toBeNull()
  })

  it('不是 zip 时明确抛错（而不是返回空目录）', () => {
    expect(() => listZipEntries(TE.encode('这不是 zip'))).toThrow(/不是有效的 ZIP/)
  })
})
