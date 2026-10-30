/**
 * 浏览器阶段的最小 ZIP 写入器：STORE（不压缩）+ CRC32，
 * 生成的是可被系统解压工具正常打开的 zip，桌面阶段换成 KMCL 的 yazl。
 */
export interface ZipFile {
  name: string
  data: Uint8Array | string
}

export interface ZipResult {
  blob: Blob
  checksum: string
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[i] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (let i = 0; i < bytes.length; i++) value = CRC_TABLE[(value ^ bytes[i]) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function dosStamp(date: Date): { time: number; day: number } {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff
  return { time, day }
}

function fingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0').repeat(4)
}

export function createZip(files: ZipFile[]): ZipResult {
  const stamp = dosStamp(new Date())
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  let total = 22
  for (const file of files) {
    const name = utf8(file.name)
    const data = typeof file.data === 'string' ? utf8(file.data) : file.data
    const sum = crc32(data)
    const local = new Uint8Array(30 + name.length + data.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0x0800, true)
    localView.setUint16(10, stamp.time, true)
    localView.setUint16(12, stamp.day, true)
    localView.setUint32(14, sum, true)
    localView.setUint32(18, data.length, true)
    localView.setUint32(22, data.length, true)
    localView.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(data, 30 + name.length)
    locals.push(local)
    total += local.length

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint16(12, stamp.time, true)
    centralView.setUint16(14, stamp.day, true)
    centralView.setUint32(16, sum, true)
    centralView.setUint32(20, data.length, true)
    centralView.setUint32(24, data.length, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)
    total += central.length
    offset += local.length
  }
  const centralSize = centrals.reduce((size, item) => size + item.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, files.length, true)
  endView.setUint16(10, files.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  const out = new Uint8Array(total)
  let cursor = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, cursor)
    cursor += part.length
  }
  const blob = new Blob([out], { type: 'application/zip' })
  return { blob, checksum: fingerprint(`${files.length}|${offset}|${files.map((file) => file.name).join(',')}`) }
}

export function downloadBlob(blob: Blob, name: string): string {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
  return name
}
