<template>
  <header class="page-header">
    <div class="page-header__text">
      <h1>{{ title }}</h1>
      <p v-if="subtitle">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
});
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}

.page-header__text h1 {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.25;
}

.page-header__text p {
  margin-top: 4px;
  color: var(--ink-600);
  font-size: 13px;
}

.page-header__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

@media (max-width: 767px) {
  .page-header {
    align-items: flex-start;
    margin-bottom: var(--space-4);
  }

  .page-header__text h1 {
    font-size: 18px;
  }
}
</style>
