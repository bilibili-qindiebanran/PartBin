<template>
  <div class="page">
    <PageHeader title="库存" :subtitle="`共 ${total} 种物料`">
      <template #actions>
        <el-radio-group v-model="view" class="view-switch" size="small">
          <el-radio-button value="table">表格</el-radio-button>
          <el-radio-button value="box">盒视图</el-radio-button>
        </el-radio-group>
        <el-button v-if="auth.canWrite" :icon="Camera" @click="quickInVisible = true">
          快速入库
        </el-button>
        <el-button v-if="auth.canWrite" :icon="Aim" @click="reconcileVisible = true">
          快速对料
        </el-button>
        <el-button
          v-if="auth.canWrite"
          class="btn-create"
          type="primary"
          :icon="Plus"
          @click="openCreate"
        >
          新建物料
        </el-button>
      </template>
    </PageHeader>

    <BinWall
      v-if="view === 'box'"
      ref="binWallRef"
      :can-write="auth.canWrite"
      @open-item="openDetail"
    />

    <template v-else>
    <section class="toolbar card">
      <el-input
        v-model="filters.q"
        class="toolbar__search"
        placeholder="搜索名称 / 型号 / 规格 / 编号"
        clearable
        :prefix-icon="Search"
      />

      <el-tree-select
        v-model="filters.categoryId"
        class="toolbar__select"
        :data="dictionary.categoryOptions"
        check-strictly
        clearable
        filterable
        :render-after-expand="false"
        placeholder="全部分类"
      />

      <el-tree-select
        v-model="filters.locationId"
        class="toolbar__select"
        :data="dictionary.locationOptions"
        check-strictly
        clearable
        filterable
        :render-after-expand="false"
        placeholder="全部位置"
      />

      <el-checkbox v-model="filters.lowStock">只看低库存</el-checkbox>
      <el-checkbox v-model="filters.archived">含归档</el-checkbox>

      <el-select v-model="filters.sort" class="toolbar__sort">
        <el-option label="最近更新" value="-updated_at" />
        <el-option label="名称" value="name" />
        <el-option label="数量从多到少" value="-quantity" />
        <el-option label="编号" value="code" />
      </el-select>

      <el-button text :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
    </section>

    <div v-if="isMobile" v-loading="loading" class="cards">
      <ItemCard
        v-for="item in items"
        :key="item.id"
        :item="item"
        :can-write="auth.canWrite"
        @open="openDetail"
        @edit="openEdit"
        @archive="archiveItem"
        @restore="restoreItem"
        @stock-in="(item) => openMovement(item, 'in')"
        @stock-out="(item) => openMovement(item, 'out')"
      />
    </div>

    <div v-else class="table-wrap">
      <ItemTable
        v-if="items.length > 0 || loading"
        :items="items"
        :loading="loading"
        :can-write="auth.canWrite"
        @open="openDetail"
        @edit="openEdit"
        @archive="archiveItem"
        @restore="restoreItem"
        @stock-in="(item) => openMovement(item, 'in')"
        @stock-out="(item) => openMovement(item, 'out')"
      />
    </div>

    <EmptyState
      v-if="!loading && items.length === 0"
      :title="hasFilters ? '没有匹配的物料' : '还没有物料'"
      :description="
        hasFilters
          ? '换个关键字或清除筛选条件试试。'
          : '把已经有的开发板、模块和元件登记进来，购买前就能先查一下。'
      "
    >
      <template #icon><Box /></template>
      <el-button v-if="hasFilters" @click="resetFilters">清除筛选</el-button>
      <el-button v-else-if="auth.canWrite" type="primary" :icon="Plus" @click="openCreate">
        新建第一个物料
      </el-button>
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
    </template>

    <ItemDialog
      v-model="dialogVisible"
      :item="editingItem"
      :categories="dictionary.categoryOptions"
      :locations="dictionary.locationOptions"
      @saved="handleSaved"
    />

    <MovementDialog
      v-if="movementItem"
      v-model="movementVisible"
      :item="movementItem"
      :default-type="movementType"
      @saved="handleMovementSaved"
    />

    <QuickStockInDialog
      v-model="quickInVisible"
      :locations="dictionary.locationOptions"
      @saved="load"
    />

    <QuickReconcileDialog
      v-model="reconcileVisible"
      :locations="dictionary.locationOptions"
      @saved="load"
    />
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Aim, Box, Camera, Plus, Refresh, Search } from '@element-plus/icons-vue';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import ItemTable from '@/components/ItemTable.vue';
import ItemCard from '@/components/ItemCard.vue';
import BinWall from '@/components/BinWall.vue';
import ItemDialog from '@/components/ItemDialog.vue';
import MovementDialog from '@/components/MovementDialog.vue';

// 扫码依赖 zxing + 二维码解码管线，按需加载，不进首屏包
const QuickStockInDialog = defineAsyncComponent(
  () => import('@/components/QuickStockInDialog.vue'),
);
const QuickReconcileDialog = defineAsyncComponent(
  () => import('@/components/QuickReconcileDialog.vue'),
);
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useAuthStore } from '@/stores/auth';
import { useDictionaryStore } from '@/stores/dictionary';
import { api } from '@/api/client';

const auth = useAuthStore();
const dictionary = useDictionaryStore();
const router = useRouter();
const route = useRoute();
const { isMobile } = useBreakpoint();

const items = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const dialogVisible = ref(false);
const editingItem = ref(null);

const movementVisible = ref(false);
const movementItem = ref(null);
const movementType = ref('in');

const quickInVisible = ref(false);
const reconcileVisible = ref(false);
const binWallRef = ref(null);

const VIEW_KEY = 'partbin:items-view';
const view = ref(localStorage.getItem(VIEW_KEY) === 'box' ? 'box' : 'table');
watch(view, (value) => {
  localStorage.setItem(VIEW_KEY, value);
});

const filters = reactive({
  q: typeof route.query.q === 'string' ? route.query.q : '',
  categoryId: null,
  locationId: null,
  lowStock: false,
  archived: false,
  sort: '-updated_at',
});

let searchTimer = null;

const hasFilters = computed(
  () =>
    Boolean(filters.q.trim()) ||
    filters.categoryId != null ||
    filters.locationId != null ||
    filters.lowStock ||
    filters.archived,
);

async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
      sort: filters.sort,
    });
    if (filters.q.trim()) params.set('q', filters.q.trim());
    if (filters.categoryId != null) params.set('categoryId', String(filters.categoryId));
    if (filters.locationId != null) params.set('locationId', String(filters.locationId));
    if (filters.lowStock) params.set('lowStock', '1');
    if (filters.archived) params.set('archived', '1');

    const data = await api(`/api/items?${params.toString()}`);
    items.value = data.data;
    total.value = data.total;

    if (items.value.length === 0 && page.value > 1) {
      page.value = 1;
      await load();
    }
  } catch (error) {
    ElMessage.error(error.message || '加载库存失败');
  } finally {
    loading.value = false;
  }
}

watch(
  () => filters.q,
  () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      page.value = 1;
      load();
    }, 250);
  },
);

watch(
  [
    () => filters.categoryId,
    () => filters.locationId,
    () => filters.lowStock,
    () => filters.archived,
    () => filters.sort,
  ],
  () => {
    page.value = 1;
    load();
  },
);

watch(
  () => route.query.q,
  (value) => {
    if (typeof value !== 'string') return;
    if (value === filters.q) return;
    // 从仪表盘「查看全部」跳过来时，切到表格视图展示完整结果
    if (value.trim()) view.value = 'table';
    filters.q = value;
  },
);

function resetFilters() {
  filters.q = '';
  filters.categoryId = null;
  filters.locationId = null;
  filters.lowStock = false;
  filters.archived = false;
  filters.sort = '-updated_at';
}

function openCreate() {
  editingItem.value = null;
  dialogVisible.value = true;
}

function openEdit(item) {
  editingItem.value = item;
  dialogVisible.value = true;
}

function openDetail(item) {
  router.push({ name: 'item-detail', params: { id: item.id } });
}
function openMovement(item, type = 'in') {
  movementItem.value = item;
  movementType.value = type;
  movementVisible.value = true;
}

function handleMovementSaved() {
  movementVisible.value = false;
  load();
}

function handleSaved() {
  dialogVisible.value = false;
  load();
  // 盒视图自带数据，保存后同步刷新，避免两个视图数量不一致
  binWallRef.value?.reload();
}

async function archiveItem(item) {
  try {
    await ElMessageBox.confirm(
      `归档后「${item.name}」不会出现在默认列表，但仍保留全部流水。`,
      '归档物料',
      { type: 'warning', confirmButtonText: '归档', cancelButtonText: '取消' },
    );
    await api(`/api/items/${item.id}`, { method: 'DELETE' });
    ElMessage.success('已归档');
    load();
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(error.message || '归档失败');
  }
}

async function restoreItem(item) {
  try {
    await api(`/api/items/${item.id}/restore`, { method: 'POST' });
    ElMessage.success('已恢复');
    load();
  } catch (error) {
    ElMessage.error(error.message || '恢复失败');
  }
}

onMounted(async () => {
  await Promise.allSettled([dictionary.load(), load()]);
});

onBeforeUnmount(() => {
  clearTimeout(searchTimer);
});
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

.toolbar__search {
  flex: 1 1 240px;
  min-width: 200px;
}

.toolbar__select {
  width: 160px;
}

.toolbar__sort {
  width: 150px;
}

.cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 120px;
}

.table-wrap {
  min-height: 120px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-4);
}

@media (max-width: 767px) {
  /* 操作区两列网格：视图切换与「新建物料」同一行，扫码类操作放下一行 */
  :deep(.page-header__actions) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  /* 切换器保持原尺寸，只挪到第一行左侧，不拉伸 */
  :deep(.page-header__actions > .el-radio-group) {
    grid-row: 1;
    grid-column: 1;
    align-self: center;
    justify-self: start;
  }

  :deep(.page-header__actions > .btn-create) {
    grid-row: 1;
    grid-column: 2;
  }

  :deep(.page-header__actions > .el-button:not(.btn-create)) {
    grid-row: 2;
  }

  :deep(.page-header__actions > .el-button) {
    width: 100%;
    margin-left: 0;
  }

  /* 只读账号没有按钮时，切换器占满整行 */
  :deep(.page-header__actions > .el-radio-group:only-child) {
    grid-column: 1 / -1;
  }

  /* 筛选栏同样两列网格，避免宽度不一致的控件拼接后参差不齐 */
  .toolbar {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: center;
    gap: 8px;
  }

  .toolbar__search {
    grid-column: 1 / -1;
  }

  .toolbar__select,
  .toolbar__sort {
    width: 100%;
  }

  .toolbar :deep(.el-checkbox) {
    margin-right: 0;
  }

  .toolbar :deep(.el-button + .el-button) {
    margin-left: 0;
  }

  .pager {
    justify-content: center;
  }

  /* 分页条在窄屏会撑出横向滚动，允许换行 */
  .pager :deep(.el-pagination) {
    flex-wrap: wrap;
    justify-content: center;
    row-gap: 8px;
  }
}
</style>
