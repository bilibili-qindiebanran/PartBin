<template>
  <div class="empty-state">
    <div class="empty-state__icon">
      <slot name="icon" />
    </div>
    <h2>{{ title }}</h2>
    <p>{{ description }}</p>
    <div v-if="$slots.default" class="empty-state__extra">
      <slot />
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
});
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--space-8) var(--space-5);
  background: rgba(255, 255, 255, 0.72);
  border: 1px dashed rgba(15, 23, 42, 0.16);
  border-radius: var(--r-lg);
}

.empty-state__icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: var(--space-4);
  border-radius: 18px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 26px;
}

.empty-state h2 {
  font-size: 16px;
  font-weight: 600;
}

.empty-state p {
  margin-top: 6px;
  max-width: 420px;
  color: var(--ink-600);
  font-size: 13px;
  line-height: 1.6;
}

.empty-state__extra {
  margin-top: var(--space-4);
}
</style>
