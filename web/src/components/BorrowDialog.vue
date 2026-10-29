<template>
  <el-dialog v-model="visible" title="借出" width="min(480px, 92vw)" align-center destroy-on-close>
    <div class="borrow-form">
      <p class="current">
        {{ item?.name }} · 可用
        <strong class="num">{{ item?.available ?? 0 }}</strong>
        {{ item?.unit || '个' }}
      </p>

      <label class="field">
        <span>借用人 <b>*</b></span>
        <el-input v-model="form.borrower" maxlength="60" placeholder="姓名或昵称" />
      </label>

      <label v-if="item?.trackingMode === 'instance'" class="field">
        <span>选择实例 <b>*</b></span>
        <el-select v-model="form.instanceId" placeholder="选择在库实例" class="control">
          <el-option
            v-for="instance in availableInstances"
            :key="instance.id"
            :label="instance.assetNo || `实例 #${instance.id}`"
            :value="instance.id"
          />
        </el-select>
      </label>

      <label v-else class="field">
        <span>数量 <b>*</b></span>
        <el-input-number
          v-model="form.quantity"
          :min="1"
          :max="item?.available ?? 1"
          :step="1"
          controls-position="right"
          class="control"
        />
      </label>

      <label class="field">
        <span>预计归还</span>
        <el-date-picker
          v-model="form.dueAt"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="可选"
          class="control"
        />
      </label>

      <label class="field">
        <span>联系方式</span>
        <el-input v-model="form.contact" maxlength="100" placeholder="可选，微信 / 手机号" />
      </label>

      <label class="field">
        <span>备注</span>
        <el-input v-model="form.note" type="textarea" :rows="2" maxlength="500" placeholder="可选" />
      </label>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">确认借出</el-button>
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
  instances: { type: Array, default: () => [] },
});

const emit = defineEmits(['update:modelValue', 'saved']);

const saving = ref(false);
const form = reactive({
  borrower: '',
  quantity: 1,
  instanceId: null,
  dueAt: null,
  contact: '',
  note: '',
});

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const availableInstances = computed(() =>
  props.instances.filter((instance) => instance.status === 'in_stock'),
);

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    Object.assign(form, {
      borrower: '',
      quantity: 1,
      instanceId: availableInstances.value.length === 1 ? availableInstances.value[0].id : null,
      dueAt: null,
      contact: '',
      note: '',
    });
  },
);

async function submit() {
  if (!props.item) return;
  if (!form.borrower.trim()) {
    ElMessage.warning('请输入借用人');
    return;
  }
  if (props.item.trackingMode === 'instance' && !form.instanceId) {
    ElMessage.warning('请选择要借出的实例');
    return;
  }
  if (props.item.trackingMode !== 'instance' && form.quantity > props.item.available) {
    ElMessage.warning('借出数量超过可用量');
    return;
  }

  saving.value = true;
  try {
    const data = await api('/api/loans', {
      method: 'POST',
      body: {
        itemId: props.item.id,
        quantity: props.item.trackingMode === 'instance' ? 1 : form.quantity,
        instanceId: props.item.trackingMode === 'instance' ? form.instanceId : null,
        borrower: form.borrower.trim(),
        contact: form.contact.trim() || null,
        note: form.note.trim() || null,
        dueAt: form.dueAt || null,
      },
    });
    ElMessage.success(`已借出，剩余可用 ${data.available}`);
    emit('saved', data);
    visible.value = false;
  } catch (error) {
    ElMessage.error(error.message || '借出失败');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.borrow-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
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
</style>
