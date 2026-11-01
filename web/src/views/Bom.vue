<template>
  <div class="page">
    <PageHeader title="BOM 匹配" subtitle="上传立创 EDA / 嘉立创导出的 BOM，检查库存、缺口与取料位置。">
      <template #actions>
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
          <el-checkbox v-model="onlyProblems">只看缺失 / 缺料</el-checkbox>
        </div>

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
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Download, Files, Grid, UploadFilled } from '@element-plus/icons-vue';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import { apiUpload } from '@/api/client';

const uploadRef = ref(null);
const file = ref(null);
const sets = ref(1);
const loading = ref(false);
const report = ref(null);
const onlyProblems = ref(false);

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

function handleFile(uploadFile) {
  file.value = uploadFile.raw ?? null;
  report.value = null;
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
    const formData = new FormData();
    formData.append('file', file.value, file.value.name);
    formData.append('sets', String(sets.value));
    report.value = await apiUpload('/api/bom/preview', formData);
    ElMessage.success(
      report.value.summary.missing > 0
        ? `匹配完成，有 ${report.value.summary.missing} 种元件本地没有`
        : '匹配完成',
    );
  } catch (error) {
    ElMessage.error(error.message || '匹配失败');
  } finally {
    loading.value = false;
  }
}

function exportCsv() {
  if (!report.value) return;
  const header = ['元件', '立创料号', '型号', '封装', '耐压', '单板用量', '需求', '库存', '缺口', '最多套数', '位置', '格位', '状态', '参数差异', '位号'];
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
