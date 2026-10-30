<script setup lang="ts">
defineProps<{ open: boolean; title?: string; width?: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="mask" @click.self="emit('close')">
      <div class="modal" :style="{ width: width ?? '520px' }" role="dialog" aria-modal="true">
        <header v-if="title" class="modal-head">
          <h3 class="modal-title">{{ title }}</h3>
          <button class="modal-close" aria-label="关闭" @click="emit('close')">×</button>
        </header>
        <div class="modal-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="modal-foot">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: var(--space-5);
  background: var(--mask);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 60;
  animation: mask-in var(--dur) var(--ease) both;
}

@keyframes mask-in {
  from {
    opacity: 0;
  }
}

.modal {
  max-width: 92vw;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background-color: var(--glass-bg-strong);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(var(--glass-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(150%);
  box-shadow: var(--shadow-3);
  animation: modal-in var(--dur-slow) var(--ease-out) both;
}

@supports not ((backdrop-filter: blur(2px)) or (-webkit-backdrop-filter: blur(2px))) {
  .modal {
    background-color: var(--glass-solid);
  }
}

@keyframes modal-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.98);
  }
}

.modal-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border-bottom: 1px solid var(--glass-border);
}

.modal-title {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
}

.modal-close {
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

.modal-close:hover {
  background: var(--surface-soft);
  color: var(--text);
}

.modal-body {
  padding: var(--space-4);
  overflow: auto;
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--glass-border);
}
</style>
