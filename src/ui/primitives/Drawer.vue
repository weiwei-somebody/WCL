<script setup lang="ts">
defineProps<{ open: boolean; title?: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="shade" @click.self="emit('close')">
      <aside class="drawer" role="dialog" aria-modal="true">
        <header class="drawer-head">
          <h3 class="drawer-title">{{ title }}</h3>
          <button class="drawer-close" aria-label="关闭" @click="emit('close')">×</button>
        </header>
        <div class="drawer-body">
          <slot />
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.shade {
  position: fixed;
  inset: 0;
  background: var(--mask);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 55;
  animation: shade-in var(--dur) var(--ease) both;
}

@keyframes shade-in {
  from {
    opacity: 0;
  }
}

.drawer {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  bottom: var(--space-3);
  width: min(560px, calc(100vw - 2 * var(--space-3)));
  display: flex;
  flex-direction: column;
  background-color: var(--glass-bg-strong);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(var(--glass-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(150%);
  box-shadow: var(--shadow-3);
  animation: slide var(--dur-slow) var(--ease-out) both;
}

@supports not ((backdrop-filter: blur(2px)) or (-webkit-backdrop-filter: blur(2px))) {
  .drawer {
    background-color: var(--glass-solid);
  }
}

@keyframes slide {
  from {
    opacity: 0;
    transform: translateX(24px);
  }
}

.drawer-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border-bottom: 1px solid var(--glass-border);
}

.drawer-title {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
}

.drawer-close {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-dim);
  font-size: 18px;
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}

.drawer-close:hover {
  background: var(--surface-soft);
  color: var(--text);
}

.drawer-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--space-4);
}
</style>
