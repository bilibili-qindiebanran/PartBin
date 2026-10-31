<template>
  <div v-loading="loading" class="wall">
    <section class="card wall__bar">
      <el-input
        v-model="keyword"
        class="wall__search"
        placeholder="搜索名称 / 型号 / 规格 / 编号，只看含该元件的盒"
        clearable
        :prefix-icon="Search"
      />
      <span v-if="keyword.trim()" class="wall__count">
        {{ searching ? '搜索中…' : `命中 ${visibleBoxes.length} 个盒` }}
      </span>
    </section>

    <p v-if="canWrite && !keyword.trim()" class="wall__hint">
      拖动盒子可以调整顺序；点击格子进入元件，点击盒名打开盒页面。
    </p>

    <EmptyState
      v-if="!loading && visibleBoxes.length === 0"
      :title="keyword.trim() ? '没有匹配的盒子' : '还没有元件盒'"
      :description="
        keyword.trim()
          ? '换个关键字，或到表格视图里按条件筛选。'
          : '到「设置 → 位置管理」给盒子设置行列数，或先登记一些物料。'
      "
    >
      <template #icon><Box /></template>
    </EmptyState>

    <div v-else class="wall__grid" :class="{ 'is-dragging': dragIndex !== null }">
      <article
        v-for="(box, index) in visibleBoxes"
        :key="box.id"
        class="tile card"
        :class="{
          'is-dragging': dragIndex === index,
          'is-over': overIndex === index && dragIndex !== index,
        }"
        :draggable="canWrite && !keyword.trim()"
        @dragstart="onDragStart(index, $event)"
        @dragover.prevent="onDragOver(index)"
        @dragleave="onDragLeave(index)"
        @drop.prevent="onDrop(index)"
        @dragend="onDragEnd"
      >
        <header class="tile__head" @click="openBox(box)">
          <div class="tile__title">
            <strong>{{ box.name }}</strong>
            <small>{{ box.path }}</small>
          </div>
          <el-tag v-if="box.isGrid" size="small" type="info" effect="plain">
            {{ box.gridRows }}×{{ box.gridCols }}
          </el-tag>
          <el-tag v-else size="small" effect="plain">{{ box.kindCount }} 种</el-tag>
        </header>

        <div v-if="box.isGrid" class="tile__body" @click="openBox(box)">
          <BinThumb
            size="md"
            show-letter
            interactive
            :rows="box.gridRows"
            :cols="box.gridCols"
            :cells="box.cells"
            @cell-click="onCellClick(box, $event)"
          />
          <footer class="tile__foot">
            <span v-if="keyword.trim()" class="tile__hit">命中 {{ box.matchCount }} 处</span>
            <span v-else>{{ box.cells.length }} / {{ box.capacity }} 格已用</span>
            <span v-if="!keyword.trim() && box.itemCount - box.cells.length > 0" class="tile__warn">
              {{ box.itemCount - box.cells.length }} 未归位
            </span>
          </footer>
        </div>

        <el-popover
          v-else
          placement="bottom"
          :width="240"
          trigger="hover"
          :show-after="120"
          popper-class="bin-wall-popover"
        >
          <template #reference>
            <div class="tile__bag" @click="openBox(box)">
              <el-icon class="tile__bag-icon"><Files /></el-icon>
              <strong>{{ keyword.trim() ? box.matchCount : box.kindCount }}</strong>
              <span>{{ keyword.trim() ? '处命中' : '种元件' }}</span>
            </div>
          </template>
          <ul class="bag-list">
            <li v-for="item in box.items" :key="item.id" @click="openItem(item)">
              <strong>{{ item.name }}</strong>
              <span>{{ item.quantity }}{{ item.unit }}</span>
            </li>
            <li v-if="!keyword.trim() && box.kindCount > box.items.length" class="bag-list__more">
              还有 {{ box.kindCount - box.items.length }} 种…
            </li>
          </ul>
        </el-popover>
      </article>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Box, Files, Search } from '@element-plus/icons-vue';
import EmptyState from '@/components/EmptyState.vue';
import BinThumb from '@/components/BinThumb.vue';
import { api } from '@/api/client';

const props = defineProps({
  canWrite: { type: Boolean, default: false },
});

const emit = defineEmits(['open-item']);

const router = useRouter();
const boxes = ref([]);
const loading = ref(false);
const dragIndex = ref(null);
const overIndex = ref(null);

const keyword = ref('');
const matchedIds = ref(new Set());
const matchedItems = ref([]);
const searching = ref(false);
let searchTimer = null;

/** 搜索时只保留含匹配元件的盒子，并给命中格打上 match 标记 */
const visibleBoxes = computed(() => {
  const term = keyword.value.trim();
  if (!term) {
    return boxes.value.map((box) => ({ ...box, matchCount: 0 }));
  }

  const ids = matchedIds.value;
  const byLocation = new Map();
  for (const item of matchedItems.value) {
    if (item.locationId == null) continue;
    const list = byLocation.get(item.locationId) ?? [];
    list.push(item);
    byLocation.set(item.locationId, list);
  }

  return boxes.value
    .map((box) => {
      const hits = byLocation.get(box.id) ?? [];
      if (box.isGrid) {
        const cells = box.cells.map((cell) => ({
          ...cell,
          match: ids.has(cell.item.id),
        }));
        return {
          ...box,
          cells,
          matchCount: cells.filter((cell) => cell.match).length,
        };
      }
      return {
        ...box,
        items: hits,
        matchCount: hits.length,
      };
    })
    .filter((box) => box.matchCount > 0);
});

async function runSearch(term) {
  if (!term) {
    matchedIds.value = new Set();
    matchedItems.value = [];
    searching.value = false;
    return;
  }

  searching.value = true;
  try {
    const params = new URLSearchParams({ q: term, pageSize: '100' });
    const data = await api(`/api/items?${params.toString()}`);
    matchedItems.value = data.data;
    matchedIds.value = new Set(data.data.map((item) => item.id));
  } catch (error) {
    matchedIds.value = new Set();
    matchedItems.value = [];
    ElMessage.error(error.message || '搜索失败');
  } finally {
    searching.value = false;
  }
}

watch(keyword, (value) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(value.trim()), 250);
});

async function load() {
  loading.value = true;
  try {
    boxes.value = (await api('/api/bins/overview')).data;
  } catch (error) {
    ElMessage.error(error.message || '加载元件盒失败');
  } finally {
    loading.value = false;
  }
}

function openBox(box) {
  router.push({ name: 'bins', query: { id: String(box.id) } });
}

function openItem(item) {
  emit('open-item', item);
}

function onCellClick(box, cell) {
  if (cell?.item) openItem(cell.item);
  else openBox(box);
}

function onDragStart(index, event) {
  if (!props.canWrite || keyword.value.trim()) return;
  dragIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(visibleBoxes.value[index]?.id ?? ''));
  }
}

function onDragOver(index) {
  if (!props.canWrite || dragIndex.value === null) return;
  overIndex.value = index;
}

function onDragLeave(index) {
  if (overIndex.value === index) overIndex.value = null;
}

async function onDrop(index) {
  if (!props.canWrite || dragIndex.value === null || keyword.value.trim()) return;
  const from = dragIndex.value;
  overIndex.value = null;
  dragIndex.value = null;
  if (from === index) return;

  const next = [...boxes.value];
  const [moved] = next.splice(from, 1);
  next.splice(index, 0, moved);
  boxes.value = next;

  try {
    await api('/api/bins/reorder', {
      method: 'POST',
      body: { ids: next.map((box) => box.id) },
    });
    ElMessage.success('顺序已保存');
  } catch (error) {
    ElMessage.error(error.message || '排序保存失败');
    await load();
  }
}

function onDragEnd() {
  dragIndex.value = null;
  overIndex.value = null;
}

onMounted(load);

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<style scoped>
.wall__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: var(--space-3);
  padding: 12px;
}

.wall__search {
  flex: 1 1 240px;
  min-width: 0;
}

.wall__count {
  flex-shrink: 0;
  color: var(--ink-500);
  font-size: 12px;
}

.wall__hint {
  margin-bottom: var(--space-3);
  color: var(--ink-400);
  font-size: 12px;
}

.wall__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: var(--space-3);
}

.tile {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  transition:
    transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.tile[draggable='true'] {
  cursor: grab;
}

.tile.is-dragging {
  opacity: 0.45;
}

.tile.is-over {
  transform: translateY(-2px);
  box-shadow: 0 0 0 2px var(--primary);
}

.tile__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
}

.tile__title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.tile__title strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tile__title small {
  overflow: hidden;
  color: var(--ink-400);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tile__body {
  cursor: pointer;
}

.tile__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  color: var(--ink-400);
  font-size: 11px;
}

.tile__warn {
  color: var(--warning);
}

.tile__hit {
  color: var(--primary);
  font-weight: 600;
}

.tile__bag {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
  height: 92px;
  border: 1px dashed var(--line);
  border-radius: var(--r-md);
  background: rgba(10, 122, 122, 0.05);
  color: var(--ink-600);
  font-size: 12px;
  cursor: pointer;
}

.tile__bag strong {
  color: var(--primary);
  font-size: 26px;
  font-variant-numeric: tabular-nums;
}

.tile__bag-icon {
  align-self: center;
  color: var(--primary);
  font-size: 20px;
}

.bag-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bag-list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 2px;
  font-size: 12px;
  cursor: pointer;
}

.bag-list li:hover {
  background: var(--primary-soft);
}

.bag-list li strong {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bag-list li span {
  flex-shrink: 0;
  color: var(--ink-500);
  font-variant-numeric: tabular-nums;
}

.bag-list__more {
  color: var(--ink-400);
  font-size: 11px;
  cursor: default !important;
}

@media (max-width: 767px) {
  .wall__grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }
}
</style>
