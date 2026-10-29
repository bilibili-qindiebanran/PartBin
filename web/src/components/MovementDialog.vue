<template>
  <el-dialog v-model="visible" :title="title" width="min(480px, 92vw)" align-center destroy-on-close>
    <div class="stock-form">
      <p class="current">
        当前：<strong class="num">{{ item?.quantity ?? 0 }}</strong> {{ item?.unit || '个' }}
        <span v-if="item?.locationPath"> · {{ item.locationPath }}</span>
      </p>

      <div class="field">
        <span>类型</span>
        <el-radio-group v-model="form.type">
          <el-radio-button value="in">入库</el-radio-button>
          <el-radio-button value="out">出库</el-radio-button>
          <el-radio-button value="adjust">盘点</el-radio-button>
          <el-radio-button value="discard">报废</el-radio-button>
          <el-radio-button value="lost">丢失</el-radio-button>
        </el-radio-group>
      </div>

      <label class="field">
        <span>数量</span>
        <el-input-number
          v-model="form.quantity"
          :min="1"
          :max="1000000"
          :step="1"
          controls-position="right"
          class="control"
        />
      </label>

      <div v-if="form.type === 'adjust'" class="field">
        <span>调整方向</span>
        <el-radio-group v-model="form.direction">
          <el-radio value="down">盘亏（减少）</el-radio>
          <el-radio value="up">盘盈（增加）</el-radio>
        </el-radio-group>
      </div>

      <label class="field">
        <span>发生时间</span>
        <el-date-picker
          v-model="form.occurredAt"
          type="datetime"
          value-format="YYYY-MM-DDTHH:mm:ss"
          placeholder="默认现在"
          class="control"
        />
      </label>

      <label class="field">
        <span>备注 <b v-if="form.type === 'adjust'">*</b></span>
        <el-input
          v-model="form.note"
          type="textarea"
          :rows="2"
          maxlength="500"
          :placeholder="notePlaceholder"
        />
      </label>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">
        {{ form.type === 'adjust' ? '保存盘点' : '确认' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api/client';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  item: { type: Object, default: null },
  defaultType: { type: String, default: 'in' },
});

const emit = defineEmits(['update:modelValue', 'saved']);

const saving = ref(false);
const form = reactive({
  type: 'in',
  quantity: 1,
  direction: 'down',
  note: '',
  occurredAt: null,
});

const labels = {
  in: '入库',
  out: '出库',
  adjust: '盘点调整',
  discard: '报废',
  lost: '丢失',
};

const title = computed(() => `${labels[form.type] || '出入库'} · ${props.item?.name ?? ''}`);

const notePlaceholder = computed(() =>
  form.type === 'adjust' ? '盘点原因，例如：盒里实际只有 5 个' : '可选，例如：采购到货 / 焊到板子上',
);

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    Object.assign(form, {
      type: props.defaultType || 'in',
      quantity: 1,
      direction: 'down',
      note: '',
      occurredAt: null,
    });
  },
);

async function submit() {
  if (!props.item) return;

  if (!Number.isInteger(Number(form.quantity)) || form.quantity <= 0) {
    ElMessage.warning('数量必须是正整数');
    return;
  }
  if (form.type === 'adjust' && !form.note.trim()) {
    ElMessage.warning('盘点调整必须填写原因');
    return;
  }
  if (['out', 'discard', 'lost'].includes(form.type) && form.quantity > props.item.quantity) {
    ElMessage.warning(`库存不足：当前只有 ${props.item.quantity} ${props.item.unit || '个'}`);
    return;
  }

  saving.value = true;
  try {
    const data = await api(`/api/items/${props.item.id}/movements`, {
      method: 'POST',
      body: {
        type: form.type,
        quantity: form.quantity,
        direction: form.type === 'adjust' ? form.direction : undefined,
        note: form.note.trim() || null,
        occurredAt: form.occurredAt || undefined,
      },
    });
    ElMessage.success(`${labels[form.type]}成功，当前 ${data.item.quantity}`);
    emit('saved', data);
    visible.value = false;
  } catch (error) {
    ElMessage.error(error.message || '操作失败');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.stock-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.current {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--ink-600);
  font-size: 12px;
}

.field b {
  color: var(--danger);
  font-weight: 500;
}

.control {
  width: 100%;
}

:deep(.el-radio-button__inner) {
  padding: 8px 14px;
}
</style>
