<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export interface SelectOption {
  value: string | number
  label: string
  hint?: string
}

const props = defineProps<{
  modelValue: string | number
  options: SelectOption[]
  disabled?: boolean
  placeholder?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [string | number] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

const current = computed(() => props.options.find((item) => item.value === props.modelValue) ?? null)

function place() {
  const box = root.value?.getBoundingClientRect()
  if (!box) return
  const height = Math.min(props.options.length * 30 + 10, 240)
  const below = box.bottom + 6
  const top = below + height > window.innerHeight - 8 ? Math.max(8, box.top - height - 6) : below
  menuStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${box.left}px`,
    width: `${Math.max(box.width, 180)}px`,
    maxHeight: `${height}px`
  }
}

function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) place()
}

function select(item: SelectOption) {
  emit('update:modelValue', item.value)
  open.value = false
}

function onDoc(event: MouseEvent) {
  if (!open.value) return
  const target = event.target as Node
  if (root.value?.contains(target) || document.getElementById('wcl-pick-menu')?.contains(target)) return
  open.value = false
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', onDoc)
  document.addEventListener('keydown', onKey)
  window.addEventListener('resize', place)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDoc)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', place)
})
</script>

<template>
  <div ref="root" class="pick-root">
    <button class="pick" :class="{ on: open }" :disabled="disabled" @click="toggle">
      <span class="pick-label" :class="{ dim: !current }">{{ current?.label ?? placeholder ?? '请选择' }}</span>
      <span v-if="current?.hint" class="pick-hint">{{ current.hint }}</span>
      <span class="pick-caret">▾</span>
    </button>
    <Teleport to="body">
      <div v-if="open" id="wcl-pick-menu" class="pick-menu" :style="menuStyle">
        <button
          v-for="item in options"
          :key="item.value"
          class="pick-item"
          :class="{ on: item.value === modelValue }"
          @click="select(item)"
        >
          <span class="item-label">{{ item.label }}</span>
          <span v-if="item.hint" class="item-hint">{{ item.hint }}</span>
          <span v-if="item.value === modelValue" class="item-check">✓</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pick-root {
  display: inline-flex;
  min-width: 0;
}

.pick {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h);
  min-width: 160px;
  max-width: 280px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text);
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}

.pick:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--surface-3);
}

.pick.on {
  border-color: var(--accent);
  background: var(--surface-3);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.pick:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pick-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-size: 13px;
}

.pick-label.dim {
  color: var(--text-mute);
}

.pick-hint {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
}

.pick-caret {
  flex: 0 0 auto;
  color: var(--text-mute);
  font-size: 10px;
}

.pick-menu {
  z-index: 80;
  overflow: auto;
  padding: 5px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
  background-color: var(--glass-bg-strong);
  backdrop-filter: blur(var(--glass-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(150%);
  box-shadow: var(--shadow-2);
  animation: menu-in var(--dur) var(--ease-out) both;
}

@supports not ((backdrop-filter: blur(2px)) or (-webkit-backdrop-filter: blur(2px))) {
  .pick-menu {
    background-color: var(--glass-solid);
  }
}

@keyframes menu-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}

.pick-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 32px;
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}

.pick-item:hover {
  background: var(--surface-soft);
}

.pick-item.on {
  background: var(--accent-soft);
  color: var(--accent);
}

.item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.item-hint {
  flex: 0 0 auto;
  color: var(--text-mute);
  font-size: 11px;
}

.item-check {
  flex: 0 0 auto;
  width: 12px;
  font-size: 12px;
}
</style>
