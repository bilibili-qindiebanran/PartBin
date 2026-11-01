<template>
  <div class="page">
    <PageHeader title="元件盒" subtitle="按格位查看库存，或按元件反查它所在的盒子与格位。" />

    <section class="toolbar card">
      <el-input
        v-model="itemQuery"
        class="toolbar__search"
        placeholder="搜索元件名称 / 型号 / 编号，定位到格位"
        clearable
        :prefix-icon="Aim"
      />
      <span class="toolbar__hint" v-if="itemQuery.trim()">
        {{ searching ? '搜索中…' : `${itemResults.length} 个匹配元件` }}
      </span>
      <el-button text :icon="Refresh" :loading="boxesLoading || detailLoading" @click="reload">
        刷新
      </el-button>
    </section>

    <div class="bins">
      <aside class="card bins__list">
        <template v-if="itemQuery.trim()">
          <h3 class="bins__title">搜索结果</h3>
          <p v-if="!searching && itemResults.length === 0" class="bins__empty">
            没有匹配的元件。
          </p>
          <button
            v-for="item in itemResults"
            :key="item.id"
            type="button"
            class="result"
            @click="locate(item)"
          >
            <span class="result__main">
              <strong>{{ item.name }}</strong>
              <small>{{ item.model || item.code || '—' }}</small>
            </span>
            <span class="result__where">
              {{ item.locationPath || '未指定位置' }}
              <b v-if="item.cellRow"> · {{ cellLabel(item.cellRow, item.cellCol) }}</b>
            </span>
            <span class="result__qty">{{ item.quantity }}{{ item.unit }}</span>
          </button>
        </template>

        <template v-else>
          <h3 class="bins__title">盒子 <small v-if="boxes.length">（{{ boxes.length }}）</small></h3>
          <p v-if="boxesLoading" class="bins__empty">加载中…</p>
          <p v-else-if="boxes.length === 0" class="bins__empty">
            还没有分类盒。到「设置 → 位置管理」给盒子设置行数与列数。
          </p>
          <button
            v-for="box in boxes"
            :key="box.id"
            type="button"
            class="box-item"
            :class="{ 'is-active': box.id === selectedId }"
            @click="openBox(box.id)"
          >
            <span class="box-item__main">
              <strong>{{ box.name }}</strong>
              <small>{{ box.path }}</small>
            </span>
            <span class="box-item__meta">
              <el-tag v-if="box.isGrid" size="small" type="info" effect="plain">
                {{ box.gridRows }}×{{ box.gridCols }}
              </el-tag>
              <span class="box-item__count">{{ box.itemCount }}</span>
            </span>
          </button>
        </template>
      </aside>

      <section v-loading="detailLoading" class="card bins__panel">
        <template v-if="detail">
          <header class="panel-head">
            <div>
              <h2>{{ detail.box.path }}</h2>
              <p class="panel-head__sub">
                <template v-if="detail.box.isGrid">
                  分类盒 · {{ detail.box.gridRows }} 行 × {{ detail.box.gridCols }} 列
                  <span class="dot">·</span> 已用 {{ detail.cells.length }} / {{ detail.box.capacity }}
                </template>
                <template v-else>大盒 · 混装 {{ detail.items.length }} 种元件</template>
                <span v-if="detail.box.code" class="dot">·</span>
                <span v-if="detail.box.code">{{ detail.box.code }}</span>
              </p>
            </div>
            <el-tag v-if="!detail.box.isGrid" size="small" effect="plain">无格位</el-tag>
          </header>

          <div v-if="detail.box.isGrid" class="grid-scroll">
            <div class="grid" :style="{ '--cols': detail.box.gridCols }">
              <span class="grid__corner" />
              <span v-for="col in detail.box.gridCols" :key="`h${col}`" class="grid__head">
                {{ col }}
              </span>

              <template v-for="row in detail.box.gridRows" :key="`r${row}`">
                <span class="grid__head grid__head--row">{{ rowLetter(row) }}</span>
                <button
                  v-for="col in detail.box.gridCols"
                  :key="`c${row}-${col}`"
                  :id="`cell-${row}-${col}`"
                  type="button"
                  class="cell"
                  :class="{
                    'is-filled': cellItem(row, col),
                    'is-highlight':
                      highlight && highlight.row === row && highlight.col === col,
                  }"
                  :title="cellTitle(row, col)"
                  @click="onCellClick(row, col)"
                >
                  <template v-if="cellItem(row, col)">
                    <span class="cell__name">{{ cellItem(row, col).name }}</span>
                    <span class="cell__qty">
                      {{ cellItem(row, col).quantity }}{{ cellItem(row, col).unit }}
                    </span>
                  </template>
                  <span v-else class="cell__empty">+</span>
                </button>
              </template>
            </div>
          </div>

          <div v-else class="loose">
            <p v-if="detail.items.length === 0" class="bins__empty">这个盒子里还没有元件。</p>
            <button
              v-for="item in detail.items"
              :key="item.id"
              type="button"
              class="loose__item"
              @click="openItem(item)"
            >
              <strong>{{ item.name }}</strong>
              <small>{{ item.model || item.spec || item.code || '—' }}</small>
              <span>{{ item.quantity }}{{ item.unit }}</span>
            </button>
          </div>

          <div v-if="detail.box.isGrid && detail.unassigned.length" class="unassigned">
            <h3 class="unassigned__title">未归位（{{ detail.unassigned.length }}）</h3>
            <div class="unassigned__chips">
              <button
                v-for="item in detail.unassigned"
                :key="item.id"
                type="button"
                class="chip"
                @click="promptCellFor(item)"
              >
                {{ item.name }} · {{ item.quantity }}{{ item.unit }}
              </button>
            </div>
          </div>

          <div v-if="detail.children.length" class="children">
            <h3 class="unassigned__title">子位置</h3>
            <div class="unassigned__chips">
              <button
                v-for="child in detail.children"
                :key="child.id"
                type="button"
                class="chip chip--link"
                @click="openBox(child.id)"
              >
                {{ child.name }}<template v-if="child.isGrid"> · 分类盒</template>
                · {{ child.itemCount }}
              </button>
            </div>
          </div>
        </template>

        <div v-else class="bins__empty bins__empty--panel">
          <el-icon class="bins__empty-icon"><Grid /></el-icon>
          <p>从左侧选择一个盒子。</p>
        </div>
      </section>
    </div>

    <el-dialog
      v-model="assign.visible"
      :title="assign.itemFixed ? '放入格位' : '选择一个元件放入格位'"
      width="min(440px, 92vw)"
      align-center
      destroy-on-close
    >
      <div class="stack">
        <label class="field">
          <span>元件</span>
          <el-select
            v-model="assign.itemId"
            filterable
            remote
            :remote-method="searchCandidates"
            :loading="assign.loading"
            :disabled="assign.itemFixed"
            placeholder="输入名称 / 型号 / 编号搜索"
            class="full-control"
          >
            <el-option
              v-for="option in assign.candidates"
              :key="option.id"
              :label="`${option.name}${option.model ? ` · ${option.model}` : ''}`"
              :value="option.id"
            />
          </el-select>
        </label>
        <div class="assign-row">
          <label class="field">
            <span>行（1–{{ detail?.box.gridRows ?? 0 }}）</span>
            <el-input-number
              v-model="assign.row"
              :min="1"
              :max="detail?.box.gridRows ?? 1"
              controls-position="right"
              class="full-control"
            />
          </label>
          <label class="field">
            <span>列（1–{{ detail?.box.gridCols ?? 0 }}）</span>
            <el-input-number
              v-model="assign.col"
              :min="1"
              :max="detail?.box.gridCols ?? 1"
              controls-position="right"
              class="full-control"
            />
          </label>
        </div>
        <p class="hint">把一个元件放进某格；该元件原有的位置会被覆盖。</p>
      </div>
      <template #footer>
        <el-button @click="assign.visible = false">取消</el-button>
        <el-button type="primary" :loading="assign.saving" @click="saveAssign">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Aim, Grid, Refresh } from '@element-plus/icons-vue';
import PageHeader from '@/components/PageHeader.vue';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const boxes = ref([]);
const boxesLoading = ref(false);
const selectedId = ref(null);
const detail = ref(null);
const detailLoading = ref(false);
const highlight = ref(null);

const itemQuery = ref('');
const itemResults = ref([]);
const searching = ref(false);
let searchTimer = null;
let candidateTimer = null;

const assign = reactive({
  visible: false,
  itemFixed: false,
  itemId: null,
  row: 1,
  col: 1,
  candidates: [],
  loading: false,
  saving: false,
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

function cellLabel(row, col) {
  if (row == null || col == null) return '';
  return `${rowLetter(row)}${col}`;
}

function cellItem(row, col) {
  return detail.value?.cells.find((cell) => cell.row === row && cell.col === col)?.item ?? null;
}

function cellTitle(row, col) {
  const item = cellItem(row, col);
  if (!item) return '空位';
  return `${item.name} · ${item.quantity}${item.unit}`;
}

async function loadBoxes(keyword = '') {
  boxesLoading.value = true;
  try {
    const query = keyword ? `?q=${encodeURIComponent(keyword)}` : '';
    boxes.value = (await api(`/api/bins${query}`)).data;
  } catch (error) {
    ElMessage.error(error.message || '加载元件盒失败');
  } finally {
    boxesLoading.value = false;
  }
}

async function openBox(id, focus = null) {
  selectedId.value = id;
  detailLoading.value = true;
  try {
    detail.value = await api(`/api/bins/${id}`);
    highlight.value = focus;
    if (focus) {
      await nextTick();
      document
        .getElementById(`cell-${focus.row}-${focus.col}`)
        ?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    }
  } catch (error) {
    ElMessage.error(error.message || '加载盒子失败');
  } finally {
    detailLoading.value = false;
  }
}

async function reload() {
  await loadBoxes();
  if (selectedId.value) await openBox(selectedId.value);
}

async function locate(item) {
  if (!item.locationId) {
    ElMessage.info('这个元件还没有指定位置');
    return;
  }
  itemQuery.value = '';
  itemResults.value = [];
  await openBox(item.locationId, { row: item.cellRow, col: item.cellCol });
}

function openItem(item) {
  router.push({ name: 'item-detail', params: { id: item.id } });
}

function onCellClick(row, col) {
  const item = cellItem(row, col);
  if (item) {
    openItem(item);
    return;
  }
  if (!auth.canWrite) return;
  assign.visible = true;
  assign.itemFixed = false;
  assign.itemId = null;
  assign.row = row;
  assign.col = col;
  assign.candidates = [];
  searchCandidates('');
}

function promptCellFor(item) {
  if (!auth.canWrite) {
    openItem(item);
    return;
  }
  assign.visible = true;
  assign.itemFixed = true;
  assign.itemId = item.id;
  assign.candidates = [{ id: item.id, name: item.name, model: item.model }];
  assign.row = 1;
  assign.col = 1;
}

async function searchCandidates(keyword) {
  if (!auth.canWrite) return;
  assign.loading = true;
  if (candidateTimer) clearTimeout(candidateTimer);
  candidateTimer = setTimeout(async () => {
    try {
      const params = new URLSearchParams({ pageSize: '30', sort: 'name' });
      if (keyword?.trim()) params.set('q', keyword.trim());
      assign.candidates = (await api(`/api/items?${params.toString()}`)).data;
    } catch {
      assign.candidates = [];
    } finally {
      assign.loading = false;
    }
  }, 220);
}

async function saveAssign() {
  if (!assign.itemId) {
    ElMessage.warning('请选择一个元件');
    return;
  }
  if (!detail.value?.box.id) return;

  assign.saving = true;
  try {
    await api(`/api/items/${assign.itemId}`, {
      method: 'PATCH',
      body: {
        locationId: detail.value.box.id,
        cellRow: assign.row,
        cellCol: assign.col,
      },
    });
    ElMessage.success('已放入格位');
    assign.visible = false;
    await Promise.all([openBox(detail.value.box.id, { row: assign.row, col: assign.col }), loadBoxes()]);
  } catch (error) {
    ElMessage.error(error.message || '放入失败');
  } finally {
    assign.saving = false;
  }
}

watch(itemQuery, (value) => {
  if (searchTimer) clearTimeout(searchTimer);
  const keyword = value.trim();
  if (!keyword) {
    itemResults.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  searchTimer = setTimeout(async () => {
    try {
      const params = new URLSearchParams({ q: keyword, pageSize: '20' });
      itemResults.value = (await api(`/api/items?${params.toString()}`)).data;
    } catch {
      itemResults.value = [];
    } finally {
      searching.value = false;
    }
  }, 260);
});

onMounted(async () => {
  await loadBoxes();
  openFromQuery();
});

watch(
  () => route.query.id,
  () => openFromQuery(),
);

async function openFromQuery() {
  const wanted = Number(route.query.id);
  const target = Number.isInteger(wanted)
    ? boxes.value.find((box) => box.id === wanted)
    : null;
  const next = target ?? boxes.value[0];
  if (next) await openBox(next.id);
}

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
  if (candidateTimer) clearTimeout(candidateTimer);
});
</script>

<style scoped>
.bins {
  display: grid;
  grid-template-columns: minmax(200px, 260px) minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
}

.bins__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: calc(100dvh - 240px);
  overflow-y: auto;
  padding: var(--space-3);
}

.bins__title {
  margin: 2px 4px 8px;
  color: var(--ink-600);
  font-size: 12px;
  font-weight: 600;
}

.bins__title small {
  color: var(--ink-400);
  font-weight: 400;
}

.bins__empty {
  padding: var(--space-3) 6px;
  color: var(--ink-400);
  font-size: 13px;
  line-height: 1.6;
}

.bins__empty--panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 240px;
  font-size: 13px;
}

.bins__empty-icon {
  font-size: 28px;
  color: var(--ink-300, #b6c4c4);
}

.box-item,
.result,
.loose__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--ink-900);
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}

.box-item:hover,
.result:hover,
.loose__item:hover {
  background: var(--surface-2, #f3f7f7);
}

.box-item.is-active {
  border-color: var(--primary);
  background: rgba(10, 122, 122, 0.08);
}

.box-item__main,
.result__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}

.box-item__main strong,
.result__main strong,
.loose__item strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.box-item__main small,
.result__main small {
  overflow: hidden;
  color: var(--ink-400);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.box-item__meta {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
}

.box-item__count,
.result__qty {
  color: var(--ink-500);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.result {
  flex-wrap: wrap;
  align-items: flex-start;
}

.result__where {
  flex-basis: 100%;
  color: var(--ink-500);
  font-size: 11px;
}

.result__where b {
  color: var(--primary);
}

.bins__panel {
  min-height: 320px;
  padding: var(--space-4);
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.panel-head h2 {
  font-size: 16px;
  font-weight: 600;
}

.panel-head__sub {
  margin-top: 4px;
  color: var(--ink-500);
  font-size: 12px;
}

.dot {
  margin: 0 4px;
  color: var(--ink-300, #b6c4c4);
}

.grid-scroll {
  overflow-x: auto;
  padding-bottom: 4px;
}

.grid {
  display: grid;
  grid-template-columns: 28px repeat(var(--cols), minmax(62px, 1fr));
  gap: 6px;
  min-width: calc(28px + var(--cols) * 68px);
}

.grid__corner {
  display: block;
}

.grid__head {
  display: grid;
  place-items: center;
  color: var(--ink-400);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.grid__head--row {
  font-weight: 600;
}

.cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 58px;
  padding: 4px;
  border: 1px dashed var(--line);
  border-radius: var(--r-sm);
  background: #fbfdfd;
  color: var(--ink-500);
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}

.cell:hover {
  border-color: var(--primary);
  background: rgba(10, 122, 122, 0.06);
}

.cell.is-filled {
  border-style: solid;
  background: #fff;
}

.cell.is-highlight {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(10, 122, 122, 0.35);
  background: rgba(10, 122, 122, 0.1);
}

.cell__name {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ink-900);
  font-size: 11px;
  line-height: 1.3;
  text-align: center;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  word-break: break-all;
}

.cell__qty {
  color: var(--primary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.cell__empty {
  color: var(--ink-300, #b6c4c4);
  font-size: 14px;
}

.loose {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.loose__item {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  border: 1px solid var(--line);
  background: #fbfdfd;
}

.loose__item small {
  color: var(--ink-400);
  font-size: 11px;
}

.loose__item span {
  color: var(--primary);
  font-size: 12px;
}

.unassigned,
.children {
  margin-top: var(--space-4);
}

.unassigned__title {
  margin-bottom: 8px;
  color: var(--ink-600);
  font-size: 12px;
  font-weight: 600;
}

.unassigned__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  padding: 5px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #fff;
  color: var(--ink-700);
  font-size: 12px;
  cursor: pointer;
}

.chip:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.chip--link {
  background: rgba(10, 122, 122, 0.06);
}

.assign-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.hint {
  margin-top: 8px;
  color: var(--ink-400);
  font-size: 12px;
}

@media (max-width: 860px) {
  .bins {
    grid-template-columns: minmax(0, 1fr);
  }

  .bins__list {
    max-height: 220px;
  }
}
</style>
