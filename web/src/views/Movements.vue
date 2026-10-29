<template>
  <div class="page">
    <PageHeader title="流水" subtitle="每一次数量变化都会留下记录" />
    <EmptyState
      title="流水台账将在 M3 上线"
      description="届时可在这里按物料、类型和时间筛选出入库记录，查看每次操作的操作人、增减数量与操作后余额。"
    >
      <template #icon><Tickets /></template>
      <el-tag round effect="plain">M3 · 出入库与流水</el-tag>
    </EmptyState>
  </div>
</template>

<script setup>
import { Tickets } from '@element-plus/icons-vue';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
</script>
