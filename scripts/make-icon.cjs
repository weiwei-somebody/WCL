// 生成 WCL 品牌图标：深板岩底 + 铜色 W 字标（程序化绘制，无外部素材与依赖）。
// 产出 build/icon.png（窗口图标，256px）与 build/icon.ico（可执行文件图标）。
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const SIZE = 256
const SS = 4
const BIG = SIZE * SS

const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value

function insideRounded(px, py, left, top, right, bottom, radius) {
  const cx = Math.min(Math.max(px, left + radius), right - radius)
  const cy = Math.min(Math.max(py, top + radius), bottom - radius)
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= radius * radius
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const length = vx * vx + vy * vy
  const t = length === 0 ? 0 : clamp01((wx * vx + wy * vy) / length)
  const dx = px - (ax + t * vx)
  const dy = py - (ay + t * vy)
  return Math.sqrt(dx * dx + dy * dy)
}

const STROKE = [
  [62, 88, 100, 178],
  [100, 178, 128, 124],
  [128, 124, 156, 178],
  [156, 178, 194, 88]
]

function sample(px, py) {
  const background = insideRounded(px, py, 18, 18, SIZE - 18, SIZE - 18, 58)
  if (!background) return [0, 0, 0, 0]
  const vertical = py / SIZE
  const ring = !insideRounded(px, py, 22, 22, SIZE - 22, SIZE - 22, 55)
  if (ring) return [217, 139, 74, 0.42]
  let best = Infinity
  for (const [ax, ay, bx, by] of STROKE) best = Math.min(best, distanceToSegment(px, py, ax, ay, bx, by))
  const glyph = clamp01((13 - best) / 1.6)
  const base = [Math.round(28 - vertical * 18), Math.round(22 - vertical * 14), Math.round(17 - vertical * 10)]
  if (glyph <= 0) return [base[0], base[1], base[2], 1]
  const copper = [Math.round(230 - vertical * 46), Math.round(168 - vertical * 52), Math.round(105 - vertical * 54)]
  return [
    Math.round(base[0] + (copper[0] - base[0]) * glyph),
    Math.round(base[1] + (copper[1] - base[1]) * glyph),
    Math.round(base[2] + (copper[2] - base[2]) * glyph),
    1
  ]
}

function render() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [sr, sg, sb, sa] = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)
          r += sr * sa; g += sg * sa; b += sb * sa; a += sa
        }
      }
      const samples = SS * SS
      const offset = (y * SIZE + x) * 4
      if (a === 0) { pixels[offset] = 0; pixels[offset + 1] = 0; pixels[offset + 2] = 0; pixels[offset + 3] = 0; continue }
      pixels[offset] = Math.round(r / a)
      pixels[offset + 1] = Math.round(g / a)
      pixels[offset + 2] = Math.round(b / a)
      pixels[offset + 3] = Math.round((a / samples) * 255)
    }
  }
  return pixels
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function encodePng(pixels) {
  const stride = SIZE * 4 + 1
  const raw = Buffer.alloc(stride * SIZE)
  for (let y = 0; y < SIZE; y++) {
    raw[y * stride] = 0
    pixels.copy(raw, y * stride + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(SIZE, 0)
  header.writeUInt32BE(SIZE, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function encodeIco(png) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry[0] = 0
  entry[1] = 0
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12)
  return Buffer.concat([header, entry, png])
}

const png = encodePng(render())
const build = path.join(path.resolve(__dirname, '..'), 'build')
fs.mkdirSync(build, { recursive: true })
fs.writeFileSync(path.join(build, 'icon.png'), png)
fs.writeFileSync(path.join(build, 'icon.ico'), encodeIco(png))
console.log('已生成 build/icon.png 与 build/icon.ico')
