<template>
  <div class="page">
    <PageHeader title="仪表盘" :subtitle="`你好，${auth.user?.username}。`">
      <template #actions>
        <el-tag round effect="plain">{{ auth.roleLabel }}</el-tag>
      </template>
    </PageHeader>

    <section class="hero card">
      <div class="hero__text">
        <span class="eyebrow">PartBin · 硬件库存</span>
        <h2>先查一下，再下单</h2>
        <p>
          搜索名称、型号或存放位置，确认手里到底有几个、借给了谁。所有出入库与借还都会留下可追溯的流水。
        </p>
        <div class="hero__actions">
          <el-button type="primary" @click="router.push('/items')">查看库存</el-button>
          <el-button @click="router.push('/movements')">流水台账</el-button>
        </div>
      </div>
      <el-icon class="hero__icon"><Cpu /></el-icon>
    </section>

    <section class="stats">
      <article v-for="stat in stats" :key="stat.label" class="stat card">
        <span class="stat__label">{{ stat.label }}</span>
        <strong class="stat__value num">{{ stat.value }}</strong>
        <span class="stat__hint">{{ stat.hint }}</span>
      </article>
    </section>

    <section class="grid">
      <article class="card panel">
        <header class="panel__head">
          <h3>库存提醒</h3>
          <router-link class="panel__link" to="/items">全部库存</router-link>
        </header>

        <p v-if="loadingPanels" class="panel__empty">加载中…</p>
        <ul v-else-if="lowStock.length > 0" class="item-list">
          <li
            v-for="item in lowStock"
            :key="item.id"
            role="button"
            tabindex="0"
            @click="router.push(`/items/${item.id}`)"
            @keyup.enter="router.push(`/items/${item.id}`)"
          >
            <div class="item-list__main">
              <strong>{{ item.name }}</strong>
              <small>
                {{ item.categoryPath || '未分类' }} ·
                {{ item.locationPath || '未指定位置' }}
              </small>
            </div>
            <span class="item-list__qty" :class="{ 'is-zero': item.quantity === 0 }">
              {{ item.quantity }}<small>{{ item.unit }}</small>
            </span>
          </li>
        </ul>
        <p v-else class="panel__empty">当前没有低库存物料。</p>
      </article>

      <article class="card panel">
        <header class="panel__head">
          <h3>最近流水</h3>
          <router-link class="panel__link" to="/movements">全部流水</router-link>
        </header>

        <p v-if="loadingPanels" class="panel__empty">加载中…</p>
        <ul v-else-if="recentMovements.length > 0" class="movement-list">
          <li v-for="movement in recentMovements" :key="movement.id">
            <el-tag
              size="small"
              round
              effect="plain"
              :type="movementMeta(movement.type).type"
            >
              {{ movementMeta(movement.type).label }}
            </el-tag>
            <div class="movement-list__main">
              <strong>{{ movement.itemName }}</strong>
              <small>
                {{ movement.userName || '—' }} ·
                {{ formatDate(movement.occurredAt, { withTime: true }) }}
              </small>
            </div>
            <span
              class="movement-list__delta num"
              :class="{
                'is-plus': movement.quantityDelta > 0,
                'is-minus': movement.quantityDelta < 0,
              }"
            >
              {{ movement.quantityDelta > 0 ? '+' : '' }}{{ movement.quantityDelta }}
            </span>
          </li>
        </ul>
        <p v-else class="panel__empty">还没有出入库记录。</p>
      </article>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Cpu } from '@element-plus/icons-vue';
import PageHeader from '@/components/PageHeader.vue';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api/client';
import { formatDate } from '@/lib/format';

const auth = useAuthStore();
const router = useRouter();
const statsData = ref(null);
const lowStock = ref([]);
const recentMovements = ref([]);
const loadingPanels = ref(true);

const stats = computed(() => [
  {
    label: '在用物料',
    value: statsData.value ? statsData.value.items.active : '—',
    hint: '已归档的不计入',
  },
  {
    label: '低库存',
    value: statsData.value ? statsData.value.items.lowStock : '—',
    hint: statsData.value ? `其中缺货 ${statsData.value.items.outOfStock}` : '含缺货物料',
  },
  {
    label: '本月出库',
    value: statsData.value ? statsData.value.movements.outThisMonth : '—',
    hint: '按数量合计',
  },
  {
    label: '未还借出',
    value: statsData.value ? statsData.value.loans.open : '—',
    hint: statsData.value ? `逾期 ${statsData.value.loans.overdue}` : '逾期会高亮',
  },
]);

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

async function loadPanels() {
  loadingPanels.value = true;
  try {
    const [low, movements] = await Promise.allSettled([
      api('/api/items?lowStock=1&pageSize=5&sort=quantity'),
      api('/api/movements?pageSize=6'),
    ]);
    if (low.status === 'fulfilled') lowStock.value = low.value.data;
    if (movements.status === 'fulfilled') recentMovements.value = movements.value.data;
  } finally {
    loadingPanels.value = false;
  }
}

onMounted(async () => {
  await Promise.allSettled([
    api('/api/stats').then((data) => {
      statsData.value = data;
    }),
    loadPanels(),
  ]);
});
</script>

<style scoped>
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  padding: var(--space-5) var(--space-6);
  overflow: hidden;
  background:
    radial-gradient(420px 220px at 88% 20%, rgba(79, 209, 197, 0.14), transparent 70%),
    var(--bg-elevated);
}

.eyebrow {
  display: inline-block;
  margin-bottom: 8px;
  color: var(--primary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.hero h2 {
  font-size: 22px;
  font-weight: 600;
}

.hero p {
  max-width: 560px;
  margin-top: 8px;
  color: var(--ink-600);
  font-size: 13px;
  line-height: 1.7;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.hero__icon {
  flex-shrink: 0;
  color: var(--primary);
  font-size: 64px;
  opacity: 0.78;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.stat {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: var(--space-4);
}

.stat__label {
  color: var(--ink-600);
  font-size: 12px;
}

.stat__value {
  margin-top: 10px;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.1;
}

.stat__hint {
  margin-top: 6px;
  color: var(--ink-400);
  font-size: 11px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  margin-top: var(--space-4);
}

.panel {
  min-width: 0;
  padding: var(--space-5);
}

.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: var(--space-4);
}

.panel__head h3 {
  font-size: 14px;
  font-weight: 600;
}

.panel__link {
  flex-shrink: 0;
  color: var(--primary);
  font-size: 12px;
}

.panel__empty {
  color: var(--ink-400);
  font-size: 12px;
  line-height: 1.7;
}

.item-list,
.movement-list {
  display: flex;
  flex-direction: column;
}

.item-list li,
.movement-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 9px 6px;
  border-bottom: 1px dashed var(--line);
  cursor: pointer;
  border-radius: 6px;
}

.item-list li:last-child,
.movement-list li:last-child {
  border-bottom: 0;
}

.item-list li:hover {
  background: rgba(10, 122, 122, 0.04);
}

.item-list__main,
.movement-list__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  line-height: 1.35;
}

.item-list__main strong,
.movement-list__main strong {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-list__main small,
.movement-list__main small {
  overflow: hidden;
  margin-top: 2px;
  color: var(--ink-400);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-list__qty {
  flex-shrink: 0;
  color: var(--warning);
  font-size: 18px;
  font-weight: 600;
}

.item-list__qty small {
  margin-left: 2px;
  color: var(--ink-400);
  font-size: 10px;
  font-weight: 400;
}

.item-list__qty.is-zero {
  color: var(--danger);
}

.movement-list__delta {
  flex-shrink: 0;
  color: var(--ink-400);
  font-size: 13px;
}

.movement-list__delta.is-plus {
  color: var(--success);
}

.movement-list__delta.is-minus {
  color: var(--danger);
}

@media (max-width: 960px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 767px) {
  .hero {
    padding: var(--space-4);
  }

  .hero h2 {
    font-size: 18px;
  }

  .hero__icon {
    display: none;
  }

  .panel {
    padding: var(--space-4);
  }
}
</style>
