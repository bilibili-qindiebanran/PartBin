<template>
  <div class="page">
    <PageHeader
      title="BOM 对应关系"
      subtitle="人工确认过的「BOM 行 → 物料」对应。匹配时优先于自动识别，可随时撤销。"
    >
      <template #actions>
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button
          v-if="canWrite && selection.length > 0"
          type="danger"
          plain
          :icon="Delete"
          @click="removeSelected"
        >
          删除所选（{{ selection.length }}）
        </el-button>
      </template>
    </PageHeader>

    <section class="card filters">
      <el-input
        v-model="filters.q"
        placeholder="搜索 BOM 键或物料名称"
        clearable
        :prefix-icon="Search"
        class="filters__search"
      />
      <el-select
        v-model="filters.kind"
        class="filters__kind"
        placeholder="全部匹配方式"
        clearable
      >
        <el-option v-for="entry in KIND_OPTIONS" :key="entry.value" :label="entry.label" :value="entry.value" />
      </el-select>
      <el-checkbox v-model="filters.onlySkip">只看已接受差异</el-checkbox>
      <el-checkbox v-model="filters.onlyArchived">只看归档物料</el-checkbox>
    </section>

    <section class="card panel">
      <div class="panel__head">
        <div>
          <h3>共 {{ aliases.length }} 条</h3>
          <p class="panel__sub">
            匹配顺序：人工对应优先于立创料号 / 厂家料号 / 值+封装 / 名称。
          </p>
        </div>
        <span class="muted">{{ filtered.length }} 条符合筛选</span>
      </div>

      <div v-loading="loading" class="table-wrap">
        <el-table
          :data="filtered"
          row-key="id"
          empty-text="还没有人工对应关系"
          @selection-change="onSelectionChange"
        >
          <el-table-column v-if="canWrite" type="selection" width="44" />
          <el-table-column label="BOM 键" min-width="230">
            <template #default="{ row }">
              <div class="cell-main">
                <el-tag size="small" effect="plain" :type="kindTagType(row.kind)">
                  {{ kindLabel(row.kind) }}
                </el-tag>
                <strong class="cell-subject">{{ keySubject(row) }}</strong>
                <small class="cell-raw">{{ row.matchKey }}</small>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="对应物料" min-width="240">
            <template #default="{ row }">
              <div class="cell-main">
                <router-link v-if="row.itemId" :to="`/items/${row.itemId}`" class="cell-link">
                  {{ row.itemName ?? '（物料已删除）' }}
                </router-link>
                <span v-else class="muted">—</span>
                <small>
                  <template v-if="row.itemPackage">{{ row.itemPackage }}</template>
                  <template v-if="row.itemQuantity != null"> · 库存 {{ row.itemQuantity }}</template>
                  <el-tag v-if="row.itemArchived" size="small" type="info" effect="plain">归档</el-tag>
                </small>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="封装/耐压校验" width="132" align="center">
            <template #default="{ row }">
              <el-switch
                :model-value="row.skipParams"
                :disabled="!canWrite || saving"
                inline-prompt
                active-text="忽略"
                inactive-text="校验"
                @change="(value) => toggleSkip(row, value)"
              />
            </template>
          </el-table-column>
          <el-table-column label="备注" min-width="150">
            <template #default="{ row }">
              <span v-if="row.note" class="cell-note">{{ row.note }}</span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="记录" width="150">
            <template #default="{ row }">
              <div class="cell-main">
                <small>{{ formatDate(row.updatedAt) }}</small>
                <small v-if="row.createdBy">{{ row.createdBy }}</small>
              </div>
            </template>
          </el-table-column>
          <el-table-column v-if="canWrite" label="操作" width="150" align="right">
            <template #default="{ row }">
              <el-button link size="small" @click="openRebind(row)">改绑</el-button>
              <el-button link size="small" @click="openNote(row)">备注</el-button>
              <el-button link size="small" type="danger" @click="removeOne(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>

    <el-dialog v-model="rebind.open" title="改绑物料" width="720px" append-to-body>
      <p class="hint">
        BOM 键：<code>{{ rebind.row?.matchKey }}</code>
      </p>
      <div class="rebind__search">
        <el-input v-model="rebind.q" placeholder="搜索名称 / 型号 / 立创料号" clearable @input="searchItems" />
        <el-checkbox v-model="rebind.withArchived" @change="searchItems">含归档</el-checkbox>
      </div>
      <el-table
        :data="rebind.items"
        height="300"
        highlight-current-row
        @current-change="(item) => item && (rebind.selected = item)"
      >
        <el-table-column prop="name" label="名称" min-width="220" />
        <el-table-column prop="package" label="封装" width="110" />
        <el-table-column prop="quantity" label="库存" width="76" align="right" />
        <el-table-column prop="locationPath" label="位置" min-width="130" />
        <el-table-column prop="lcscCode" label="立创" width="100" />
      </el-table>
      <template #footer>
        <el-button @click="rebind.open = false">取消</el-button>
        <el-button type="primary" :disabled="!rebind.selected" :loading="saving" @click="confirmRebind">
          保存
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="note.open" title="编辑备注" width="480px" append-to-body>
      <p class="hint">
        BOM 键：<code>{{ note.row?.matchKey }}</code>
      </p>
      <el-input
        v-model="note.text"
        type="textarea"
        :rows="3"
        maxlength="200"
        show-word-limit
        placeholder="例如：40KΩ 与库内 0603 40K 为同一物料（同一批采购）"
      />
      <template #footer>
        <el-button @click="note.open = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="confirmNote">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Delete, Refresh, Search } from '@element-plus/icons-vue';
import PageHeader from '@/components/PageHeader.vue';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

const KIND_OPTIONS = [
  { value: 'lcsc', label: '立创料号' },
  { value: 'mpn', label: '厂家料号' },
  { value: 'val', label: '值 + 封装' },
  { value: 'name', label: '名称' },
  { value: 'key', label: '整行' },
  { value: 'manual', label: '手动' },
];

const KIND_LABELS = Object.fromEntries(KIND_OPTIONS.map((entry) => [entry.value, entry.label]));

const auth = useAuthStore();
const canWrite = computed(() => auth.canWrite);

const loading = ref(false);
const saving = ref(false);
const aliases = ref([]);
const selection = ref([]);

const filters = reactive({ q: '', kind: '', onlySkip: false, onlyArchived: false });

const rebind = reactive({ open: false, row: null, q: '', withArchived: false, items: [], selected: null });
const note = reactive({ open: false, row: null, text: '' });

const filtered = computed(() => {
  const keyword = filters.q.trim().toLowerCase();
  return aliases.value.filter((row) => {
    if (filters.kind && row.kind !== filters.kind) return false;
    if (filters.onlySkip && !row.skipParams) return false;
    if (filters.onlyArchived && !row.itemArchived) return false;
    if (!keyword) return true;
    return (
      row.matchKey.toLowerCase().includes(keyword) ||
      String(row.itemName ?? '').toLowerCase().includes(keyword) ||
      String(row.note ?? '').toLowerCase().includes(keyword)
    );
  });
});

function kindLabel(kind) {
  return KIND_LABELS[kind] ?? kind ?? '—';
}

function kindTagType(kind) {
  return { lcsc: 'success', mpn: 'success', val: 'warning', name: 'info' }[kind] ?? 'info';
}

/** matchKey 冒号后的部分，值类键再还原成 10pF / 40kΩ 这样的读数 */
function keySubject(row) {
  const raw = String(row.matchKey ?? '');
  const colon = raw.indexOf(':');
  const subject = colon >= 0 ? raw.slice(colon + 1) : raw;
  if (row.kind !== 'val') return subject;

  const [pkg, suffix] = subject.split('|');
  const readable = formatValue(suffix);
  return readable ? `${pkg} ${readable}` : subject;
}

function round3(value) {
  return Number(Number(value).toPrecision(3));
}

/** c:1e-11 → 10pF，r:40000 → 40kΩ，h:2.4e-8 → 24nH，hz:8000000 → 8MHz */
function formatValue(suffix) {
  if (!suffix) return '';
  const [kind, raw] = String(suffix).split(':');
  const base = Number(raw);
  if (!Number.isFinite(base) || base === 0) return '';

  const pick = (units) => {
    for (const [scale, unit] of units) {
      if (base >= scale) return `${round3(base / scale)}${unit}`;
    }
    return `${round3(base)}${units[units.length - 1][1]}`;
  };

  if (kind === 'c') {
    return pick([
      [1e-6, 'uF'],
      [1e-9, 'nF'],
      [1e-12, 'pF'],
    ]);
  }
  if (kind === 'h') {
    return pick([
      [1e-6, 'uH'],
      [1e-9, 'nH'],
    ]);
  }
  if (kind === 'hz') {
    return pick([
      [1e6, 'MHz'],
      [1e3, 'kHz'],
    ]);
  }
  return pick([
    [1e6, 'MΩ'],
    [1e3, 'kΩ'],
  ]);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function onSelectionChange(rows) {
  selection.value = rows;
}

async function load() {
  loading.value = true;
  try {
    const data = await api('/api/bom/aliases');
    aliases.value = data.data;
  } catch (error) {
    ElMessage.error(error.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

/** 改绑/备注/差异开关都走同一个接口：以当前 item_id 重新写一遍 */
async function save(row, patch, successText) {
  saving.value = true;
  try {
    await api('/api/bom/resolve', {
      method: 'POST',
      body: {
        matchKey: row.matchKey,
        itemId: patch.itemId ?? row.itemId,
        action: 'bind',
        skipParams: patch.skipParams ?? row.skipParams,
        note: patch.note === undefined ? row.note : patch.note,
      },
    });
    await load();
    ElMessage.success(successText);
    return true;
  } catch (error) {
    ElMessage.error(error.message || '保存失败');
    return false;
  } finally {
    saving.value = false;
  }
}

async function toggleSkip(row, value) {
  await save(row, { skipParams: Boolean(value) }, value ? '已改为忽略封装/耐压差异' : '已恢复校验封装/耐压');
}

function openNote(row) {
  note.row = row;
  note.text = row.note ?? '';
  note.open = true;
}

async function confirmNote() {
  const ok = await save(note.row, { note: note.text.trim() || null }, '备注已保存');
  if (ok) note.open = false;
}

async function openRebind(row) {
  rebind.row = row;
  rebind.q = row.itemName ?? '';
  rebind.withArchived = Boolean(row.itemArchived);
  rebind.selected = null;
  rebind.open = true;
  await searchItems();
}

async function searchItems() {
  const query = new URLSearchParams({ pageSize: '20', q: rebind.q ?? '' });
  if (rebind.withArchived) query.set('archived', '1');
  try {
    const data = await api(`/api/items?${query.toString()}`);
    rebind.items = data.data;
  } catch (error) {
    rebind.items = [];
    ElMessage.error(error.message || '搜索失败');
  }
}

async function confirmRebind() {
  if (!rebind.selected) return;
  const ok = await save(rebind.row, { itemId: rebind.selected.id }, '已改绑');
  if (ok) rebind.open = false;
}

async function removeOne(row) {
  try {
    await ElMessageBox.confirm(
      `删除后，这条 BOM 键会重新走自动匹配（当前对应：${row.itemName ?? '—'}）。`,
      '删除对应关系',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }

  try {
    await api(`/api/bom/aliases/${row.id}`, { method: 'DELETE' });
    await load();
    ElMessage.success('已删除');
  } catch (error) {
    ElMessage.error(error.message || '删除失败');
  }
}

async function removeSelected() {
  const ids = selection.value.map((row) => row.id);
  if (ids.length === 0) return;

  try {
    await ElMessageBox.confirm(`将删除选中的 ${ids.length} 条对应关系，删除后回到自动匹配。`, '批量删除', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }

  try {
    const result = await api('/api/bom/aliases/delete', {
      method: 'POST',
      body: { ids },
    });
    await load();
    ElMessage.success(`已删除 ${result.removed} 条`);
  } catch (error) {
    ElMessage.error(error.message || '删除失败');
  }
}

onMounted(load);
</script>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}

.filters__search {
  max-width: 320px;
}

.filters__kind {
  width: 160px;
}

.panel {
  margin-top: var(--space-4);
  padding: var(--space-4) var(--space-5) var(--space-5);
}

.panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.panel__head h3 {
  font-size: 14px;
  font-weight: 600;
}

.panel__sub {
  margin-top: 3px;
  color: var(--ink-400);
  font-size: 12px;
}

.cell-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.cell-subject {
  font-size: 13px;
}

.cell-raw {
  flex: 1 1 100%;
  color: var(--ink-400);
  font-size: 11px;
  word-break: break-all;
}

.cell-link {
  color: var(--primary);
  font-size: 13px;
  text-decoration: none;
}

.cell-link:hover {
  text-decoration: underline;
}

.cell-note {
  font-size: 12px;
  color: var(--ink-600);
  word-break: break-word;
}

.rebind__search {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.hint {
  margin: 0 0 8px;
  color: var(--ink-400);
  font-size: 12px;
}

.hint code {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(10, 122, 122, 0.08);
  color: var(--primary);
  font-size: 11px;
  word-break: break-all;
}

.muted {
  color: var(--ink-400);
  font-size: 12px;
}

@media (max-width: 767px) {
  .filters__search,
  .filters__kind {
    max-width: none;
    width: 100%;
  }

  .panel {
    padding: var(--space-3) var(--space-3) var(--space-4);
  }
}
</style>
