export function createDefaultCape(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.fillStyle = '#2b3550'
  ctx.fillRect(0, 0, 64, 32)
  ctx.fillStyle = '#3c4a6b'
  ctx.fillRect(1, 1, 10, 16)
  ctx.fillStyle = '#4e9dff'
  ctx.fillRect(4, 5, 4, 4)
  ctx.fillRect(2, 12, 8, 2)
  ctx.fillRect(12, 1, 10, 16)
  ctx.fillStyle = '#243050'
  ctx.fillRect(12, 1, 10, 16)
  ctx.fillStyle = '#4e9dff'
  ctx.fillRect(16, 4, 2, 10)
  ctx.fillStyle = '#1b2338'
  ctx.fillRect(0, 17, 64, 15)
  return canvas
}

export function capeTextureUrl(): string {
  return createDefaultCape().toDataURL('image/png')
}
