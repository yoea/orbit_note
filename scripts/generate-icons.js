// 生成 PWA 图标：180/192/512 PNG。纯 Node 实现（zlib deflate + 手写 PNG 块），零图像依赖。
/* eslint-disable @typescript-eslint/no-require-imports */
const zlib = require('node:zlib')
const fs = require('node:fs')
const path = require('node:path')

function crc32(buf) {
  let c, table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, draw) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
  const idat = zlib.deflateSync(raw)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ])
}

// 深色圆角底 + 白色书页 + 橙色圆点（极简日记图标）
function draw(size) {
  return (x, y) => {
    const px = x / size, py = y / size
    // 圆角矩形（近似）：中心区域
    const radius = size * 0.22
    const rectX = Math.max(Math.abs(px - 0.5) * size - (size / 2 - radius), 0)
    const rectY = Math.max(Math.abs(py - 0.5) * size - (size / 2 - radius), 0)
    const inRect = rectX * rectX + rectY * rectY <= radius * radius || (Math.abs(px - 0.5) < 0.5 - radius / size && Math.abs(py - 0.5) < 0.5 - radius / size)
    if (!inRect) return [0, 0, 0, 0]
    // 书页：中间白色区域
    const isPage = px > 0.34 && px < 0.66 && py > 0.3 && py < 0.7
    if (isPage) return [255, 255, 255, 255]
    // 橙色圆点（"此刻"）
    const dotDist = Math.hypot(px - 0.5, py - 0.46)
    if (dotDist < 0.05) return [249, 115, 22, 255]
    return [23, 23, 23, 255]
  }
}

const dir = path.join(__dirname, '..', 'public', 'icons')
fs.mkdirSync(dir, { recursive: true })
for (const size of [180, 192, 512]) {
  fs.writeFileSync(path.join(dir, `icon-${size}.png`), png(size, draw(size)))
  console.log(`icon-${size}.png generated`)
}
