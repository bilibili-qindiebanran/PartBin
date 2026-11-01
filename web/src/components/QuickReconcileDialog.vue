<template>
  <el-dialog
    v-model="visible"
    class="quick-reconcile"
    :title="title"
    width="min(620px, 94vw)"
    :fullscreen="isMobile"
    align-center
    destroy-on-close
    @closed="handleClosed"
  >
    <!-- 第一步：扫码 -->
    <div v-if="step === 'scan'" class="qr__body">
      <p class="hint">
        扫立创 / 嘉立创标签上的二维码，先确认这个料号在库里对应哪条物料，再顺手把信息改对。
      </p>

      <QrScanner :key="scanSession" @detected="handleDetected" />

      <div class="manual">
        <el-button link :icon="EditPen" @click="manualOpen = !manualOpen">
          {{ manualOpen ? '收起手动输入' : '摄像头用不了？手动输入料号' }}
        </el-button>
        <div v-if="manualOpen" class="manual__form">
          <el-input v-model="manualCode" maxlength="64" placeholder="立创料号，如 C14663" clearable />
          <el-button type="primary" :loading="loading" @click="submitManual">开始对料</el-button>
        </div>
      </div>
    </div>

    <!-- 第二步：确认 / 修改 -->
    <div v-else v-loading="loading" class="qr__body">
      <div class="code-bar">
        <div>
          <strong class="code-bar__code">{{ preview.code }}</strong>
          <el-tag v-if="preview.part?.stock != null" size="small" type="info" effect="plain">
            商城库存 {{ preview.part.stock }}
          </el-tag>
        </div>
        <el-button link type="primary" @click="backToScan">重新扫码</el-button>
      </div>

      <div v-if="preview.part" class="part">
        <p class="part__name">{{ preview.part.name }}</p>
        <p class="hint">
          <template v-if="preview.part.model">型号 {{ preview.part.model }}</template>
          <template v-if="preview.part.package"> · 封装 {{ preview.part.package }}</template>
          <template v-if="preview.part.manufacturer"> · {{ preview.part.manufacturer }}</template>
        </p>
      </div>
      <p v-else class="hint hint--warn">
        {{ preview.warning || '没查到立创信息，可以直接按库内已有物料匹配或新建。' }}
      </p>

      <el-alert
        v-if="preview.archivedItem"
        type="warning"
        :closable="false"
        show-icon
        :title="`该料号对应的物料「${preview.archivedItem.name}」已归档，恢复后才能继续对料`"
      />

      <!-- 已匹配：直接编辑 -->
      <template v-if="preview.matched">
        <div class="matched">
          <el-tag type="success" size="small" effect="plain">已匹配</el-tag>
          <div class="matched__info">
            <strong>{{ preview.matched.name }}</strong>
            <span class="hint">
              库存 {{ preview.matched.quantity }} {{ preview.matched.unit }}
              <template v-if="preview.matched.locationPath">
                · {{ preview.matched.locationPath }}
              </template>
              <template v-if="preview.matched.cellLabel">· {{ preview.matched.cellLabel }}</template>
            </span>
          </div>
          <el-button link type="primary" @click="openDetail">查看详情</el-button>
        </div>

        <el-form label-position="top" class="form-grid">
          <el-form-item label="名称">
            <el-input v-model="form.name" maxlength="200" />
          </el-form-item>
          <el-form-item label="型号">
            <el-input v-model="form.model" maxlength="120" placeholder="可留空" />
          </el-form-item>
          <el-form-item label="封装">
            <el-input v-model="form.package" maxlength="60" />
          </el-form-item>
          <el-form-item label="耐压">
            <el-input v-model="form.voltage" maxlength="40" placeholder="如 50V" />
          </el-form-item>
          <el-form-item label="单位">
            <el-input v-model="form.unit" maxlength="10" />
          </el-form-item>
          <el-form-item label="低库存阈值">
            <el-input-number
              v-model="form.minQuantity"
              :min="0"
              :max="1000000"
              controls-position="right"
              class="full-control"
            />
          </el-form-item>
          <el-form-item label="位置" class="form-grid__full">
            <el-tree-select
              v-model="form.locationId"
              :data="locations"
              check-strictly
              clearable
              filterable
              :render-after-expand="false"
              placeholder="不指定位置"
              class="full-control"
              @change="onLocationChange"
            />
          </el-form-item>
          <template v-if="selectedLocation?.isGrid">
            <el-form-item :label="`格位行（1–${selectedLocation.gridRows}）`">
              <el-select v-model="form.cellRow" clearable placeholder="不指定" class="full-control">
                <el-option v-for="row in selectedLocation.gridRows" :key="row" :label="row" :value="row" />
              </el-select>
            </el-form-item>
            <el-form-item :label="`格位列（1–${selectedLocation.gridCols}）`">
              <el-select v-model="form.cellCol" clearable placeholder="不指定" class="full-control">
                <el-option v-for="col in selectedLocation.gridCols" :key="col" :label="col" :value="col" />
              </el-select>
            </el-form-item>
          </template>
          <el-form-item label="备注" class="form-grid__full">
            <el-input v-model="form.note" type="textarea" :rows="2" maxlength="2000" />
          </el-form-item>
        </el-form>
      </template>

      <!-- 没匹配上：手动匹配 或 新建 -->
      <template v-else>
        <el-radio-group v-model="mode" class="mode">
          <el-radio-button value="link">手动匹配已有物料</el-radio-button>
          <el-radio-button value="create">新建物料</el-radio-button>
        </el-radio-group>

        <template v-if="mode === 'link'">
          <p class="hint">
            选一条库内物料，把料号 {{ preview.code }} 绑定上去；之后扫同样的标签会直接命中。
          </p>

          <el-table
            :data="candidates"
            height="220"
            highlight-current-row
            empty-text="没有候选，试试下面的搜索"
            @current-change="(row) => row && (linkTarget = row)"
          >
            <el-table-column prop="name" label="名称" min-width="200" />
            <el-table-column prop="model" label="型号" width="120" />
            <el-table-column prop="package" label="封装" width="90" />
            <el-table-column prop="quantity" label="库存" width="76" align="right" />
          </el-table>

          <div class="search">
            <el-input
              v-model="search.q"
              placeholder="搜索名称 / 型号 / 立创料号"
              clearable
              :prefix-icon="Search"
              @input="onSearchInput"
            />
          </div>
          <el-table
            v-if="search.results.length > 0"
            :data="search.results"
            height="200"
            highlight-current-row
            @current-change="(row) => row && (linkTarget = row)"
          >
            <el-table-column prop="name" label="名称" min-width="200" />
            <el-table-column prop="model" label="型号" width="120" />
            <el-table-column prop="package" label="封装" width="90" />
            <el-table-column prop="lcscCode" label="立创" width="100" />
          </el-table>

          <p v-if="linkTarget" class="hint hint--ok">
            将把 {{ preview.code }} 绑定到「{{ linkTarget.name }}」
            <template v-if="linkTarget.lcscCode">（会先覆盖原料号 {{ linkTarget.lcscCode }}）</template>
          </p>
        </template>

        <el-form v-else label-position="top" class="form-grid">
          <el-form-item label="名称">
            <el-input v-model="form.name" maxlength="200" />
          </el-form-item>
          <el-form-item label="型号">
            <el-input v-model="form.model" maxlength="120" placeholder="可留空" />
          </el-form-item>
          <el-form-item label="厂商">
            <el-input v-model="form.manufacturer" maxlength="120" />
          </el-form-item>
          <el-form-item label="封装">
            <el-input v-model="form.package" maxlength="60" />
          </el-form-item>
          <el-form-item label="初始数量">
            <el-input-number
              v-model="form.quantity"
              :min="0"
              :max="1000000"
              controls-position="right"
              class="full-control"
            />
          </el-form-item>
          <el-form-item label="单位">
            <el-input v-model="form.unit" maxlength="10" />
          </el-form-item>
          <el-form-item label="位置" class="form-grid__full">
            <el-tree-select
              v-model="form.locationId"
              :data="locations"
              check-strictly
              clearable
              filterable
              :render-after-expand="false"
              placeholder="不指定位置"
              class="full-control"
              @change="onLocationChange"
            />
          </el-form-item>
          <template v-if="selectedLocation?.isGrid">
            <el-form-item :label="`格位行（1–${selectedLocation.gridRows}）`">
              <el-select v-model="form.cellRow" clearable placeholder="不指定" class="full-control">
                <el-option v-for="row in selectedLocation.gridRows" :key="row" :label="row" :value="row" />
              </el-select>
            </el-form-item>
            <el-form-item :label="`格位列（1–${selectedLocation.gridCols}）`">
              <el-select v-model="form.cellCol" clearable placeholder="不指定" class="full-control">
                <el-option v-for="col in selectedLocation.gridCols" :key="col" :label="col" :value="col" />
              </el-select>
            </el-form-item>
          </template>
          <el-form-item label="规格" class="form-grid__full">
            <el-input v-model="form.spec" type="textarea" :rows="2" maxlength="2000" />
          </el-form-item>
        </el-form>
      </template>
    </div>

    <template #footer>
      <template v-if="step === 'scan'">
        <el-button @click="close">取消</el-button>
      </template>
      <template v-else-if="preview.matched">
        <el-button @click="backToScan">返回扫码</el-button>
        <el-button type="primary" :loading="saving" @click="saveMatched(true)">保存并继续</el-button>
        <el-button :loading="saving" @click="saveMatched(false)">保存</el-button>
      </template>
      <template v-else-if="mode === 'link'">
        <el-button @click="backToScan">返回扫码</el-button>
        <el-button type="primary" :disabled="!linkTarget" :loading="saving" @click="confirmLink">
          绑定并编辑
        </el-button>
      </template>
      <template v-else>
        <el-button @click="backToScan">返回扫码</el-button>
        <el-button type="primary" :loading="saving" @click="createItem(true)">创建并继续</el-button>
        <el-button :loading="saving" @click="createItem(false)">创建</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { EditPen, Search } from '@element-plus/icons-vue';
import QrScanner from '@/components/QrScanner.vue';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { api } from '@/api/client';
import { normalizeLcscCode, parseLcscQr } from '@/lib/lcsc-qr';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  locations: { type: Array, default: () => [] },
});

const emit = defineEmits(['update:modelValue', 'saved']);

const { isMobile } = useBreakpoint();
const router = useRouter();

const step = ref('scan');
const scanSession = ref(0);
const loading = ref(false);
const saving = ref(false);
const manualOpen = ref(false);
const manualCode = ref('');
const preview = ref({ code: '', part: null, matched: null, candidates: [], warning: null });
const mode = ref('link');
const linkTarget = ref(null);

const form = reactive(emptyForm());
const search = reactive({ q: '', results: [] });
let searchTimer = null;

function emptyForm() {
  return {
    name: '',
    model: '',
    manufacturer: '',
    package: '',
    voltage: '',
    spec: '',
    unit: '个',
    quantity: 0,
    minQuantity: 0,
    locationId: null,
    cellRow: null,
    cellCol: null,
    note: '',
  };
}

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const title = computed(() =>
  step.value === 'scan' ? '快速对料 · 扫描标签' : '快速对料 · 确认物料',
);

/** 位置树扁平化，便于回显当前选中节点的网格尺寸 */
const locationMap = computed(() => {
  const map = new Map();
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      map.set(node.value, node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(props.locations);
  return map;
});

const selectedLocation = computed(() =>
  form.locationId == null ? null : locationMap.value.get(form.locationId) ?? null,
);

const candidates = computed(() => preview.value.candidates ?? []);

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    step.value = 'scan';
    scanSession.value = 0;
    preview.value = { code: '', part: null, matched: null, candidates: [], warning: null };
    linkTarget.value = null;
    manualOpen.value = false;
    manualCode.value = '';
    Object.assign(form, emptyForm());
    search.q = '';
    search.results = [];
  },
);

function close() {
  visible.value = false;
}

function handleClosed() {
  preview.value = { code: '', part: null, matched: null, candidates: [], warning: null };
}

function backToScan() {
  step.value = 'scan';
  scanSession.value += 1;
  linkTarget.value = null;
  Object.assign(form, emptyForm());
  search.q = '';
  search.results = [];
}

function openDetail() {
  if (!preview.value.matched) return;
  visible.value = false;
  router.push(`/items/${preview.value.matched.id}`);
}

function onLocationChange() {
  const node = selectedLocation.value;
  if (!node?.isGrid) {
    form.cellRow = null;
    form.cellCol = null;
  }
}

async function handleDetected(text) {
  const parsed = parseLcscQr(text);
  if (!parsed) {
    ElMessage.warning('没有识别出立创料号，请对准标签重试');
    backToScan();
    return;
  }
  await loadPreview(parsed.code);
}

async function submitManual() {
  const code = normalizeLcscCode(manualCode.value);
  if (!code) {
    ElMessage.warning('请输入 C 开头的立创料号');
    return;
  }
  await loadPreview(code);
}

/** 用预览数据填充表单 */
function fillForm({ matched, part }) {
  Object.assign(form, emptyForm(), {
    name: matched?.name ?? part?.name ?? preview.value.code,
    model: matched?.model ?? part?.model ?? '',
    manufacturer: matched?.manufacturer ?? part?.manufacturer ?? '',
    package: matched?.package ?? part?.package ?? '',
    voltage: matched?.voltage ?? '',
    spec: matched?.spec ?? part?.description ?? '',
    unit: matched?.unit ?? '个',
    quantity: matched?.quantity ?? 0,
    minQuantity: matched?.minQuantity ?? 0,
    locationId: matched?.locationId ?? null,
    cellRow: matched?.cellRow ?? null,
    cellCol: matched?.cellCol ?? null,
    note: matched?.note ?? '',
  });
}

async function loadPreview(code) {
  loading.value = true;
  try {
    const data = await api('/api/lcsc/reconcile/preview', {
      method: 'POST',
      body: { code },
    });
    if (data.warning) ElMessage.warning(data.warning);
    preview.value = data;
    linkTarget.value = data.candidates[0] ?? null;
    mode.value = data.candidates.length > 0 ? 'link' : 'create';
    fillForm(data);
    step.value = 'result';
  } catch (error) {
    if (error.status === 400) {
      ElMessage.error(error.message || '料号格式不正确');
      return;
    }
    ElMessage.warning(error.message || '查询失败，可以手动输入');
  } finally {
    loading.value = false;
  }
}

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 200);
}

async function runSearch() {
  const keyword = search.q.trim();
  if (!keyword) {
    search.results = [];
    return;
  }
  try {
    const data = await api(`/api/items?pageSize=10&q=${encodeURIComponent(keyword)}`);
    search.results = data.data;
  } catch (error) {
    search.results = [];
    ElMessage.error(error.message || '搜索失败');
  }
}

function locationPayload() {
  const payload = { locationId: form.locationId ?? null };
  if (form.locationId != null && selectedLocation.value?.isGrid) {
    payload.cellRow = form.cellRow ?? null;
    payload.cellCol = form.cellCol ?? null;
  }
  return payload;
}

function itemPayload() {
  return {
    name: form.name.trim(),
    model: form.model.trim(),
    manufacturer: form.manufacturer.trim(),
    package: form.package.trim(),
    voltage: form.voltage.trim(),
    spec: form.spec.trim(),
    unit: form.unit.trim() || '个',
    minQuantity: form.minQuantity ?? 0,
    note: form.note.trim(),
    ...locationPayload(),
  };
}

/** 保存已匹配物料的修改（料号为空时顺手补上） */
async function saveMatched(keepScanning) {
  const item = preview.value.matched;
  if (!item) return;
  if (!form.name.trim()) {
    ElMessage.warning('请填写物料名称');
    return;
  }

  const payload = itemPayload();
  if (!item.lcscCode) {
    payload.lcscCode = preview.value.code;
    payload.lcscMatched = true;
  }

  saving.value = true;
  try {
    await api(`/api/items/${item.id}`, { method: 'PATCH', body: payload });
    ElMessage.success(`已更新 ${payload.name}`);
    emit('saved');
    if (keepScanning) backToScan();
    else close();
  } catch (error) {
    ElMessage.error(error.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

/** 手动匹配：绑定料号后再进入编辑 */
async function confirmLink() {
  if (!linkTarget.value) return;

  saving.value = true;
  try {
    const data = await api('/api/lcsc/reconcile/link', {
      method: 'POST',
      body: { code: preview.value.code, itemId: linkTarget.value.itemId ?? linkTarget.value.id },
    });
    ElMessage.success(`已把 ${preview.value.code} 绑定到「${data.item.name}」`);
    preview.value = { ...preview.value, matched: data.item, candidates: [] };
    linkTarget.value = null;
    fillForm({ matched: data.item, part: preview.value.part });
    emit('saved');
  } catch (error) {
    ElMessage.error(error.message || '绑定失败');
  } finally {
    saving.value = false;
  }
}

async function createItem(keepScanning) {
  if (!form.name.trim()) {
    ElMessage.warning('请填写物料名称');
    return;
  }

  saving.value = true;
  try {
    const payload = {
      ...itemPayload(),
      quantity: form.quantity ?? 0,
      trackingMode: 'quantity',
      lcscCode: preview.value.code,
      lcscMatched: true,
      initialNote: `快速对料 ${preview.value.code}`,
    };
    const data = await api('/api/items', { method: 'POST', body: payload });
    ElMessage.success(`已新建 ${data.item.name}`);
    emit('saved');
    if (keepScanning) backToScan();
    else close();
  } catch (error) {
    ElMessage.error(error.message || '创建失败');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.qr__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hint {
  margin: 0;
  color: var(--ink-600);
  font-size: 12px;
  line-height: 1.6;
}

.hint--warn {
  color: var(--el-color-warning);
}

.hint--ok {
  color: var(--primary);
}

.manual {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.manual__form {
  display: flex;
  gap: 10px;
}

.manual__form :deep(.el-input) {
  flex: 1;
}

.code-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: rgba(10, 122, 122, 0.06);
}

.code-bar__code {
  margin-right: 8px;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.3px;
}

.part__name {
  margin: 0 0 2px;
  color: var(--ink-900);
  font-size: 13px;
  font-weight: 600;
}

.matched {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}

.matched__info {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.matched__info strong {
  font-size: 13px;
}

.mode {
  align-self: flex-start;
}

.search {
  margin-top: 2px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 12px;
}

.form-grid__full {
  grid-column: 1 / -1;
}

.form-grid :deep(.el-form-item) {
  margin-bottom: 8px;
}

.full-control {
  width: 100%;
}

@media (max-width: 767px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .form-grid__full {
    grid-column: auto;
  }

  .manual__form {
    flex-direction: column;
  }
}
</style>
