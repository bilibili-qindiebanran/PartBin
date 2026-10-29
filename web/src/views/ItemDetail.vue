<template>
  <div class="page">
    <div class="detail-head">
      <el-button text :icon="ArrowLeft" @click="goBack">返回库存</el-button>
      <div v-if="item && auth.canWrite" class="detail-head__actions">
        <el-button type="primary" @click="openMovement('in')">入库</el-button>
        <el-button @click="openMovement('out')">出库</el-button>
        <el-button @click="openMovement('adjust')">盘点</el-button>
        <el-button v-if="item.available > 0" @click="borrowVisible = true">借出</el-button>
        <el-button :icon="Edit" @click="dialogVisible = true">编辑</el-button>
        <el-button v-if="item.isArchived" @click="restoreItem">恢复</el-button>
        <el-button v-else type="danger" plain @click="archiveItem">归档</el-button>
      </div>
    </div>

    <div v-if="loading" v-loading="true" class="detail-loading card" />

    <EmptyState
      v-else-if="!item"
      title="物料不存在"
      :description="error || '它可能已被删除，或链接有误。'"
    >
      <template #icon><Box /></template>
      <el-button @click="goBack">返回库存</el-button>
    </EmptyState>

    <template v-else>
      <section class="detail-title">
        <span class="detail-title__icon"><el-icon><Box /></el-icon></span>
        <div class="detail-title__text">
          <h1>{{ item.name }}</h1>
          <p>{{ subtitle }}</p>
        </div>
        <div class="detail-title__tags">
          <el-tag v-if="item.isArchived" type="info" round>已归档</el-tag>
          <el-tag v-else-if="item.quantity === 0" type="danger" round>缺货</el-tag>
          <el-tag v-else-if="item.lowStock" type="warning" round>低库存</el-tag>
          <el-tag round effect="plain">
            {{ item.trackingMode === 'instance' ? '实例制' : '数量制' }}
          </el-tag>
        </div>
      </section>

      <section class="quant">
        <article class="quant__card card">
          <span>拥有</span>
          <strong class="num">{{ item.quantity }}</strong>
          <small>{{ item.unit }}</small>
        </article>
        <article class="quant__card card">
          <span>借出</span>
          <strong class="num">{{ item.lentQuantity }}</strong>
          <small>{{ item.unit }}</small>
        </article>
        <article class="quant__card card">
          <span>可用</span>
          <strong class="num">{{ item.available }}</strong>
          <small>{{ item.unit }}</small>
        </article>
      </section>

      <section class="detail-grid">
        <article class="card panel">
          <h3>基本信息</h3>
          <dl class="kv">
            <div>
              <dt>分类</dt>
              <dd>{{ item.categoryPath || '未分类' }}</dd>
            </div>
            <div>
              <dt>位置</dt>
              <dd>{{ item.locationPath || '未指定' }}</dd>
            </div>
            <div>
              <dt>编号</dt>
              <dd>{{ item.code || '—' }}</dd>
            </div>
            <div>
              <dt>厂商</dt>
              <dd>{{ item.manufacturer || '—' }}</dd>
            </div>
            <div>
              <dt>型号</dt>
              <dd>{{ item.model || '—' }}</dd>
            </div>
            <div>
              <dt>规格</dt>
              <dd class="pre">{{ item.spec || '—' }}</dd>
            </div>
            <div>
              <dt>低库存阈值</dt>
              <dd>{{ item.minQuantity }}</dd>
            </div>
            <div>
              <dt>单价</dt>
              <dd>{{ formatMoney(item.price) }}</dd>
            </div>
            <div>
              <dt>购买日期</dt>
              <dd>{{ item.purchaseDate || '—' }}</dd>
            </div>
            <div>
              <dt>更新时间</dt>
              <dd>{{ formatDate(item.updatedAt, { withTime: true }) }}</dd>
            </div>
          </dl>
        </article>

        <div class="side">
          <article class="card panel">
            <h3>备注</h3>
            <p class="note">{{ item.note || '暂无备注' }}</p>
          </article>

          <article class="card panel">
            <header class="photo-head">
              <h3>照片</h3>
              <el-button
                v-if="auth.canWrite"
                text
                size="small"
                :loading="uploading"
                @click="photoInput?.click()"
              >
                上传
              </el-button>
            </header>
            <input
              ref="photoInput"
              type="file"
              accept="image/*"
              capture="environment"
              class="hidden-input"
              @change="onPhotoSelected"
            />
            <p v-if="item.photos.length === 0" class="note">
              还没有照片。上传时会自动压缩到最长边 1600px。
            </p>
            <div v-else class="photo-grid">
              <div v-for="photo in item.photos" :key="photo.id" class="photo-item">
                <img :src="`/api/photos/${photo.id}`" :alt="item.name" loading="lazy" />
                <el-button
                  v-if="auth.canWrite"
                  class="photo-remove"
                  circle
                  size="small"
                  @click="removePhoto(photo)"
                >
                  ×
                </el-button>
              </div>
            </div>
          </article>
        </div>
      </section>

      <article v-if="item.trackingMode === 'instance'" class="card panel instances">
        <header class="timeline__head">
          <h3>实例（{{ instances.length }}）</h3>
          <el-button v-if="auth.canWrite" text @click="openBatch">批量登记</el-button>
        </header>

        <p v-if="instances.length === 0" class="note">
          还没有实例。批量登记后会写入一条入库流水。
        </p>
        <div v-else class="instances__table">
          <el-table :data="instances" size="small" empty-text="还没有实例">
            <el-table-column prop="assetNo" label="编号" min-width="120" />
            <el-table-column label="状态" width="96">
              <template #default="{ row }">
                <el-tag size="small" round :type="statusMeta(row.status).type">
                  {{ statusMeta(row.status).label }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="locationPath" label="位置" min-width="120" show-overflow-tooltip />
            <el-table-column prop="note" label="备注" min-width="120" show-overflow-tooltip />
            <el-table-column v-if="auth.canWrite" label="操作" width="90" align="right">
              <template #default="{ row }">
                <el-dropdown
                  v-if="!['lost', 'retired', 'lent'].includes(row.status)"
                  @command="(command) => changeStatus(row, command)"
                >
                  <el-button text size="small">状态</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="broken" :disabled="row.status === 'broken'">
                        标记维修
                      </el-dropdown-item>
                      <el-dropdown-item command="in_stock" :disabled="row.status === 'in_stock'">
                        恢复在库
                      </el-dropdown-item>
                      <el-dropdown-item command="lost" divided>丢失</el-dropdown-item>
                      <el-dropdown-item command="retired">退役</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </article>

      <article class="card panel timeline">
        <header class="timeline__head">
          <h3>出入库流水</h3>
          <el-button text :loading="loadingMovements" @click="loadMovements()">刷新</el-button>
        </header>

        <p v-if="!loadingMovements && movements.length === 0" class="note">
          还没有流水。入库、出库或盘点后会在这里留下记录。
        </p>

        <ul v-else class="timeline__list">
          <li v-for="movement in movements" :key="movement.id" class="timeline__item">
            <span class="timeline__dot" :class="`is-${movement.type}`" />
            <div class="timeline__body">
              <div class="timeline__row">
                <el-tag
                  size="small"
                  round
                  effect="plain"
                  :type="movementMeta(movement.type).type"
                >
                  {{ movementMeta(movement.type).label }}
                </el-tag>
                <strong
                  class="num"
                  :class="
                    movement.quantityDelta > 0
                      ? 'delta-plus'
                      : movement.quantityDelta < 0
                        ? 'delta-minus'
                        : 'muted'
                  "
                >
                  {{ movement.quantityDelta > 0 ? '+' : '' }}{{ movement.quantityDelta }}
                </strong>
                <span class="timeline__balance">余额 {{ movement.balanceAfter }}</span>
              </div>
              <p class="timeline__meta">
                {{ formatDate(movement.occurredAt, { withTime: true }) }} ·
                {{ movement.userName || '—' }}
                <span v-if="movement.note"> · {{ movement.note }}</span>
              </p>
            </div>
          </li>
        </ul>

        <div v-if="movementTotal > movements.length" class="timeline__more">
          <el-button text :loading="loadingMovements" @click="loadMovements({ append: true })">
            加载更多
          </el-button>
        </div>
      </article>
    </template>

    <ItemDialog
      v-if="item"
      v-model="dialogVisible"
      :item="item"
      :categories="dictionary.categoryOptions"
      :locations="dictionary.locationOptions"
      @saved="handleSaved"
    />

    <MovementDialog
      v-if="item"
      v-model="movementVisible"
      :item="item"
      :default-type="movementType"
      @saved="handleMovementSaved"
    />

    <BorrowDialog
      v-if="item"
      v-model="borrowVisible"
      :item="item"
      :instances="instances"
      @saved="handleBorrowSaved"
    />

    <el-dialog v-model="batch.visible" title="批量登记实例" width="min(420px, 92vw)" align-center>
      <div class="batch-form">
        <label class="field">
          <span>数量</span>
          <el-input-number v-model="batch.count" :min="1" :max="100" controls-position="right" class="control" />
        </label>
        <label class="field">
          <span>编号前缀</span>
          <el-input v-model="batch.prefix" maxlength="40" placeholder="如 RPI" />
        </label>
        <label class="field">
          <span>起始序号</span>
          <el-input-number v-model="batch.startAt" :min="1" :max="9999" controls-position="right" class="control" />
        </label>
      </div>
      <template #footer>
        <el-button @click="batch.visible = false">取消</el-button>
        <el-button type="primary" :loading="batch.saving" @click="submitBatch">登记</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, Box, Edit } from '@element-plus/icons-vue';
import EmptyState from '@/components/EmptyState.vue';
import ItemDialog from '@/components/ItemDialog.vue';
import MovementDialog from '@/components/MovementDialog.vue';
import BorrowDialog from '@/components/BorrowDialog.vue';
import { useAuthStore } from '@/stores/auth';
import { useDictionaryStore } from '@/stores/dictionary';
import { api, apiUpload } from '@/api/client';
import { compressImage } from '@/lib/photo';
import { formatDate, formatMoney } from '@/lib/format';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const dictionary = useDictionaryStore();

const item = ref(null);
const loading = ref(true);
const error = ref('');
const dialogVisible = ref(false);

const movementVisible = ref(false);
const movementType = ref('in');
const movements = ref([]);
const movementTotal = ref(0);
const movementPage = ref(1);
const loadingMovements = ref(false);

const instances = ref([]);
const borrowVisible = ref(false);
const batch = reactive({ visible: false, saving: false, count: 1, prefix: '', startAt: 1 });
const photoInput = ref(null);
const uploading = ref(false);

const STATUS_META = {
  in_stock: { label: '在库', type: 'success' },
  lent: { label: '借出', type: 'primary' },
  broken: { label: '维修', type: 'warning' },
  lost: { label: '丢失', type: 'danger' },
  retired: { label: '退役', type: 'info' },
};

function statusMeta(status) {
  return STATUS_META[status] ?? { label: status, type: 'info' };
}

const MOVEMENT_META = {
  in: { label: '入库', type: 'success' },
  out: { label: '出库', type: 'danger' },
  adjust: { label: '盘点', type: 'warning' },
  discard: { label: '报废', type: 'danger' },
  lost: { label: '丢失', type: 'danger' },
  borrow: { label: '借出', type: 'primary' },
  return: { label: '归还', type: 'success' },
};

function movementMeta(type) {
  return MOVEMENT_META[type] ?? { label: type, type: 'info' };
}

const subtitle = computed(() => {
  const parts = [item.value?.model, item.value?.code, item.value?.manufacturer].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '—';
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api(`/api/items/${route.params.id}`);
    item.value = data.item;
    if (data.item.trackingMode === 'instance') {
      await loadInstances();
    } else {
      instances.value = [];
    }
  } catch (requestError) {
    item.value = null;
    error.value = requestError.message || '加载失败';
  } finally {
    loading.value = false;
  }
}

function goBack() {
  router.push({ name: 'items' });
}

async function archiveItem() {
  try {
    await ElMessageBox.confirm(
      `归档后「${item.value.name}」不会出现在默认列表，但仍保留全部流水。`,
      '归档物料',
      { type: 'warning', confirmButtonText: '归档', cancelButtonText: '取消' },
    );
    const data = await api(`/api/items/${item.value.id}`, { method: 'DELETE' });
    item.value = data.item;
    ElMessage.success('已归档');
  } catch (requestError) {
    if (requestError === 'cancel' || requestError === 'close') return;
    ElMessage.error(requestError.message || '归档失败');
  }
}

async function restoreItem() {
  try {
    const data = await api(`/api/items/${item.value.id}/restore`, { method: 'POST' });
    item.value = data.item;
    ElMessage.success('已恢复');
  } catch (requestError) {
    ElMessage.error(requestError.message || '恢复失败');
  }
}

function handleSaved() {
  dialogVisible.value = false;
  load();
}

function openMovement(type) {
  movementType.value = type;
  movementVisible.value = true;
}

function handleMovementSaved() {
  movementVisible.value = false;
  load();
  loadMovements();
}

async function loadMovements({ append = false } = {}) {
  if (!route.params.id) return;
  loadingMovements.value = true;
  try {
    const nextPage = append ? movementPage.value + 1 : 1;
    const data = await api(
      `/api/items/${route.params.id}/movements?page=${nextPage}&pageSize=20`,
    );
    movements.value = append ? [...movements.value, ...data.data] : data.data;
    movementTotal.value = data.total;
    movementPage.value = nextPage;
  } catch (requestError) {
    ElMessage.error(requestError.message || '加载流水失败');
  } finally {
    loadingMovements.value = false;
  }
}

async function loadInstances() {
  if (!route.params.id) return;
  try {
    const data = await api(`/api/items/${route.params.id}/instances`);
    instances.value = data.data;
  } catch (requestError) {
    ElMessage.error(requestError.message || '加载实例失败');
  }
}

function openBatch() {
  batch.prefix = item.value?.code || 'ITEM';
  batch.count = 1;
  batch.startAt = instances.value.length + 1;
  batch.visible = true;
}

async function submitBatch() {
  if (!batch.prefix.trim()) {
    ElMessage.warning('请输入编号前缀');
    return;
  }
  batch.saving = true;
  try {
    const data = await api(`/api/items/${item.value.id}/instances/batch`, {
      method: 'POST',
      body: { count: batch.count, prefix: batch.prefix.trim(), startAt: batch.startAt },
    });
    ElMessage.success(`已登记 ${data.instances.length} 个实例`);
    batch.visible = false;
    await load();
  } catch (requestError) {
    ElMessage.error(requestError.message || '登记失败');
  } finally {
    batch.saving = false;
  }
}

async function changeStatus(instance, status) {
  try {
    if (status === 'lost' || status === 'retired') {
      await ElMessageBox.confirm(
        status === 'lost'
          ? '标记丢失后拥有量会减少 1，且不可恢复。'
          : '退役后拥有量会减少 1，且不可恢复。',
        status === 'lost' ? '标记丢失' : '退役实例',
        { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' },
      );
    }
    await api(`/api/instances/${instance.id}`, { method: 'PATCH', body: { status } });
    ElMessage.success('状态已更新');
    await load();
  } catch (requestError) {
    if (requestError === 'cancel' || requestError === 'close') return;
    ElMessage.error(requestError.message || '更新状态失败');
  }
}

async function handleBorrowSaved() {
  borrowVisible.value = false;
  await load();
}

async function onPhotoSelected(event) {
  const selected = event.target.files?.[0];
  event.target.value = '';
  if (!selected) return;

  uploading.value = true;
  try {
    const blob = await compressImage(selected);
    const formData = new FormData();
    formData.append('file', blob, 'photo.jpg');
    const data = await apiUpload('/api/photos', formData);
    const photoIds = [...item.value.photos.map((photo) => photo.id), data.photo.id];
    await api(`/api/items/${item.value.id}/photos`, {
      method: 'PUT',
      body: { photoIds },
    });
    await load();
    ElMessage.success('照片已上传');
  } catch (requestError) {
    ElMessage.error(requestError.message || '上传失败');
  } finally {
    uploading.value = false;
  }
}

async function removePhoto(photo) {
  try {
    const photoIds = item.value.photos
      .filter((entry) => entry.id !== photo.id)
      .map((entry) => entry.id);
    await api(`/api/items/${item.value.id}/photos`, {
      method: 'PUT',
      body: { photoIds },
    });
    await load();
  } catch (requestError) {
    ElMessage.error(requestError.message || '删除照片失败');
  }
}

watch(
  () => route.params.id,
  () => {
    load();
    loadMovements();
  },
);

onMounted(async () => {
  await Promise.allSettled([dictionary.load(), load(), loadMovements()]);
});
</script>

<style scoped>
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.detail-head__actions {
  display: flex;
  gap: var(--space-2);
}

.detail-loading {
  min-height: 240px;
}

.detail-title {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
  padding: var(--space-5);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background:
    radial-gradient(420px 180px at 88% 10%, rgba(79, 209, 197, 0.12), transparent 70%),
    #fff;
}

.detail-title__icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 28px;
}

.detail-title__text {
  flex: 1;
  min-width: 0;
}

.detail-title__text h1 {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
}

.detail-title__text p {
  margin-top: 4px;
  overflow: hidden;
  color: var(--ink-600);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-title__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.quant {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.quant__card {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: var(--space-4);
}

.quant__card span {
  color: var(--ink-400);
  font-size: 12px;
}

.quant__card strong {
  margin-left: auto;
  font-size: 28px;
  font-weight: 600;
  line-height: 1;
}

.quant__card small {
  color: var(--ink-400);
  font-size: 11px;
}

.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: var(--space-4);
}

.panel {
  padding: var(--space-5);
}

.panel h3 {
  margin-bottom: var(--space-4);
  font-size: 14px;
  font-weight: 600;
}

.side {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.kv {
  display: grid;
  gap: var(--space-3);
}

.kv > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
  padding-bottom: var(--space-3);
  border-bottom: 1px dashed var(--line);
}

.kv > div:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.kv dt {
  flex-shrink: 0;
  color: var(--ink-400);
  font-size: 12px;
}

.kv dd {
  font-size: 13px;
  text-align: right;
  white-space: pre-wrap;
  word-break: break-word;
}

.note {
  color: var(--ink-600);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.timeline {
  margin-top: var(--space-4);
}

.instances {
  margin-top: var(--space-4);
}

.photo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}

.photo-head h3 {
  margin-bottom: 0;
}

.hidden-input {
  display: none;
}

.photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
}

.photo-item {
  position: relative;
  overflow: hidden;
  aspect-ratio: 1;
  border-radius: 10px;
  background: #f3f7f7;
}

.photo-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.photo-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  opacity: 0.85;
}

.instances__table {
  overflow-x: auto;
}

.batch-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.batch-form .field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--ink-600);
  font-size: 12px;
}

.batch-form .control {
  width: 100%;
}

.timeline__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-4);
}

.timeline__head h3 {
  margin-bottom: 0;
}

.timeline__list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.timeline__item {
  display: flex;
  gap: 10px;
}

.timeline__dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--ink-400);
}

.timeline__dot.is-in,
.timeline__dot.is-return {
  background: var(--success);
}

.timeline__dot.is-out,
.timeline__dot.is-discard,
.timeline__dot.is-lost {
  background: var(--danger);
}

.timeline__dot.is-adjust {
  background: var(--warning);
}

.timeline__dot.is-borrow {
  background: #3b82f6;
}

.timeline__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.timeline__balance {
  color: var(--ink-400);
  font-size: 11px;
}

.timeline__meta {
  margin-top: 3px;
  color: var(--ink-400);
  font-size: 11px;
}

.timeline__more {
  margin-top: var(--space-3);
  text-align: center;
}

.delta-plus {
  color: var(--success);
}

.delta-minus {
  color: var(--danger);
}

@media (max-width: 960px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 767px) {
  .detail-title {
    align-items: flex-start;
    padding: var(--space-4);
  }

  .detail-title__icon {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    font-size: 22px;
  }

  .detail-title__text h1 {
    font-size: 17px;
  }

  .detail-title__tags {
    display: none;
  }

  .quant__card strong {
    font-size: 22px;
  }

  .detail-head {
    margin-bottom: var(--space-3);
  }
}
</style>
