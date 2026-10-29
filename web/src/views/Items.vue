<template>
  <div class="page">
    <PageHeader title="库存" subtitle="物料、分类与存放位置" />
    <EmptyState
      title="库存模块将在 M2 上线"
      description="下一阶段接入物料增删改查、分类与位置树、搜索筛选和低库存标记。当前账号与权限已经可用。"
    >
      <template #icon><Box /></template>
      <el-tag round effect="plain">M2 · 库存主数据</el-tag>
    </EmptyState>
  </div>
</template>

<script setup>
import { Box } from '@element-plus/icons-vue';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
</script>
