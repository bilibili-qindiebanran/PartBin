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

        <label v-if="selectedLocation?.isGrid" class="field">
          <span>格位行（1–{{ selectedLocation.gridRows }}）</span>
          <el-select
            v-model="form.cellRow"
            clearable
            placeholder="未归位"
            class="full-control"
          >
            <el-option
              v-for="row in selectedLocation.gridRows"
              :key="row"
              :label="`第 ${row} 行`"
              :value="row"
            />
          </el-select>
        </label>

        <label v-if="selectedLocation?.isGrid" class="field">
          <span>格位列（1–{{ selectedLocation.gridCols }}）</span>
          <el-select
            v-model="form.cellCol"
            clearable
            placeholder="未归位"
            class="full-control"
          >
            <el-option
              v-for="col in selectedLocation.gridCols"
              :key="col"
              :label="`第 ${col} 列`"
              :value="col"
            />
          </el-select>
        </label>

        <p v-if="selectedLocation?.isGrid" class="field field--full hint">
          该位置是分类盒（{{ selectedLocation.gridRows }}×{{ selectedLocation.gridCols }}），一个格位只能放一种元件；留空表示尚未归位。
        </p>

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
        <label class="field field--full">
          <span>立创料号</span>
          <div class="lcsc-row">
            <el-input
              v-model="form.lcscCode"
              maxlength="20"
              placeholder="如 C2286，可粘贴商城链接"
              clearable
            />
            <el-button
              :loading="lcscLoading"
              :disabled="!form.lcscCode.trim()"
              @click="lookupLcsc"
            >
              匹配
            </el-button>
          </div>
          <p v-if="lcscPart" class="lcsc-preview">
            <strong>{{ lcscPart.code }}</strong> · {{ lcscPart.name }}
            <template v-if="lcscPart.package"> · {{ lcscPart.package }}</template>
            <template v-if="lcscPart.stock != null"> · 库存 {{ lcscPart.stock }}</template>
            <a v-if="lcscPart.sourceUrl" :href="lcscPart.sourceUrl" target="_blank" rel="noreferrer">
              查看商城
            </a>
          </p>
          <p v-else class="hint">
            输入料号后点「匹配」，会自动填充空白的型号、厂商与规格；失败时仍可手写。
          </p>
        </label>

        <label class="field">
          <span>厂商</span>
          <el-input v-model="form.manufacturer" maxlength="120" placeholder="ST / TI / 正点原子" />
        </label>

        <label class="field">
          <span>型号</span>
          <el-input v-model="form.model" maxlength="120" placeholder="STM32F103C8T6" />
        </label>

        <label class="field">
          <span>封装</span>
          <el-input v-model="form.package" maxlength="60" placeholder="0603 / SOP-8 / LQFP-48" />
        </label>

        <label class="field">
          <span>耐压</span>
          <el-input v-model="form.voltage" maxlength="40" placeholder="16V / 50V" />
          <p class="hint">封装与耐压会在 BOM 匹配时与表格对比。</p>
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
const lcscLoading = ref(false);
const lcscPart = ref(null);
const lcscMatched = ref(false);
const form = reactive({
  name: '',
  code: '',
  lcscCode: '',
  categoryId: null,
  locationId: null,
  cellRow: null,
  cellCol: null,
  trackingMode: 'quantity',
  unit: '个',
  quantity: 0,
  minQuantity: 0,
  manufacturer: '',
  model: '',
  package: '',
  voltage: '',
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

function findLocation(nodes, id) {
  for (const node of nodes) {
    if (node.value === id) return node;
    const found = node.children?.length ? findLocation(node.children, id) : null;
    if (found) return found;
  }
  return null;
}

const selectedLocation = computed(() =>
  form.locationId == null ? null : findLocation(props.locations, form.locationId),
);

watch(
  () => form.locationId,
  () => {
    if (!selectedLocation.value?.isGrid) {
      form.cellRow = null;
      form.cellCol = null;
    }
  },
);

function fillForm() {
  const item = props.item;
  lcscPart.value = null;
  lcscMatched.value = false;
  Object.assign(form, {
    name: item?.name ?? '',
    code: item?.code ?? '',
    lcscCode: item?.lcscCode ?? '',
    categoryId: item?.categoryId ?? null,
    locationId: item?.locationId ?? null,
    cellRow: item?.cellRow ?? null,
    cellCol: item?.cellCol ?? null,
    trackingMode: item?.trackingMode ?? 'quantity',
    unit: item?.unit ?? '个',
    quantity: item?.quantity ?? 0,
    minQuantity: item?.minQuantity ?? 0,
    manufacturer: item?.manufacturer ?? '',
    model: item?.model ?? '',
    package: item?.package ?? '',
    voltage: item?.voltage ?? '',
    spec: item?.spec ?? '',
    price: item?.price ?? null,
    purchaseDate: item?.purchaseDate ?? null,
    note: item?.note ?? '',
  });
}

async function lookupLcsc() {
  const code = form.lcscCode.trim();
  if (!code) {
    ElMessage.warning('请先填写立创料号');
    return;
  }
  lcscLoading.value = true;
  try {
    const data = await api('/api/lcsc/lookup', { method: 'POST', body: { code } });
    if (!data?.part) throw new Error('未获取到元件信息');
    lcscPart.value = data.part;
    lcscMatched.value = true;
    form.lcscCode = data.part.code;
    if (!form.name.trim()) form.name = data.part.name ?? '';
    if (!form.model.trim()) form.model = data.part.model ?? '';
    if (!form.manufacturer.trim()) form.manufacturer = data.part.manufacturer ?? '';
    if (!form.package.trim()) form.package = data.part.package ?? '';
    if (!form.spec.trim()) form.spec = data.part.description ?? '';
    ElMessage.success(data.cached ? '已使用缓存结果填充' : '已从立创商城匹配');
  } catch (error) {
    lcscMatched.value = false;
    ElMessage.error(error.message || '匹配失败，请手动填写');
  } finally {
    lcscLoading.value = false;
  }
}

function buildPayload() {
  const payload = {
    name: form.name.trim(),
    code: form.code.trim() || null,
    lcscCode: form.lcscCode.trim() || null,
    categoryId: form.categoryId ?? null,
    locationId: form.locationId ?? null,
    trackingMode: form.trackingMode,
    unit: form.unit.trim() || '个',
    minQuantity: form.minQuantity ?? 0,
    manufacturer: form.manufacturer.trim() || null,
    model: form.model.trim() || null,
    package: form.package.trim() || null,
    voltage: form.voltage.trim() || null,
    spec: form.spec.trim() || null,
    price: form.price ?? null,
    purchaseDate: form.purchaseDate || null,
    note: form.note.trim() || null,
  };

  if (!isEdit.value && form.trackingMode === 'quantity') {
    payload.quantity = form.quantity ?? 0;
  }

  if (lcscMatched.value) payload.lcscMatched = true;

  if (selectedLocation.value?.isGrid) {
    payload.cellRow = form.cellRow ?? null;
    payload.cellCol = form.cellCol ?? null;
  } else if (isEdit.value && props.item?.cellRow != null) {
    payload.cellRow = null;
    payload.cellCol = null;
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

.lcsc-row {
  display: flex;
  gap: 8px;
}

.lcsc-row .el-input {
  flex: 1;
}

.lcsc-preview {
  margin: 0;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  background: rgba(10, 122, 122, 0.08);
  color: var(--ink-700);
  font-size: 12px;
  line-height: 1.6;
}

.lcsc-preview a {
  margin-left: 6px;
  color: var(--primary);
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
