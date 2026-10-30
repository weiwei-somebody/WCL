<script setup lang="ts">
defineProps<{ text?: string; note?: string }>()
</script>

<template>
  <div class="empty">
    <div class="empty-text">{{ text ?? '暂无内容' }}</div>
    <div v-if="note" class="empty-note">{{ note }}</div>
    <slot />
  </div>
</template>

<style scoped>
.empty {
  display: grid;
  place-items: center;
  gap: var(--space-2);
  padding: var(--space-6) var(--space-4);
  color: var(--text-dim);
  text-align: center;
}

.empty-text {
  font-size: 14px;
}

.empty-note {
  font-size: 12px;
  color: var(--text-mute);
}
</style>
