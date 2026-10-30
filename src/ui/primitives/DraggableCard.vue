<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { resolveRect } from '@shared/freeLayout'
import type { DragMode, Rect, ResizeEdge } from '@shared/freeLayout'

const props = withDefaults(defineProps<{
  rect: Rect
  others?: Rect[]
  bounds?: { w: number, h: number }
  editing?: boolean
  scale?: number
  flow?: boolean
  minW?: number
  minH?: number
  grid?: number
}>(), {
  others: () => [],
  bounds: () => ({ w: 0, h: 0 }),
  editing: false,
  scale: 1,
  flow: false,
  minW: 180,
  minH: 80,
  grid: 8
})

const emit = defineEmits<{ (e: 'update', rect: Rect): void }>()

const EDGES: ResizeEdge[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

const active = ref<DragMode | ''>('')
let startX = 0
let startY = 0
let base: Rect = { x: 0, y: 0, w: 0, h: 0 }
let last: Rect = { x: 0, y: 0, w: 0, h: 0 }

const style = computed(() => {
  if (props.flow) return {}
  return { left: `${props.rect.x}px`, top: `${props.rect.y}px`, width: `${props.rect.w}px`, height: `${props.rect.h}px` }
})

function begin(event: PointerEvent, mode: DragMode): void
{
  if (!props.editing || props.flow) return
  event.preventDefault()
  event.stopPropagation()
  base = { ...props.rect }
  last = { ...props.rect }
  startX = event.clientX
  startY = event.clientY
  active.value = mode
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

function move(event: PointerEvent): void
{
  if (!active.value) return
  const scale = props.scale || 1
  const next = resolveRect(
    base,
    active.value,
    (event.clientX - startX) / scale,
    (event.clientY - startY) / scale,
    { others: props.others, bounds: props.bounds, minW: props.minW, minH: props.minH, grid: props.grid }
  )
  if (!next) return
  last = next
  emit('update', next)
}

function end(): void
{
  if (!active.value) return
  window.removeEventListener('pointermove', move)
  window.removeEventListener('pointerup', end)
  window.removeEventListener('pointercancel', end)
  active.value = ''
}

onUnmounted(end)
</script>

<template>
  <div
    class="draggable"
    :class="{ flow, editing: editing && !flow, active: !!active }"
    :style="style"
    @pointerdown="begin($event, 'move')"
  >
    <div class="draggable-slot" :class="{ frozen: editing && !flow }">
      <slot />
    </div>
    <template v-if="editing && !flow">
      <span v-for="edge in EDGES" :key="edge" class="grip" :class="`grip-${edge}`" @pointerdown="begin($event, edge)" />
    </template>
  </div>
</template>

<style scoped>
.draggable {
  position: absolute;
}

.draggable.flow {
  position: static;
  width: auto;
  height: auto;
}

.draggable-slot {
  height: 100%;
  min-height: 0;
}

.draggable.flow .draggable-slot {
  height: auto;
}

.draggable.editing {
  z-index: 2;
  outline: 1px dashed var(--border-strong);
  cursor: grab;
}

.draggable.editing.active {
  outline-style: solid;
  outline-color: var(--accent);
  cursor: grabbing;
}

.draggable-slot.frozen {
  pointer-events: none;
}

.grip {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--accent);
  box-shadow: 0 0 0 1px var(--surface);
  z-index: 6;
}

.grip-n {
  top: -5px;
  left: 50%;
  margin-left: -5px;
  cursor: ns-resize;
}

.grip-s {
  bottom: -5px;
  left: 50%;
  margin-left: -5px;
  cursor: ns-resize;
}

.grip-e {
  right: -5px;
  top: 50%;
  margin-top: -5px;
  cursor: ew-resize;
}

.grip-w {
  left: -5px;
  top: 50%;
  margin-top: -5px;
  cursor: ew-resize;
}

.grip-ne {
  right: -5px;
  top: -5px;
  cursor: nesw-resize;
}

.grip-nw {
  left: -5px;
  top: -5px;
  cursor: nwse-resize;
}

.grip-se {
  right: -5px;
  bottom: -5px;
  cursor: nwse-resize;
}

.grip-sw {
  left: -5px;
  bottom: -5px;
  cursor: nesw-resize;
}
</style>
