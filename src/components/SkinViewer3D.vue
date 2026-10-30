<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import {
  AmbientLight,
  DirectionalLight,
  NearestFilter,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  WebGLRenderer
} from 'three'
import { PreviewPlayer, skinPreviewDistance, skinPreviewPitch, skinPreviewYaw } from '@/data/skinModel'
import type { SkinPreviewAnimation } from '@/data/skinModel'
import { detectSkinVariant, loadImage, migrateLegacySkin, normalizeCape } from '@/data/skinRender'
import { createFallbackSkin } from '@/data/fallbackSkin'

const props = withDefaults(
  defineProps<{
    skin: string
    cape?: string
    variant?: 'classic' | 'slim'
    animation?: SkinPreviewAnimation
    autoRotate?: boolean
    height?: string
  }>(),
  { cape: '', variant: 'classic', animation: 'walk', autoRotate: true, height: '260px' }
)

const root = ref<HTMLDivElement | null>(null)
const dragging = ref(false)
const supported = ref(true)

let renderer: WebGLRenderer | undefined
let world: Scene
let camera: PerspectiveCamera
let player: PreviewPlayer
let resize: ResizeObserver | undefined
let skinTexture: Texture | null = null
let capeTexture: Texture | null = null
let raf = 0
let closed = false
let skinToken = 0
let capeToken = 0
let yaw = -.35
let pitch = 0
let zoom = 1
let targetYaw = yaw
let targetPitch = pitch
let targetZoom = zoom
let prev = 0
let seconds = 0
let blend = 0
let crouchBlend = 0
let flightBlend = 0
let distance = 48
let pointerX = 0
let pointerY = 0

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function makeTexture(image: HTMLImageElement | HTMLCanvasElement): Texture {
  const texture = new Texture(image)
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

async function updateSkin(): Promise<void> {
  const token = ++skinToken
  let image: HTMLImageElement | HTMLCanvasElement = createFallbackSkin()
  if (props.skin) {
    try {
      image = migrateLegacySkin(await loadImage(props.skin))
    } catch {
      image = createFallbackSkin()
    }
  }
  if (closed || !renderer || token !== skinToken) return
  const next = makeTexture(image)
  const old = skinTexture
  skinTexture = next
  player.skin.map = next
  player.skin.setOuterLayerVisible(!!props.skin)
  player.skin.modelType = (detectSkinVariant(image) ?? props.variant) === 'slim' ? 'slim' : 'default'
  old?.dispose()
  wake()
}

async function updateCape(): Promise<void> {
  const token = ++capeToken
  let image: HTMLCanvasElement | null = null
  if (props.cape) {
    try {
      image = normalizeCape(await loadImage(props.cape))
    } catch {
      image = null
    }
  }
  if (closed || !renderer || token !== capeToken) return
  const next = image ? makeTexture(image) : null
  const old = capeTexture
  capeTexture = next
  player.setCape(next)
  old?.dispose()
  wake()
}

function fit(): void {
  const el = root.value
  if (!el || !renderer || !el.clientWidth || !el.clientHeight) return
  renderer.setSize(el.clientWidth, el.clientHeight)
  camera.aspect = el.clientWidth / el.clientHeight
  camera.updateProjectionMatrix()
  distance = Math.max(20, 10 / camera.aspect) / Math.tan(camera.fov * Math.PI / 360)
  wake()
}

function wake(): void {
  if (closed || !renderer || raf) return
  prev = performance.now()
  raf = requestAnimationFrame(frame)
}

function frame(now: number): void {
  raf = 0
  if (closed || !renderer) return
  const dt = clamp((now - prev) / 1000, 0, .05)
  const ease = 1 - Math.exp(-14 * dt)
  prev = now
  if (props.autoRotate && !dragging.value) targetYaw += dt * .4
  if (props.animation !== 'idle') {
    seconds += dt
    blend += ((props.animation === 'walk' ? 1 : 0) - blend) * Math.min(1, dt * 6)
  } else {
    blend += (0 - blend) * ease
  }
  const crouch = props.animation === 'crouch' ? 1 : 0
  const fly = props.animation === 'fly' ? 1 : 0
  crouchBlend += (crouch - crouchBlend) * ease
  flightBlend += (fly - flightBlend) * ease
  yaw += (targetYaw - yaw) * ease
  pitch += (targetPitch - pitch) * ease
  zoom += (targetZoom - zoom) * ease
  const viewYaw = skinPreviewYaw(yaw, flightBlend)
  const viewPitch = skinPreviewPitch(pitch, flightBlend)
  player.pose(seconds, blend, viewYaw, { crouch: crouchBlend, fly: flightBlend })
  const d = skinPreviewDistance(distance / zoom, flightBlend)
  camera.position.set(0, 16 + Math.sin(viewPitch) * d, Math.cos(viewPitch) * d)
  camera.lookAt(0, 16, 0)
  renderer.render(world, camera)
  const settling =
    Math.abs(targetYaw - yaw) +
      Math.abs(targetPitch - pitch) +
      Math.abs(targetZoom - zoom) +
      Math.abs(crouch - crouchBlend) +
      Math.abs(fly - flightBlend) >
    .0005
  if (props.autoRotate || dragging.value || props.animation !== 'idle' || settling) {
    raf = requestAnimationFrame(frame)
  }
}

function down(event: PointerEvent): void {
  if (!supported.value || !renderer) return
  event.preventDefault()
  dragging.value = true
  pointerX = event.clientX
  pointerY = event.clientY
  root.value?.setPointerCapture(event.pointerId)
  wake()
}

function move(event: PointerEvent): void {
  if (!dragging.value) return
  targetYaw += (event.clientX - pointerX) * .01
  targetPitch = clamp(targetPitch + (event.clientY - pointerY) * .01, -Math.PI * 5 / 12, Math.PI * 5 / 12)
  pointerX = event.clientX
  pointerY = event.clientY
  wake()
}

function up(event: PointerEvent): void {
  if (!dragging.value) return
  dragging.value = false
  if (root.value?.hasPointerCapture(event.pointerId)) root.value.releasePointerCapture(event.pointerId)
  wake()
}

function wheel(event: WheelEvent): void {
  event.preventDefault()
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1
  targetZoom = clamp(targetZoom * Math.exp(-event.deltaY * unit * .0012), .5, 3)
  wake()
}

function resetView(): void {
  targetYaw = -.35
  targetPitch = 0
  targetZoom = 1
  wake()
}

onMounted(() => {
  const el = root.value
  if (!el) return
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0, 0)
    el.appendChild(renderer.domElement)
    world = new Scene()
    camera = new PerspectiveCamera(45, 1, .5, 500)
    player = new PreviewPlayer()
    const ambient = new AmbientLight(0xffffff, 2)
    const key = new DirectionalLight(0xffffff, 1)
    key.position.set(-15, 30, 50)
    world.add(player, ambient, key)
    skinTexture = makeTexture(createFallbackSkin())
    player.skin.map = skinTexture
    player.skin.setOuterLayerVisible(false)
    resize = new ResizeObserver(fit)
    resize.observe(el)
    fit()
    void updateSkin()
    void updateCape()
    wake()
  } catch {
    supported.value = false
    renderer?.dispose()
    renderer = undefined
  }
})

watch(
  () => props.skin,
  () => {
    void updateSkin()
  }
)
watch(
  () => props.variant,
  () => {
    void updateSkin()
  }
)
watch(
  () => props.cape,
  () => {
    void updateCape()
  }
)
watch(
  () => props.animation,
  () => {
    wake()
  }
)
watch(
  () => props.autoRotate,
  () => {
    wake()
  }
)

onUnmounted(() => {
  closed = true
  skinToken++
  capeToken++
  if (raf) cancelAnimationFrame(raf)
  resize?.disconnect()
  player?.dispose()
  skinTexture?.dispose()
  capeTexture?.dispose()
  renderer?.dispose()
  renderer?.forceContextLoss()
  renderer?.domElement.remove()
})

defineExpose({ resetView })
</script>

<template>
  <div
    ref="root"
    class="viewer3d"
    :class="{ dragging }"
    :style="{ height }"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
    @lostpointercapture="up"
    @wheel="wheel"
  >
    <p v-if="!supported" class="viewer3d-fallback">当前环境不支持 3D 预览</p>
  </div>
</template>

<style scoped>
.viewer3d {
  position: relative;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  overflow: hidden;
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.viewer3d.dragging {
  cursor: grabbing;
}

.viewer3d :deep(canvas) {
  display: block;
}

.viewer3d-fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text-dim);
  font-size: 13px;
}
</style>
