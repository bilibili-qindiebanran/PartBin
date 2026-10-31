<template>
  <div class="item-table-wrap">
    <el-table
      v-loading="loading"
      :data="items"
      :row-class-name="rowClass"
      class="item-table"
      empty-text="还没有物料"
      @row-click="(row) => emit('open', row)"
      @row-contextmenu="onContextMenu"
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
    </el-table>

    <p class="item-table__hint">
      点击行查看详情{{ canWrite ? '，右键可入库、出库、编辑或归档' : '' }}。
    </p>

    <Teleport to="body">
      <ul
        v-if="menu.visible"
        class="ctx"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        role="menu"
        aria-label="物料操作"
      >
        <li role="menuitem" class="ctx__item" @click="run('open')">
          <el-icon><View /></el-icon>打开详情
        </li>
        <template v-if="canWrite">
          <li class="ctx__sep" aria-hidden="true" />
          <li role="menuitem" class="ctx__item" @click="run('stock-in')">
            <el-icon><Bottom /></el-icon>入库
          </li>
          <li role="menuitem" class="ctx__item" @click="run('stock-out')">
            <el-icon><Top /></el-icon>出库
          </li>
          <li role="menuitem" class="ctx__item" @click="run('edit')">
            <el-icon><EditPen /></el-icon>编辑
          </li>
          <li class="ctx__sep" aria-hidden="true" />
          <li
            v-if="menu.row?.isArchived"
            role="menuitem"
            class="ctx__item"
            @click="run('restore')"
          >
            <el-icon><RefreshLeft /></el-icon>恢复归档
          </li>
          <li v-else role="menuitem" class="ctx__item ctx__item--danger" @click="run('archive')">
            <el-icon><Delete /></el-icon>归档
          </li>
        </template>
      </ul>
    </Teleport>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive } from 'vue';
import {
  Bottom,
  Box,
  Delete,
  EditPen,
  RefreshLeft,
  Top,
  View,
} from '@element-plus/icons-vue';
import BinThumb from '@/components/BinThumb.vue';
import { formatDate } from '@/lib/format';

defineProps({
  items: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  canWrite: { type: Boolean, default: false },
});

const emit = defineEmits(['open', 'edit', 'archive', 'restore', 'stock-in', 'stock-out']);

const MENU_WIDTH = 168;
const MENU_HEIGHT = 240;

const menu = reactive({
  visible: false,
  x: 0,
  y: 0,
  row: null,
});

function closeMenu() {
  menu.visible = false;
  menu.row = null;
}

function onContextMenu(row, column, event) {
  event?.preventDefault?.();
  if (!row) return;

  const x = Math.min(event.clientX, window.innerWidth - MENU_WIDTH - 8);
  const y = Math.min(event.clientY, window.innerHeight - MENU_HEIGHT - 8);
  menu.row = row;
  menu.x = Math.max(8, x);
  menu.y = Math.max(8, y);
  menu.visible = true;
}

function run(action) {
  const row = menu.row;
  closeMenu();
  if (row) emit(action, row);
}

function onGlobalPointer(event) {
  if (!menu.visible) return;
  if (event.target?.closest?.('.ctx')) return;
  closeMenu();
}

function onKeydown(event) {
  if (event.key === 'Escape') closeMenu();
}

onMounted(() => {
  window.addEventListener('click', onGlobalPointer, true);
  window.addEventListener('contextmenu', onGlobalPointer, true);
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('scroll', closeMenu, true);
  window.addEventListener('resize', closeMenu);
});

onBeforeUnmount(() => {
  window.removeEventListener('click', onGlobalPointer, true);
  window.removeEventListener('contextmenu', onGlobalPointer, true);
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('scroll', closeMenu, true);
  window.removeEventListener('resize', closeMenu);
});

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
.item-table-wrap {
  position: relative;
}

.item-table {
  width: 100%;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  overflow: hidden;
}

.item-table__hint {
  margin-top: 8px;
  padding-left: 2px;
  color: var(--ink-400);
  font-size: 12px;
}

.ctx {
  position: fixed;
  z-index: 3000;
  min-width: 168px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-elevated);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
}

.ctx__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  color: var(--ink-900);
  font-size: 13px;
  cursor: pointer;
}

.ctx__item .el-icon {
  color: var(--ink-500);
  font-size: 14px;
}

.ctx__item:hover {
  background: var(--primary-soft);
  color: var(--primary);
}

.ctx__item:hover .el-icon {
  color: var(--primary);
}

.ctx__item--danger {
  color: var(--danger, #c0392b);
}

.ctx__item--danger .el-icon {
  color: var(--danger, #c0392b);
}

.ctx__item--danger:hover {
  background: rgba(192, 57, 43, 0.08);
  color: var(--danger, #c0392b);
}

.ctx__item--danger:hover .el-icon {
  color: var(--danger, #c0392b);
}

.ctx__sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--line);
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
