<script setup lang="ts">
defineProps<{ modelValue: string; placeholder?: string; type?: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
</script>

<template>
  <input
    class="text-input"
    :value="modelValue"
    :placeholder="placeholder"
    :type="type ?? 'text'"
    :disabled="disabled"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>

<style scoped>
.text-input {
  height: var(--control-h);
  width: 100%;
  min-width: 140px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text);
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}

.text-input::placeholder {
  color: var(--text-mute);
}

.text-input:hover:not(:disabled) {
  border-color: var(--border-strong);
}

.text-input:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--surface-3);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.text-input:disabled {
  opacity: 0.5;
}
</style>
