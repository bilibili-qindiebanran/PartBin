<template>
  <el-dialog
    v-model="visible"
    class="quick-in"
    :title="title"
    width="min(560px, 94vw)"
    :fullscreen="isMobile"
    align-center
    destroy-on-close
    @closed="handleClosed"
  >
    <!-- 第一步：选位置 -->
    <div v-if="step === 'location'" class="quick-in__body">
      <p class="hint">
        先选好这批料要放的位置；分类盒（带网格的盒）需要在物料详情里指定格位，这里不显示。
      </p>
      <label class="field">
        <span>入库位置</span>
        <el-tree-select
          v-model="locationId"
          :data="locationOptions"
          check-strictly
          clearable
          filterable
          :render-after-expand="false"
          placeholder="不指定位置（默认）"
          class="control"
        />
      </label>
      <p class="hint">不选表示暂不入位，之后可以在物料详情里补。</p>
    </div>

    <!-- 第二步：扫码 -->
    <div v-else-if="step === 'scan'" class="quick-in__body">
      <div class="location-bar">
        <span>入库位置：{{ locationLabel }}</span>
        <el-button link type="primary" @click="step = 'location'">修改</el-button>
      </div>

      <QrScanner :key="scanSession" @detected="handleDetected" />

      <div class="manual">
        <el-button link :icon="EditPen" @click="manualOpen = !manualOpen">
          {{ manualOpen ? '收起手动输入' : '摄像头用不了？手动输入料号' }}
        </el-button>
        <div v-if="manualOpen" class="manual__form">
          <el-input
            v-model="manualCode"
            maxlength="64"
            placeholder="立创料号，如 C49329911"
            clearable
          />
          <el-input-number
            v-model="manualQuantity"
            :min="1"
            :max="1000000"
            :step="1"
            controls-position="right"
            class="manual__qty"
          />
          <el-button type="primary" :loading="previewLoading" @click="submitManual">
            下一步
          </el-button>
        </div>
      </div>
    </div>

    <!-- 第三步：预览与修改 -->
    <div v-else v-loading="previewLoading" class="quick-in__body">
      <div class="location-bar">
        <span>入库位置：{{ locationLabel }}</span>
        <el-button link type="primary" @click="step = 'location'">修改</el-button>
      </div>

      <div class="scan-summary">
        <p>
          <strong>{{ preview?.qr.code }}</strong>
          <template v-if="preview?.qr.quantity"> · 标签数量 {{ preview.qr.quantity }}</template>
          <template v-if="preview?.qr.orderNo"> · 订单 {{ preview.qr.orderNo }}</template>
        </p>
        <p v-if="preview?.part" class="hint">
          {{ preview.part.name }}
          <template v-if="preview.part.package"> · {{ preview.part.package }}</template>
          <template v-if="preview.part.stock != null"> · 商城库存 {{ preview.part.stock }}</template>
        </p>
        <p v-else class="hint hint--warn">没查到立创信息，请手动补全名称与规格。</p>
      </div>

      <div v-if="preview?.existing" class="existing">
        <p class="existing__title">
          库存里已有这个料号：<strong>{{ preview.existing.name }}</strong>
          （当前 {{ preview.existing.quantity }} {{ preview.existing.unit }}<template
            v-if="preview.existing.locationPath"
          >，位置 {{ preview.existing.locationPath }}</template>）
        </p>
        <el-radio-group v-model="form.mode">
          <el-radio value="add" :disabled="preview.existing.trackingMode === 'instance'">
            累加到已有物料
          </el-radio>
          <el-radio value="create">新建一条物料</el-radio>
        </el-radio-group>
        <p v-if="preview.existing.trackingMode === 'instance'" class="hint">
          实例制物料不能直接加数量，请选择新建。
        </p>
      </div>

      <div class="form-grid">
        <label class="field">
          <span>入库数量 <b>*</b></span>
          <el-input-number
            v-model="form.quantity"
            :min="1"
            :max="1000000"
            :step="1"
            controls-position="right"
            class="full-control"
          />
        </label>

        <label class="field">
          <span>单位</span>
          <el-input v-model="form.unit" maxlength="10" placeholder="个 / 块 / 包" />
        </label>

        <template v-if="form.mode === 'create'">
          <label class="field field--full">
            <span>名称 <b>*</b></span>
            <el-input v-model="form.name" maxlength="200" placeholder="物料名称" />
          </label>

          <label class="field">
            <span>型号</span>
            <el-input v-model="form.model" maxlength="120" />
          </label>

          <label class="field">
            <span>厂商</span>
            <el-input v-model="form.manufacturer" maxlength="120" />
          </label>

          <label class="field">
            <span>封装</span>
            <el-input v-model="form.package" maxlength="60" />
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
          </label>

          <label class="field field--full">
            <span>规格</span>
            <el-input v-model="form.spec" type="textarea" :rows="2" maxlength="2000" />
          </label>
        </template>

        <label class="field field--full">
          <span>备注</span>
          <el-input
            v-model="form.note"
            type="textarea"
            :rows="2"
            maxlength="2000"
            placeholder="默认写入立创订单号"
          />
        </label>
      </div>
    </div>

    <template #footer>
      <template v-if="step === 'location'">
        <el-button @click="close">取消</el-button>
        <el-button type="primary" @click="startScan">开始扫码</el-button>
      </template>
      <template v-else-if="step === 'scan'">
        <el-button @click="step = 'location'">上一步</el-button>
      </template>
      <template v-else>
        <el-button @click="backToScan">取消入库</el-button>
        <el-button :loading="saving" @click="submit(false)">单次入库</el-button>
        <el-button type="primary" :loading="saving" @click="submit(true)">
          继续入库
        </el-button>
      </template>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { EditPen } from '@element-plus/icons-vue';
import QrScanner from '@/components/QrScanner.vue';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { api } from '@/api/client';
import { normalizeLcscCode, parseLcscQr } from '@/lib/lcsc-qr';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 位置树（与字典 store 的 locationOptions 同结构） */
  locations: { type: Array, default: () => [] },
});

const emit = defineEmits(['update:modelValue', 'saved']);

const { isMobile } = useBreakpoint();

const step = ref('location');
const locationId = ref(null);
const scanSession = ref(0);
const previewLoading = ref(false);
const saving = ref(false);
const preview = ref(null);
const manualOpen = ref(false);
const manualCode = ref('');
const manualQuantity = ref(1);

const form = reactive({
  mode: 'create',
  quantity: 1,
  name: '',
  model: '',
  manufacturer: '',
  package: '',
  spec: '',
  unit: '个',
  minQuantity: 0,
  note: '',
});

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const title = computed(() => {
  if (step.value === 'location') return '快速入库 · 选择位置';
  if (step.value === 'scan') return '快速入库 · 扫描标签';
  return '快速入库 · 确认信息';
});

/** 位置树：去掉分类盒（带网格）及其子树 */
function stripGrid(nodes) {
  return nodes
    .filter((node) => !node.isGrid)
    .map((node) => ({
      ...node,
      children: node.children?.length ? stripGrid(node.children) : undefined,
    }));
}

const locationOptions = computed(() => stripGrid(props.locations ?? []));

const locationPaths = computed(() => {
  const map = new Map();
  const walk = (nodes, prefix) => {
    for (const node of nodes) {
      const path = prefix ? `${prefix} / ${node.label}` : node.label;
      map.set(node.value, path);
      if (node.children?.length) walk(node.children, path);
    }
  };
  walk(locationOptions.value, '');
  return map;
});

const locationLabel = computed(
  () => locationPaths.value.get(locationId.value) ?? '不指定位置（默认）',
);

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    step.value = 'location';
    locationId.value = null;
    scanSession.value = 0;
    preview.value = null;
    previewLoading.value = false;
    saving.value = false;
    manualOpen.value = false;
    manualCode.value = '';
    manualQuantity.value = 1;
  },
);

function startScan() {
  step.value = 'scan';
  scanSession.value += 1;
}

function backToScan() {
  step.value = 'scan';
  scanSession.value += 1;
  preview.value = null;
}

function close() {
  visible.value = false;
}

function handleClosed() {
  preview.value = null;
}

/** 扫码结果 → 解析 → 查立创 → 进入预览 */
async function handleDetected(text) {
  const parsed = parseLcscQr(text);
  if (!parsed) {
    ElMessage.warning('没有识别出立创料号，请对准标签重试');
    backToScan();
    return;
  }
  await loadPreview(parsed);
}

async function submitManual() {
  const code = normalizeLcscCode(manualCode.value);
  if (!code) {
    ElMessage.warning('请输入 C 开头的立创料号');
    return;
  }
  const quantity = Number.parseInt(manualQuantity.value, 10);
  await loadPreview({
    raw: '',
    code,
    quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 1,
    orderNo: null,
    model: null,
    manufacturer: null,
  });
}

async function loadPreview(qr) {
  previewLoading.value = true;
  try {
    const data = await api('/api/lcsc/quick-in/preview', {
      method: 'POST',
      body: { code: qr.code },
    });
    if (data.warning) ElMessage.warning(data.warning);
    applyPreview(qr, data.part ?? null, data.existing ?? null);
  } catch (error) {
    // 料号格式错误时留在扫码页重来；其余（限速/网络）仍进入预览手动补全
    if (error.status === 400) {
      ElMessage.error(error.message || '料号格式不正确');
      return;
    }
    ElMessage.warning(error.message || '查询立创信息失败，可以手动补全');
    applyPreview(qr, null, null);
  } finally {
    previewLoading.value = false;
  }
}

function applyPreview(qr, part, existing) {
  const canAdd = existing && existing.trackingMode !== 'instance';
  Object.assign(form, {
    mode: canAdd ? 'add' : 'create',
    quantity: qr.quantity ?? 1,
    name: part?.name || qr.model || qr.code,
    model: qr.model || part?.model || '',
    manufacturer: part?.manufacturer || qr.manufacturer || '',
    package: part?.package || '',
    spec: part?.description || '',
    unit: existing?.unit || '个',
    minQuantity: existing?.minQuantity ?? 0,
    note: qr.orderNo ? `立创订单 ${qr.orderNo}` : '',
  });
  preview.value = { qr, part, existing };
  step.value = 'preview';
}

async function submit(keepScanning) {
  const quantity = Number.parseInt(form.quantity, 10);
  if (!Number.isInteger(quantity) || quantity < 1) {
    ElMessage.warning('入库数量必须是正整数');
    return;
  }
  if (form.mode === 'create' && !form.name.trim()) {
    ElMessage.warning('请填写物料名称');
    return;
  }

  const code = preview.value?.qr.code;
  const orderNo = preview.value?.qr.orderNo ?? null;
  const payload =
    form.mode === 'add'
      ? {
          mode: 'add',
          code,
          itemId: preview.value.existing.id,
          quantity,
          locationId: locationId.value,
          orderNo,
          note: form.note.trim(),
        }
      : {
          mode: 'create',
          code,
          quantity,
          locationId: locationId.value,
          orderNo,
          item: {
            name: form.name.trim(),
            model: form.model.trim(),
            manufacturer: form.manufacturer.trim(),
            package: form.package.trim(),
            spec: form.spec.trim(),
            unit: form.unit.trim() || '个',
            minQuantity: form.minQuantity ?? 0,
            note: form.note.trim(),
          },
        };

  saving.value = true;
  try {
    const result = await api('/api/lcsc/quick-in', { method: 'POST', body: payload });
    ElMessage.success(
      `已入库 ${result.item.name} · ${quantity} ${result.item.unit || '个'}`,
    );
    emit('saved');
    if (keepScanning) {
      backToScan();
    } else {
      close();
    }
  } catch (error) {
    ElMessage.error(error.message || '入库失败');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.quick-in__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hint {
  margin: 0;
  color: var(--ink-600);
  font-size: 12px;
}

.hint--warn {
  color: var(--el-color-warning);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

.field > span {
  color: var(--ink-700);
}

.field b {
  color: var(--el-color-danger);
}

.control,
.full-control {
  width: 100%;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
}

.field--full {
  grid-column: 1 / -1;
}

.location-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--surface-2, #f5f6f8);
  font-size: 13px;
}

.scan-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--border-1, #e4e7ed);
  border-radius: 8px;
  font-size: 13px;
}

.scan-summary p {
  margin: 0;
}

.existing {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 8px;
  background: var(--surface-2, #f5f6f8);
  font-size: 13px;
}

.existing__title {
  margin: 0;
}

.manual {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.manual__form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.manual__form :deep(.el-input) {
  flex: 1 1 180px;
}

.manual__qty {
  width: 120px;
}

@media (max-width: 767px) {
  .form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
