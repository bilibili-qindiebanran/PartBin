<template>
  <div class="page">
    <div class="detail-head">
      <el-button text :icon="ArrowLeft" @click="goBack">返回库存</el-button>
      <div v-if="item && auth.canWrite" class="detail-head__actions">
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
            <h3>流水与照片</h3>
            <p class="note">
              出入库与盘点流水将在 M3 接入；照片上传将在 M5 接入。当前数量以初始入库为准。
            </p>
          </article>

          <article v-if="item.trackingMode === 'instance'" class="card panel">
            <h3>实例</h3>
            <p class="note">
              已有 {{ item.instanceCount }} 个实例；实例登记、借出与归还在 M4 接入。
            </p>
          </article>
        </div>
      </section>
    </template>

    <ItemDialog
      v-if="item"
      v-model="dialogVisible"
      :item="item"
      :categories="dictionary.categoryOptions"
      :locations="dictionary.locationOptions"
      @saved="handleSaved"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, Box, Edit } from '@element-plus/icons-vue';
import EmptyState from '@/components/EmptyState.vue';
import ItemDialog from '@/components/ItemDialog.vue';
import { useAuthStore } from '@/stores/auth';
import { useDictionaryStore } from '@/stores/dictionary';
import { api } from '@/api/client';
import { formatDate, formatMoney } from '@/lib/format';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const dictionary = useDictionaryStore();

const item = ref(null);
const loading = ref(true);
const error = ref('');
const dialogVisible = ref(false);

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

watch(
  () => route.params.id,
  () => load(),
);

onMounted(async () => {
  await Promise.allSettled([dictionary.load(), load()]);
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
