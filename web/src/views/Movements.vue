<template>
  <div class="page">
    <PageHeader title="流水" :subtitle="`共 ${total} 条记录`" />

    <section class="toolbar card">
      <el-select v-model="filters.type" class="toolbar__select" clearable placeholder="全部类型">
        <el-option v-for="(meta, key) in TYPE_META" :key="key" :label="meta.label" :value="key" />
      </el-select>

      <el-date-picker
        v-model="filters.range"
        type="daterange"
        value-format="YYYY-MM-DD"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        class="toolbar__range"
      />

      <el-button text :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
    </section>

    <div v-if="isMobile" v-loading="loading" class="cards">
      <article v-for="row in movements" :key="row.id" class="movement-card card">
        <div class="movement-card__head">
          <el-tag size="small" :type="TYPE_META[row.type]?.type || 'info'" round effect="plain">
            {{ TYPE_META[row.type]?.label || row.type }}
          </el-tag>
          <strong class="num" :class="deltaClass(row)">{{ formatDelta(row) }}</strong>
        </div>
        <p class="movement-card__item">{{ row.itemName }}</p>
        <p class="movement-card__meta">
          {{ formatDate(row.occurredAt, { withTime: true }) }} · {{ row.userName || '—' }}
        </p>
        <p v-if="row.note" class="movement-card__note">{{ row.note }}</p>
        <p class="movement-card__balance">操作后余额 {{ row.balanceAfter }}</p>
      </article>
    </div>

    <div v-else class="table-wrap card">
      <el-table v-loading="loading" :data="movements" empty-text="还没有流水">
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatDate(row.occurredAt, { withTime: true }) }}</template>
        </el-table-column>
        <el-table-column prop="itemName" label="物料" min-width="180" show-overflow-tooltip />
        <el-table-column label="类型" width="92">
          <template #default="{ row }">
            <el-tag size="small" :type="TYPE_META[row.type]?.type || 'info'" round effect="plain">
              {{ TYPE_META[row.type]?.label || row.type }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="变动" width="90" align="right">
          <template #default="{ row }">
            <strong class="num" :class="deltaClass(row)">{{ formatDelta(row) }}</strong>
          </template>
        </el-table-column>
        <el-table-column label="余额" width="90" align="right">
          <template #default="{ row }">
            <span class="num muted">{{ row.balanceAfter }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="userName" label="操作人" width="110" />
        <el-table-column prop="note" label="备注" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.note || '—' }}</template>
        </el-table-column>
      </el-table>
    </div>

    <EmptyState
      v-if="!loading && movements.length === 0"
      title="还没有流水"
      description="入库、出库、盘点等操作都会在这里留下不可修改的记录。"
    >
      <template #icon><Tickets /></template>
    </EmptyState>

    <div v-if="total > pageSize" class="pager">
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next, total"
        background
        @current-change="load"
      />
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Refresh, Tickets } from '@element-plus/icons-vue';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { api } from '@/api/client';
import { formatDate } from '@/lib/format';

const TYPE_META = {
  in: { label: '入库', type: 'success' },
  out: { label: '出库', type: 'danger' },
  adjust: { label: '盘点', type: 'warning' },
  discard: { label: '报废', type: 'danger' },
  lost: { label: '丢失', type: 'danger' },
  borrow: { label: '借出', type: 'primary' },
  return: { label: '归还', type: 'success' },
};

const { isMobile } = useBreakpoint();
const movements = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const filters = reactive({ type: '', range: [] });

function formatDelta(row) {
  if (!row.quantityDelta) return '—';
  return `${row.quantityDelta > 0 ? '+' : ''}${row.quantityDelta}`;
}

function deltaClass(row) {
  if (row.quantityDelta > 0) return 'delta-plus';
  if (row.quantityDelta < 0) return 'delta-minus';
  return 'muted';
}

async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (filters.type) params.set('type', filters.type);
    if (filters.range?.length === 2) {
      params.set('from', filters.range[0]);
      params.set('to', filters.range[1]);
    }
    const data = await api(`/api/movements?${params.toString()}`);
    movements.value = data.data;
    total.value = data.total;
    if (movements.value.length === 0 && page.value > 1) {
      page.value = 1;
      await load();
    }
  } catch (error) {
    ElMessage.error(error.message || '加载流水失败');
  } finally {
    loading.value = false;
  }
}

watch(
  [() => filters.type, () => filters.range],
  () => {
    page.value = 1;
    load();
  },
  { deep: true },
);

onMounted(load);
</script>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: var(--space-4);
  padding: 12px;
}

.toolbar__select {
  width: 150px;
}

.toolbar__range {
  width: 280px;
}

.table-wrap {
  overflow: hidden;
  border: 1px solid var(--line);
}

.cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.movement-card {
  padding: 14px;
}

.movement-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.movement-card__item {
  margin-top: 8px;
  font-size: 14px;
  font-weight: 600;
}

.movement-card__meta,
.movement-card__balance {
  margin-top: 4px;
  color: var(--ink-400);
  font-size: 11px;
}

.movement-card__note {
  margin-top: 6px;
  color: var(--ink-600);
  font-size: 12px;
}

.delta-plus {
  color: var(--success);
}

.delta-minus {
  color: var(--danger);
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-4);
}

@media (max-width: 767px) {
  .toolbar__select,
  .toolbar__range {
    width: 100%;
  }

  .pager {
    justify-content: center;
  }
}
</style>
