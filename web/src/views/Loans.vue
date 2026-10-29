<template>
  <div class="page">
    <PageHeader title="借出" subtitle="谁借走了什么，什么时候该还" />
    <EmptyState
      title="借出管理将在 M4 上线"
      description="届时可以登记借用人、预计归还日期，支持部分归还，并把逾期记录标红提醒。"
    >
      <template #icon><Document /></template>
      <el-tag round effect="plain">M4 · 借出与归还</el-tag>
    </EmptyState>
  </div>
</template>

<script setup>
import { Document } from '@element-plus/icons-vue';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
</script>
