<script setup lang="ts">
import { bridge } from '@/bridge'

defineProps<{ note?: string }>()
</script>

<template>
  <div v-if="bridge.kind !== 'electron'" class="desktop-only">
    <span class="tag desktop">桌面版</span>
    <span class="note">{{ note ?? '该功能需要桌面版才能执行，浏览器模式下为只读' }}</span>
    <slot />
  </div>
  <slot v-else />
</template>

<style scoped>
.desktop-only {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.note {
  flex: 1;
  color: var(--text-dim);
  font-size: 12px;
}
</style>
