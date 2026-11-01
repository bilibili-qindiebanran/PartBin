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

/* 间距统一交给 gap；否则换行后第二个按钮会带 12px 左边距而错位 */
.page-header__actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

/* 页面给了 #actions 插槽但内容为空（例如 v-if 不成立）时不留空行 */
.page-header__actions:empty {
  display: none;
}

@media (max-width: 767px) {
  .page-header {
    /* 标题与操作上下两行：否则按钮较多时标题会被压成竖排 */
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: var(--space-4);
  }

  .page-header__text {
    flex: 1 1 100%;
    min-width: 0;
  }

  .page-header__text h1 {
    font-size: 18px;
  }

  .page-header__actions {
    flex: 1 1 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}
</style>
