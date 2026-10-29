<template>
  <div class="transfer">
    <div class="transfer__row">
      <span class="transfer__label">导出</span>
      <a class="transfer__link" href="/api/export/items.csv">物料 CSV</a>
      <a class="transfer__link" href="/api/export/movements.csv">流水 CSV</a>
      <a class="transfer__link" href="/api/export/loans.csv">借出 CSV</a>
    </div>

    <div v-if="canWrite" class="transfer__row">
      <span class="transfer__label">导入</span>
      <el-button size="small" :loading="previewing" @click="fileInput?.click()">
        选择 CSV 预览
      </el-button>
      <input
        ref="fileInput"
        type="file"
        accept=".csv,text/csv"
        class="hidden-input"
        @change="onFileSelected"
      />
    </div>

    <p class="transfer__hint">
      UTF-8 编码；先导出模板再编辑最稳妥。按「编号」匹配，无编号时按「名称 + 型号 + 单位」匹配。
    </p>

    <el-dialog v-model="previewVisible" title="CSV 导入预览" width="min(720px, 94vw)" align-center>
      <div v-if="preview" class="preview">
        <div class="summary">
          <span>共 {{ preview.summary.rows }} 行</span>
          <span class="ok">新建 {{ preview.summary.create }}</span>
          <span class="ok">更新 {{ preview.summary.update }}</span>
          <span>不变 {{ preview.summary.unchanged }}</span>
          <span class="bad">错误 {{ preview.summary.error }}</span>
        </div>

        <div v-if="preview.errors.length > 0" class="errors">
          <p v-for="item in preview.errors.slice(0, 20)" :key="`${item.line}-${item.message}`">
            第 {{ item.line }} 行：{{ item.message }}
          </p>
          <p v-if="preview.errors.length > 20" class="muted">
            还有 {{ preview.errors.length - 20 }} 条错误未显示
          </p>
        </div>

        <div v-if="preview.preview.length > 0" class="samples">
          <div v-for="row in preview.preview.slice(0, 10)" :key="row.line" class="sample">
            <el-tag size="small" :type="row.action === 'create' ? 'success' : row.action === 'update' ? 'warning' : 'info'">
              {{ actionLabel(row.action) }}
            </el-tag>
            <span class="sample__name">{{ row.name }}</span>
            <span v-if="row.action === 'update'" class="muted num">
              {{ row.quantityBefore }} → {{ row.quantityAfter }}
            </span>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="previewVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!preview || preview.summary.error > 0"
          :loading="committing"
          @click="commit"
        >
          确认导入
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { apiUpload } from '@/api/client';
import { useDictionaryStore } from '@/stores/dictionary';

defineProps({ canWrite: { type: Boolean, default: false } });
const emit = defineEmits(['imported']);

const dictionary = useDictionaryStore();
const fileInput = ref(null);
const file = ref(null);
const preview = ref(null);
const previewVisible = ref(false);
const previewing = ref(false);
const committing = ref(false);

function actionLabel(action) {
  return { create: '新建', update: '更新', unchanged: '不变' }[action] ?? action;
}

async function onFileSelected(event) {
  const selected = event.target.files?.[0];
  event.target.value = '';
  if (!selected) return;

  file.value = selected;
  const formData = new FormData();
  formData.append('file', selected);

  previewing.value = true;
  try {
    preview.value = await apiUpload('/api/import/preview', formData);
    previewVisible.value = true;
  } catch (error) {
    ElMessage.error(error.message || '预览失败');
  } finally {
    previewing.value = false;
  }
}

async function commit() {
  if (!file.value) return;
  committing.value = true;
  try {
    const formData = new FormData();
    formData.append('file', file.value);
    const data = await apiUpload('/api/import/commit', formData);
    ElMessage.success(
      `导入完成：新建 ${data.summary.create}，更新 ${data.summary.update}，调整数量 ${data.summary.quantityAdjusted}`,
    );
    previewVisible.value = false;
    await dictionary.refresh();
    emit('imported');
  } catch (error) {
    ElMessage.error(error.message || '导入失败');
  } finally {
    committing.value = false;
  }
}
</script>

<style scoped>
.transfer {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.transfer__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.transfer__label {
  width: 40px;
  color: var(--ink-400);
  font-size: 12px;
}

.transfer__link {
  color: var(--primary);
  font-size: 13px;
}

.transfer__hint {
  color: var(--ink-400);
  font-size: 12px;
  line-height: 1.7;
}

.hidden-input {
  display: none;
}

.preview {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--primary-soft);
  color: var(--ink-600);
  font-size: 12px;
}

.summary .ok {
  color: var(--success);
}

.summary .bad {
  color: var(--danger);
}

.errors {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(180, 35, 24, 0.06);
  color: var(--danger);
  font-size: 12px;
  line-height: 1.7;
}

.samples {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sample {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.sample__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
