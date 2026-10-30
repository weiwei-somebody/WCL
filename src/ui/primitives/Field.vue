<script setup lang="ts">
defineProps<{ title: string; note?: string; stacked?: boolean }>()
</script>

<template>
  <div class="field" :class="{ stacked }">
    <div class="field-text">
      <div class="field-title">{{ title }}</div>
      <div v-if="note" class="field-note">{{ note }}</div>
    </div>
    <div class="field-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border);
}

.field:last-child {
  border-bottom: 0;
}

.field.stacked {
  flex-direction: column;
  align-items: stretch;
}

.field-text {
  flex: 1;
  min-width: 0;
}

.field-title {
  font-size: 14px;
  font-weight: 500;
}

.field-note {
  margin-top: 2px;
  color: var(--text-dim);
  font-size: 12px;
}

.field-body {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  justify-content: flex-end;
}
</style>
