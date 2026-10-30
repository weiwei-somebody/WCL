<script setup lang="ts">
const props = defineProps<{ value: number; label?: string; showText?: boolean }>()
const percent = () => Math.max(0, Math.min(100, props.value))
</script>

<template>
  <div class="bar-wrap">
    <div class="bar">
      <div class="fill" :style="{ width: `${percent()}%` }" />
    </div>
    <span v-if="showText !== false" class="bar-text">{{ label ?? `${Math.round(percent())}%` }}</span>
  </div>
</template>

<style scoped>
.bar-wrap {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.bar {
  flex: 1;
  height: 7px;
  border-radius: var(--radius-pill);
  background: var(--surface-soft);
  box-shadow: inset 0 0 0 1px var(--border);
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: var(--radius-pill);
  background-color: var(--accent);
  box-shadow: 0 0 14px var(--accent-glow);
  transition: width var(--dur-slow) var(--ease-out);
}

.bar-text {
  min-width: 56px;
  text-align: right;
  color: var(--text-dim);
  font-size: 12px;
}
</style>
