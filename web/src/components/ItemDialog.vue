<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? '编辑物料' : '新建物料'"
    width="min(720px, 94vw)"
    align-center
    destroy-on-close
  >
    <form class="item-form" @submit.prevent="submit">
      <h4 class="section-title">基本信息</h4>
      <div class="form-grid">
        <label class="field field--full">
          <span>名称 <b>*</b></span>
          <el-input v-model="form.name" maxlength="200" placeholder="例如：STM32F103C8T6 最小系统板" />
        </label>

        <label class="field">
          <span>编号</span>
          <el-input v-model="form.code" maxlength="64" placeholder="可选，导入时作为唯一键" />
        </label>

        <label class="field">
          <span>单位</span>
          <el-input v-model="form.unit" maxlength="10" placeholder="个 / 块 / 包" />
        </label>

        <label class="field">
          <span>分类</span>
          <el-tree-select
            v-model="form.categoryId"
            :data="categories"
            check-strictly
            clearable
            filterable
            :render-after-expand="false"
            placeholder="不分类"
          />
        </label>

        <label class="field">
          <span>位置</span>
          <el-tree-select
            v-model="form.locationId"
            :data="locations"
            check-strictly
            clearable
            filterable
            :render-after-expand="false"
            placeholder="未指定位置"
          />
        </label>

        <div class="field field--full">
          <span>追踪模式</span>
          <el-radio-group v-model="form.trackingMode" :disabled="modeLocked">
            <el-radio value="quantity">数量制</el-radio>
            <el-radio value="instance">实例制</el-radio>
          </el-radio-group>
          <p v-if="modeLocked" class="hint">已有库存或实例，不能切换追踪模式。</p>
          <p v-else-if="isEdit" class="hint">只有库存为 0 时才能切换追踪模式。</p>
          <p v-else-if="form.trackingMode === 'instance'" class="hint">
            实例制用于开发板、仪器等单件管理，实例将在后续阶段登记。
          </p>
        </div>
      </div>

      <h4 class="section-title">库存与价格</h4>
      <div class="form-grid">
        <label v-if="!isEdit && form.trackingMode === 'quantity'" class="field">
          <span>初始数量</span>
          <el-input-number
            v-model="form.quantity"
            :min="0"
            :max="1000000"
            :step="1"
            controls-position="right"
            class="full-control"
          />
        </label>

        <label v-else-if="isEdit" class="field">
          <span>当前数量</span>
          <el-input :model-value="`${item?.quantity ?? 0} ${item?.unit ?? ''}`" disabled />
          <p class="hint">数量只能通过出入库流水修改。</p>
        </label>

        <label class="field">
          <span>低库存阈值</span>
          <el-input-number
            v-model="form.minQuantity"
            :min="0"
            :max="1000000"
            :step="1"
            controls-position="right"
            class="full-control"
          />
          <p class="hint">为 0 表示不提醒；数量小于等于阈值时标记低库存。</p>
        </label>

        <label class="field">
          <span>单价（元）</span>
          <el-input-number
            v-model="form.price"
            :min="0"
            :max="999999"
            :precision="2"
            :step="1"
            controls-position="right"
            class="full-control"
            placeholder="可选"
          />
        </label>

        <label class="field">
          <span>购买日期</span>
          <el-date-picker
            v-model="form.purchaseDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="可选"
            class="full-control"
          />
        </label>
      </div>

      <h4 class="section-title">补充信息</h4>
      <div class="form-grid">
        <label class="field">
          <span>厂商</span>
          <el-input v-model="form.manufacturer" maxlength="120" placeholder="ST / TI / 正点原子" />
        </label>

        <label class="field">
          <span>型号</span>
          <el-input v-model="form.model" maxlength="120" placeholder="STM32F103C8T6" />
        </label>

        <label class="field field--full">
          <span>规格</span>
          <el-input
            v-model="form.spec"
            type="textarea"
            :rows="2"
            maxlength="2000"
            placeholder="72MHz / 64KB Flash / 20KB RAM"
          />
        </label>

        <label class="field field--full">
          <span>备注</span>
          <el-input
            v-model="form.note"
            type="textarea"
            :rows="2"
            maxlength="2000"
            placeholder="例如：蓝色板，带 CH340"
          />
        </label>
      </div>
    </form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">
        {{ isEdit ? '保存修改' : '创建物料' }}
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
  categories: { type: Array, default: () => [] },
  locations: { type: Array, default: () => [] },
});

const emit = defineEmits(['update:modelValue', 'saved']);

const saving = ref(false);
const form = reactive({
  name: '',
  code: '',
  categoryId: null,
  locationId: null,
  trackingMode: 'quantity',
  unit: '个',
  quantity: 0,
  minQuantity: 0,
  manufacturer: '',
  model: '',
  spec: '',
  price: null,
  purchaseDate: null,
  note: '',
});

const isEdit = computed(() => Boolean(props.item));
const modeLocked = computed(
  () => isEdit.value && ((props.item?.quantity ?? 0) > 0 || (props.item?.instanceCount ?? 0) > 0),
);

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

watch(
  () => props.modelValue,
  (open) => {
    if (open) fillForm();
  },
);

watch(
  () => props.item,
  () => {
    if (props.modelValue) fillForm();
  },
);

function fillForm() {
  const item = props.item;
  Object.assign(form, {
    name: item?.name ?? '',
    code: item?.code ?? '',
    categoryId: item?.categoryId ?? null,
    locationId: item?.locationId ?? null,
    trackingMode: item?.trackingMode ?? 'quantity',
    unit: item?.unit ?? '个',
    quantity: item?.quantity ?? 0,
    minQuantity: item?.minQuantity ?? 0,
    manufacturer: item?.manufacturer ?? '',
    model: item?.model ?? '',
    spec: item?.spec ?? '',
    price: item?.price ?? null,
    purchaseDate: item?.purchaseDate ?? null,
    note: item?.note ?? '',
  });
}

function buildPayload() {
  const payload = {
    name: form.name.trim(),
    code: form.code.trim() || null,
    categoryId: form.categoryId ?? null,
    locationId: form.locationId ?? null,
    trackingMode: form.trackingMode,
    unit: form.unit.trim() || '个',
    minQuantity: form.minQuantity ?? 0,
    manufacturer: form.manufacturer.trim() || null,
    model: form.model.trim() || null,
    spec: form.spec.trim() || null,
    price: form.price ?? null,
    purchaseDate: form.purchaseDate || null,
    note: form.note.trim() || null,
  };

  if (!isEdit.value && form.trackingMode === 'quantity') {
    payload.quantity = form.quantity ?? 0;
  }

  return payload;
}

async function submit() {
  if (!form.name.trim()) {
    ElMessage.warning('请输入物料名称');
    return;
  }
  if (form.quantity != null && (!Number.isInteger(Number(form.quantity)) || form.quantity < 0)) {
    ElMessage.warning('初始数量必须是非负整数');
    return;
  }

  saving.value = true;
  try {
    const data = isEdit.value
      ? await api(`/api/items/${props.item.id}`, { method: 'PATCH', body: buildPayload() })
      : await api('/api/items', { method: 'POST', body: buildPayload() });

    ElMessage.success(isEdit.value ? '已保存' : '物料已创建');
    emit('saved', data.item);
    visible.value = false;
  } catch (error) {
    ElMessage.error(error.message || '保存失败');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.item-form {
  max-height: 68vh;
  overflow-y: auto;
  padding-right: 4px;
}

.section-title {
  margin: 4px 0 12px;
  color: var(--ink-900);
  font-size: 13px;
  font-weight: 600;
}

.section-title:not(:first-child) {
  margin-top: 22px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
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

.field--full {
  grid-column: 1 / -1;
}

.full-control {
  width: 100%;
}

.hint {
  color: var(--ink-400);
  font-size: 11px;
  line-height: 1.5;
}

@media (max-width: 600px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .field--full {
    grid-column: auto;
  }

  .item-form {
    max-height: 72vh;
  }
}
</style>
