<template>
  <div class="page">
    <PageHeader title="BOM 匹配" subtitle="上传立创 EDA / 嘉立创导出的 BOM，检查库存、缺口与取料位置。">
      <template #actions>
        <el-button :icon="Link" @click="router.push('/bom/aliases')">
          对应关系
          <template v-if="aliasCount > 0">（{{ aliasCount }}）</template>
        </el-button>
        <el-button v-if="report" :icon="Download" @click="exportCsv">导出报表</el-button>
      </template>
    </PageHeader>

    <section class="card uploader">
      <div class="uploader__drop">
        <el-upload
          ref="uploadRef"
          drag
          :auto-upload="false"
          :limit="1"
          accept=".csv,.xlsx"
          :on-change="handleFile"
          :on-remove="handleRemove"
          :on-exceed="handleExceed"
        >
          <el-icon class="uploader__icon"><UploadFilled /></el-icon>
          <div class="uploader__text">
            把 BOM 拖到这里，或 <em>点击选择文件</em>
          </div>
          <template #tip>
            <p class="uploader__tip">支持 .csv 与 .xlsx，需包含「位号」「名称 / 立创料号」「数量」列。</p>
          </template>
        </el-upload>
      </div>

      <div class="uploader__side">
        <label class="field">
          <span>生产套数</span>
          <el-input-number
            v-model="sets"
            :min="1"
            :max="10000"
            :step="1"
            controls-position="right"
            class="full-control"
          />
          <p class="hint">需求 = 单板用量 × 套数；留 1 表示只检查单套。</p>
        </label>
        <el-button
          type="primary"
          size="large"
          :loading="loading"
          :disabled="!file"
          @click="runMatch"
        >
          开始匹配
        </el-button>

        <el-select v-model="options.packageTolerance" size="small" class="full-control">
          <el-option label="封装：按封装族比较" value="family" />
          <el-option label="封装：严格全串比较" value="strict" />
          <el-option label="封装：忽略差异" value="ignore" />
        </el-select>
        <el-checkbox v-model="options.valueMatch" label="按「值 + 封装」匹配阻容" />
        <el-checkbox v-model="options.includeArchived" label="包含已归档物料" />
        <el-checkbox v-model="options.acceptParamMismatch" label="封装差异直接算匹配" />
        <p class="hint">改动选项后需重新点「开始匹配」。</p>
      </div>
    </section>

    <template v-if="report">
      <section class="summary">
        <article class="card stat">
          <span class="stat__label">元件种类</span>
          <strong class="stat__value">{{ report.summary.groups }}</strong>
          <span class="stat__hint">BOM 去重后</span>
        </article>
        <article class="card stat">
          <span class="stat__label">已匹配</span>
          <strong class="stat__value">{{ report.summary.matched }}</strong>
          <span class="stat__hint">
            部分匹配 {{ report.summary.partial ?? 0 }} · 缺失 {{ report.summary.missing }} · 有歧义
            {{ report.summary.ambiguous }}
          </span>
        </article>
        <article class="card stat" :class="{ 'stat--warn': report.summary.shortageGroups > 0 }">
          <span class="stat__label">缺料项</span>
          <strong class="stat__value">{{ report.summary.shortageGroups }}</strong>
          <span class="stat__hint">按本次套数计算</span>
        </article>
        <article class="card stat stat--accent">
          <span class="stat__label">最多可做</span>
          <strong class="stat__value">{{ report.summary.maxSets ?? '—' }}</strong>
          <span class="stat__hint">
            <template v-if="report.summary.sets">本次准备 {{ report.summary.sets }} 套</template>
            <template v-else>按当前库存</template>
          </span>
        </article>
      </section>

      <section class="card panel">
        <div class="panel__head">
          <h3>明细</h3>
          <div class="panel__actions">
            <el-checkbox v-model="onlyProblems">只看缺失 / 缺料</el-checkbox>
            <el-tooltip
              :disabled="consumeHint === null"
              :content="consumeHint"
              placement="top"
            >
              <span>
                <el-button
                  type="primary"
                  :icon="Minus"
                  :loading="consuming"
                  :disabled="consumeHint !== null"
                  @click="confirmConsume"
                >
                  扣减库存
                </el-button>
              </span>
            </el-tooltip>
          </div>
        </div>

        <el-alert
          v-if="consumed"
          class="panel__alert"
          type="success"
          :closable="false"
          show-icon
          title="库存已按本次套数扣减；重新匹配后可以再次扣减"
        />

        <el-alert
          v-if="aliasCount > 0"
          class="panel__alert"
          type="success"
          :closable="false"
          show-icon
          :title="`已记住 ${aliasCount} 条人工对应关系，相同 BOM 会自动命中`"
        />

        <el-table :data="visibleGroups" class="bom-table" row-key="key" :row-class-name="rowClass">
          <el-table-column label="元件" min-width="200">
            <template #default="{ row }">
              <div class="cell-main">
                <strong>{{ row.name || row.model || row.lcscCode }}</strong>
                <small>
                  <template v-if="row.lcscCode">{{ row.lcscCode }}</template>
                  <template v-if="row.model"> · {{ row.model }}</template>
                  <template v-if="row.package"> · {{ row.package }}</template>
                  <template v-if="row.voltage"> · {{ row.voltage }}</template>
                </small>
                <small v-if="row.designators.length" class="cell-designators">
                  {{ row.designators.join(' ') }}
                </small>
                <small v-for="msg in row.mismatches ?? []" :key="msg" class="cell-warn">
                  {{ msg }}
                </small>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="单板" width="72" align="right">
            <template #default="{ row }">{{ row.perSet }}</template>
          </el-table-column>
          <el-table-column label="需求" width="82" align="right">
            <template #default="{ row }">{{ row.demand }}</template>
          </el-table-column>
          <el-table-column label="库存" width="82" align="right">
            <template #default="{ row }">{{ row.stock ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="缺口" width="82" align="right">
            <template #default="{ row }">
              <span :class="{ 'text-danger': row.shortage > 0 }">{{ row.shortage }}</span>
            </template>
          </el-table-column>
          <el-table-column label="最多套数" width="92" align="right">
            <template #default="{ row }">{{ row.setsPossible ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="位置" min-width="150">
            <template #default="{ row }">
              <template v-if="row.location">
                {{ row.location }}
                <b v-if="row.cell" class="cell-chip">{{ row.cell.replace('格位 ', '') }}</b>
              </template>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag v-if="row.status === 'matched'" size="small" type="success">已匹配</el-tag>
              <el-tag v-else-if="row.status === 'partial'" size="small" type="warning">
                部分匹配
              </el-tag>
              <el-tag v-else-if="row.status === 'ambiguous'" size="small" type="warning">有歧义</el-tag>
              <el-tag v-else size="small" type="danger">缺失</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="匹配方式" width="96">
            <template #default="{ row }">
              <span class="muted">{{ matchLabel(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="168" align="right">
            <template #default="{ row }">
              <el-button v-if="row.status === 'partial'" link size="small" @click="acceptRow(row)">
                接受
              </el-button>
              <el-button link size="small" @click="openPicker(row)">
                {{ row.itemId ? '改选' : '指定' }}
              </el-button>
              <el-button
                v-if="row.aliasId || overrideOf(row)"
                link
                size="small"
                @click="clearRow(row)"
              >
                撤销
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <section v-if="report.pickup.length" class="pickup">
        <h3 class="pickup__title">取料清单（按位置分组）</h3>
        <div class="pickup__grid">
          <article v-for="bucket in report.pickup" :key="bucket.location" class="card pickup__card">
            <header>
              <el-icon><Grid /></el-icon>
              <strong>{{ bucket.location }}</strong>
            </header>
            <ul>
              <li v-for="item in bucket.items" :key="item.itemId">
                <span class="pickup__cell">{{ item.cell ? item.cell.replace('格位 ', '') : '—' }}</span>
                <span class="pickup__name">{{ item.name }}</span>
                <span class="pickup__qty">{{ item.demand }}{{ item.unit }}</span>
              </li>
            </ul>
          </article>
        </div>
      </section>

    <el-dialog v-model="picker.open" title="指定物料" width="760px" append-to-body>
      <div class="picker__search">
        <el-input
          v-model="picker.q"
          placeholder="搜索名称 / 型号 / 立创料号"
          clearable
          @input="searchItems"
        />
        <el-checkbox v-model="picker.withArchived" @change="searchItems">含归档</el-checkbox>
      </div>
      <p class="hint">
        目标行：{{ picker.row?.name || '—' }}
        <template v-if="picker.row?.package"> · {{ picker.row.package }}</template>
        <template v-if="picker.row?.candidates?.length">
          · 库内 {{ picker.row.candidates.length }} 个候选
        </template>
      </p>
      <el-table
        :data="picker.items"
        height="320"
        highlight-current-row
        @current-change="onPickItem"
      >
        <el-table-column prop="name" label="名称" min-width="220" />
        <el-table-column prop="package" label="封装" width="110" />
        <el-table-column prop="quantity" label="库存" width="80" align="right" />
        <el-table-column prop="locationPath" label="位置" min-width="140" />
        <el-table-column prop="lcscCode" label="立创" width="104" />
      </el-table>
      <template #footer>
        <el-checkbox v-model="picker.remember" class="picker__remember">记住这个对应关系</el-checkbox>
        <el-button @click="picker.open = false">取消</el-button>
        <el-button type="primary" :disabled="!picker.selected" :loading="applying" @click="confirmPick">
          确定
        </el-button>
      </template>
    </el-dialog>
    </template>

    <EmptyState
      v-else-if="!loading"
      title="还没有匹配结果"
      description="选择 BOM 文件并设置套数，就能看到每种元件的库存、缺口和在柜子里的位置。"
    >
      <template #icon><Files /></template>
    </EmptyState>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Download, Files, Grid, Link, Minus, UploadFilled } from '@element-plus/icons-vue';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import { api, apiUpload } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

const uploadRef = ref(null);
const router = useRouter();
const auth = useAuthStore();
const file = ref(null);
const sets = ref(1);
const loading = ref(false);
const applying = ref(false);
const consuming = ref(false);
/** 本次报告是否已经扣过库存，防止重复点击 */
const consumed = ref(false);
const report = ref(null);
const onlyProblems = ref(false);
const aliasCount = ref(0);

const options = reactive({
  valueMatch: true,
  packageTolerance: 'family',
  includeArchived: false,
  acceptParamMismatch: false,
});

/** 本次会话的人工覆盖：matchKey → { itemId, skipParams } */
const overrides = reactive({});

const picker = reactive({
  open: false,
  q: '',
  withArchived: false,
  remember: true,
  items: [],
  selected: null,
  row: null,
});

function overrideOf(row) {
  return overrides[row.matchKey] ?? null;
}

function matchLabel(row) {
  return (
    {
      lcsc: '立创料号',
      model: '型号',
      code: '内部编码',
      name: '名称',
      value: '值+封装',
      alias: '人工记住',
      manual: '人工指定',
    }[row.matchedBy] ?? '—'
  );
}

function rowClass({ row }) {
  return row.status === 'partial' ? 'row-partial' : '';
}

const visibleGroups = computed(() => {
  if (!report.value) return [];
  if (!onlyProblems.value) return report.value.groups;
  return report.value.groups.filter(
    (row) => row.status !== 'matched' || row.shortage > 0,
  );
});

/** 本次会被扣减的行：已匹配 / 部分匹配且有物料 */
const deductibleRows = computed(() => {
  if (!report.value) return [];
  return report.value.groups.filter(
    (row) => row.itemId && (row.status === 'matched' || row.status === 'partial') && row.demand > 0,
  );
});

const deductiblePieces = computed(() =>
  deductibleRows.value.reduce((sum, row) => sum + Number(row.demand ?? 0), 0),
);

const partialCount = computed(
  () => deductibleRows.value.filter((row) => row.status === 'partial').length,
);

/** null 表示可以点击；非 null 时作为按钮禁用原因提示 */
const consumeHint = computed(() => {
  if (!auth.canWrite) return '只读账号不能扣减库存';
  if (!report.value) return '请先匹配 BOM';
  if (consumed.value) return '本次已扣减，重新匹配后可再次扣减';
  if (deductibleRows.value.length === 0) return '没有可扣减的已匹配物料';
  return null;
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

/** 按生产套数扣减已匹配库存：先确认，再一次事务内出库 */
async function confirmConsume() {
  if (!report.value || consumeHint.value !== null) return;

  const usedSets = report.value.summary.sets ?? sets.value;
  const skipped = report.value.groups.length - deductibleRows.value.length;
  const lines = [
    `将按 <b>${usedSets}</b> 套扣减 <b>${deductibleRows.value.length}</b> 种物料，共 <b>${deductiblePieces.value}</b> 件。`,
    '每种物料会写一条出库流水，备注为「BOM 生产扣料」。',
  ];
  if (partialCount.value > 0) {
    lines.push(`其中 ${partialCount.value} 项为部分匹配（参数有差异），也会一并扣减。`);
  }
  if (skipped > 0) {
    lines.push(`${skipped} 项未匹配 / 有歧义的物料会被跳过。`);
  }
  lines.push('<br />库存不足时整次操作不会生效，库存保持不变。');

  try {
    await ElMessageBox.confirm(lines.join('<br />'), '确认扣减库存', {
      confirmButtonText: '确认扣减',
      cancelButtonText: '取消',
      type: 'warning',
      dangerouslyUseHTMLString: true,
    });
  } catch {
    return;
  }

  consuming.value = true;
  try {
    const result = await api('/api/bom/consume', {
      method: 'POST',
      body: {
        sets: usedSets,
        options: { ...options },
        groups: report.value.groups,
        overrides: Object.entries(overrides).map(([key, value]) => ({ key, ...value })),
        note: file.value?.name ?? null,
      },
    });
    report.value = result;
    consumed.value = true;
    ElMessage.success(
      `已扣减 ${result.deduction.items} 种物料，共 ${result.deduction.totalQuantity} 件`,
    );
  } catch (error) {
    const problems = error.details?.problems;
    if (Array.isArray(problems) && problems.length > 0) {
      const rows = problems
        .map((item) => `<li>${escapeHtml(item.name)}：${escapeHtml(item.reason)}</li>`)
        .join('');
      const more =
        error.details.total > problems.length
          ? `<p>另有 ${error.details.total - problems.length} 项未列出。</p>`
          : '';
      ElMessageBox.alert(
        `<p>库存没有变化。请先补料或调整套数后再试。</p><ul style="padding-left:18px">${rows}</ul>${more}`,
        '无法扣减',
        { type: 'error', dangerouslyUseHTMLString: true },
      ).catch(() => {});
    } else {
      ElMessage.error(error.message || '扣减失败');
    }
  } finally {
    consuming.value = false;
  }
}

function handleFile(uploadFile) {
  file.value = uploadFile.raw ?? null;
  report.value = null;
  consumed.value = false;
}

function handleRemove() {
  file.value = null;
}

function handleExceed() {
  ElMessage.warning('一次只能匹配一个文件，请先移除已有文件');
}

async function runMatch() {
  if (!file.value) {
    ElMessage.warning('请选择 BOM 文件');
    return;
  }
  loading.value = true;
  try {
    for (const key of Object.keys(overrides)) delete overrides[key];
    consumed.value = false;

    const formData = new FormData();
    formData.append('file', file.value, file.value.name);
    formData.append('sets', String(sets.value));
    formData.append('options', JSON.stringify({ ...options }));
    report.value = await apiUpload('/api/bom/preview', formData);
    await loadAliases();

    const { missing, ambiguous, manual } = report.value.summary;
    const parts = [];
    if (manual) parts.push(`${manual} 项来自人工对应`);
    if (ambiguous) parts.push(`${ambiguous} 项需人工选定`);
    if (missing) parts.push(`${missing} 项本地没有`);
    ElMessage.success(parts.length > 0 ? `匹配完成：${parts.join('，')}` : '匹配完成');
  } catch (error) {
    ElMessage.error(error.message || '匹配失败');
  } finally {
    loading.value = false;
  }
}

async function loadAliases() {
  try {
    const data = await api('/api/bom/aliases');
    aliasCount.value = data.data.length;
  } catch {
    aliasCount.value = 0;
  }
}

onMounted(loadAliases);

/** 把人工覆盖回传服务端重算，库存/缺口/可支持套数都会跟着变 */
async function applyOverrides() {
  if (!report.value) return;
  applying.value = true;
  try {
    report.value = await api('/api/bom/apply', {
      method: 'POST',
      body: {
        sets: sets.value,
        options: { ...options },
        groups: report.value.groups,
        overrides: Object.entries(overrides).map(([key, value]) => ({ key, ...value })),
      },
    });
  } catch (error) {
    ElMessage.error(error.message || '重算失败');
  } finally {
    applying.value = false;
  }
}

async function remember(row, itemId, action) {
  try {
    await api('/api/bom/resolve', {
      method: 'POST',
      body: { matchKey: row.matchKey, itemId, action },
    });
    await loadAliases();
    ElMessage.success('已记住这个对应关系');
  } catch (error) {
    ElMessage.warning(`未能记住：${error.message}`);
  }
}

async function openPicker(row) {
  picker.row = row;
  picker.selected = null;
  picker.q = row.name ?? '';
  picker.withArchived = options.includeArchived;
  picker.remember = true;
  picker.open = true;
  await searchItems();
}

async function searchItems() {
  const query = new URLSearchParams({ pageSize: '20', q: picker.q ?? '' });
  if (picker.withArchived) query.set('archived', '1');
  try {
    const data = await api(`/api/items?${query.toString()}`);
    picker.items = data.data;
    picker.selected = data.data.length === 1 ? data.data[0] : null;
  } catch (error) {
    picker.items = [];
    ElMessage.error(error.message || '搜索失败');
  }
}

function onPickItem(item) {
  if (item) picker.selected = item;
}

async function confirmPick() {
  const { row, selected, remember: shouldRemember } = picker;
  if (!row || !selected) return;

  overrides[row.matchKey] = { itemId: selected.id, skipParams: false };
  picker.open = false;
  await applyOverrides();
  if (shouldRemember) await remember(row, selected.id, 'bind');
}

/** 部分匹配 → 完全匹配（封装/耐压差异视为可接受） */
async function acceptRow(row) {
  if (!row.itemId) return;
  overrides[row.matchKey] = { itemId: row.itemId, skipParams: true };
  await applyOverrides();
  await remember(row, row.itemId, 'accept');
}

async function clearRow(row) {
  delete overrides[row.matchKey];
  await applyOverrides();

  if (row.aliasId) {
    try {
      await api(`/api/bom/aliases/${row.aliasId}`, { method: 'DELETE' });
      await loadAliases();
    } catch (error) {
      ElMessage.warning(`撤销失败：${error.message}`);
    }
  }
}

function exportCsv() {
  if (!report.value) return;
  const header = ['元件', '立创料号', '型号', '封装', '耐压', '单板用量', '需求', '库存', '缺口', '最多套数', '位置', '格位', '状态', '匹配方式', '参数差异', '位号'];
  const lines = [header.join(',')];
  for (const row of report.value.groups) {
    const cells = [
      row.name,
      row.lcscCode ?? '',
      row.model ?? '',
      row.package ?? '',
      row.voltage ?? '',
      row.perSet,
      row.demand,
      row.stock ?? '',
      row.shortage,
      row.setsPossible ?? '',
      row.location ?? '',
      row.cell ? row.cell.replace('格位 ', '') : '',
      row.status,
      matchLabel(row),
      (row.mismatches ?? []).join('；'),
      row.designators.join(' '),
    ].map((value) => {
      const text = String(value ?? '');
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    });
    lines.push(cells.join(','));
  }

  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `partbin-bom-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<style scoped>
.uploader {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: var(--space-5);
  align-items: stretch;
  padding: var(--space-4) var(--space-5);
}

.uploader__drop {
  min-width: 0;
}

.uploader__drop :deep(.el-upload),
.uploader__drop :deep(.el-upload-dragger) {
  width: 100%;
}

.uploader__drop :deep(.el-upload-dragger) {
  padding: 32px 20px;
  border-radius: var(--r-md);
}

.uploader__icon {
  font-size: 34px;
  color: var(--primary);
}

.uploader__text {
  margin-top: 6px;
  color: var(--ink-600);
  font-size: 13px;
}

.uploader__text em {
  color: var(--primary);
  font-style: normal;
}

.uploader__tip {
  margin-top: 6px;
  color: var(--ink-400);
  font-size: 12px;
}

.uploader__side {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
  padding: var(--space-2) 0 var(--space-2) var(--space-5);
  border-left: 1px dashed var(--line);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--ink-600);
  font-size: 12px;
}

.full-control {
  width: 100%;
}

.hint {
  margin: 0;
  color: var(--ink-400);
  font-size: 12px;
  line-height: 1.6;
}

.summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-4);
  margin-top: var(--space-5);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--space-4) var(--space-5);
}

.stat__label {
  color: var(--ink-500);
  font-size: 12px;
}

.stat__value {
  font-size: 24px;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.stat__hint {
  color: var(--ink-400);
  font-size: 11px;
}

.stat--warn .stat__value {
  color: var(--danger, #c0392b);
}

.stat--accent {
  background: rgba(10, 122, 122, 0.08);
}

.stat--accent .stat__value {
  color: var(--primary);
}

.panel {
  margin-top: var(--space-5);
  padding: var(--space-4) var(--space-5) var(--space-5);
}

.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.panel__head h3 {
  font-size: 14px;
  font-weight: 600;
}

.panel__actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.cell-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.cell-main strong {
  font-size: 13px;
}

.cell-main small {
  color: var(--ink-400);
  font-size: 11px;
}

.cell-designators {
  color: var(--ink-500) !important;
}

.cell-warn {
  color: var(--warning, #b45309) !important;
}

:deep(.row-partial) {
  background: rgba(214, 154, 21, 0.08) !important;
}

:deep(.row-partial) {
  background: rgba(214, 154, 21, 0.08) !important;
}

.cell-chip {
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(10, 122, 122, 0.1);
  color: var(--primary);
  font-size: 11px;
  font-weight: 400;
}

.text-danger {
  color: var(--danger, #c0392b);
  font-weight: 600;
}

.muted {
  color: var(--ink-400);
}

.panel__alert {
  margin-bottom: var(--space-3);
}

.picker__search {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}

.picker__remember {
  float: left;
  line-height: 32px;
}

.pickup {
  margin-top: var(--space-5);
}

.pickup__title {
  margin-bottom: var(--space-3);
  font-size: 14px;
  font-weight: 600;
}

.pickup__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-4);
}

.pickup__card {
  padding: var(--space-4);
}

.pickup__card header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--line);
  color: var(--ink-900);
  font-size: 13px;
}

.pickup__card ul {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.pickup__card li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
}

.pickup__cell {
  flex-shrink: 0;
  min-width: 30px;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(10, 122, 122, 0.1);
  color: var(--primary);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.pickup__name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pickup__qty {
  color: var(--ink-600);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 860px) {
  .uploader {
    grid-template-columns: minmax(0, 1fr);
    padding: var(--space-3);
    gap: var(--space-3);
  }

  .uploader__side {
    padding: var(--space-4) 0 0;
    border-top: 1px dashed var(--line);
    border-left: 0;
  }

  .summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
}
</style>
