<template>
  <el-table
    v-loading="loading"
    :data="items"
    :row-class-name="rowClass"
    class="item-table"
    empty-text="还没有物料"
    @row-click="(row) => emit('open', row)"
  >
    <el-table-column label="物料" min-width="250">
      <template #default="{ row }">
        <div class="item-cell">
          <span class="thumb"><el-icon><Box /></el-icon></span>
          <span class="item-cell__text">
            <strong>{{ row.name }}</strong>
            <small>{{ row.model || row.code || '—' }}</small>
          </span>
        </div>
      </template>
    </el-table-column>

    <el-table-column label="分类" min-width="130" show-overflow-tooltip>
      <template #default="{ row }">{{ row.categoryPath || '—' }}</template>
    </el-table-column>

    <el-table-column label="位置" min-width="190">
      <template #default="{ row }">
        <div v-if="row.locationPath" class="loc">
          <BinThumb
            v-if="row.locationGridRows"
            class="loc__thumb"
            size="xs"
            :rows="row.locationGridRows"
            :cols="row.locationGridCols"
            :cells="cellOf(row)"
            :highlight="row.cellRow ? { row: row.cellRow, col: row.cellCol } : null"
          />
          <span class="loc__path" :title="row.locationPath">
            {{ row.locationPath }}
            <b v-if="row.cellRow" class="loc__cell">
              {{ cellLabel(row) }}
            </b>
          </span>
        </div>
        <span v-else class="muted">—</span>
      </template>
    </el-table-column>

    <el-table-column label="拥有" width="96" align="right">
      <template #default="{ row }">
        <span class="strong num">{{ row.quantity }}</span>
        <small class="unit">{{ row.unit }}</small>
      </template>
    </el-table-column>

    <el-table-column label="可用" width="88" align="right">
      <template #default="{ row }">
        <span class="num muted">{{ row.available }}</span>
      </template>
    </el-table-column>

    <el-table-column label="状态" width="150">
      <template #default="{ row }">
        <span class="tags">
          <el-tag v-if="row.isArchived" size="small" type="info" round>已归档</el-tag>
          <el-tag v-else-if="row.quantity === 0" size="small" type="danger" round>缺货</el-tag>
          <el-tag v-else-if="row.lowStock" size="small" type="warning" round>低库存</el-tag>
          <el-tag
            v-if="row.lentQuantity > 0"
            size="small"
            type="primary"
            effect="plain"
            round
          >
            借出 {{ row.lentQuantity }}
          </el-tag>
        </span>
      </template>
    </el-table-column>

    <el-table-column label="更新" width="116">
      <template #default="{ row }">{{ formatDate(row.updatedAt) }}</template>
    </el-table-column>

    <el-table-column label="操作" width="286" align="right">
      <template #default="{ row }">
        <el-button text size="small" @click.stop="emit('open', row)">查看</el-button>
        <template v-if="canWrite">
          <el-button text size="small" type="success" @click.stop="emit('stock-in', row)">
            入库
          </el-button>
          <el-button text size="small" @click.stop="emit('stock-out', row)">出库</el-button>
          <el-button text size="small" type="primary" @click.stop="emit('edit', row)">
            编辑
          </el-button>
          <el-button
            v-if="row.isArchived"
            text
            size="small"
            @click.stop="emit('restore', row)"
          >
            恢复
          </el-button>
          <el-button
            v-else
            text
            size="small"
            type="danger"
            @click.stop="emit('archive', row)"
          >
            归档
          </el-button>
        </template>
      </template>
    </el-table-column>
  </el-table>
</template>

<script setup>
import { Box } from '@element-plus/icons-vue';
import BinThumb from '@/components/BinThumb.vue';
import { formatDate } from '@/lib/format';

defineProps({
  items: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  canWrite: { type: Boolean, default: false },
});

const emit = defineEmits(['open', 'edit', 'archive', 'restore', 'stock-in', 'stock-out']);

function rowLetter(row) {
  let value = Number(row);
  let text = '';
  while (value > 0) {
    const rest = (value - 1) % 26;
    text = String.fromCharCode(65 + rest) + text;
    value = Math.floor((value - 1) / 26);
  }
  return text;
}

function cellLabel(row) {
  return row.cellRow ? `${rowLetter(row.cellRow)}${row.cellCol}` : '';
}

function cellOf(row) {
  return row.cellRow ? [{ row: row.cellRow, col: row.cellCol, item: row }] : [];
}

function rowClass({ row }) {
  if (row.isArchived) return 'row-archived';
  if (row.lowStock) return 'row-low';
  return '';
}
</script>

<style scoped>
.item-table {
  width: 100%;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  overflow: hidden;
}

.item-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.thumb {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 18px;
}

.item-cell__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.35;
}

.item-cell__text strong {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-cell__text small {
  overflow: hidden;
  color: var(--ink-400);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.strong {
  font-weight: 600;
}

.unit {
  margin-left: 3px;
  color: var(--ink-400);
  font-size: 11px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.loc {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.loc__thumb {
  flex-shrink: 0;
  width: 46px;
}

.loc__path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.loc__cell {
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--ink-400);
}

:deep(.row-low) {
  background: rgba(180, 83, 9, 0.045);
}

:deep(.row-archived) {
  opacity: 0.62;
}

:deep(.el-table__row) {
  cursor: pointer;
}
</style>
