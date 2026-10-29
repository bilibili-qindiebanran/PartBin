<template>
  <div class="page">
    <PageHeader title="仪表盘" :subtitle="`你好，${auth.user?.username}。`">
      <template #actions>
        <el-tag round effect="plain">{{ auth.roleLabel }}</el-tag>
      </template>
    </PageHeader>

    <section class="hero card">
      <div class="hero__text">
        <span class="eyebrow">M1–M3 · 库存与流水已接入</span>
        <h2>先查一下，再下单</h2>
        <p>
          搜索名称、型号或位置，确认手里到底有几个；入库、出库和盘点都会留下可追溯的流水。借出与照片将在后续接入。
        </p>
      </div>
      <el-icon class="hero__icon"><Cpu /></el-icon>
    </section>

    <section class="stats">
      <article v-for="stat in stats" :key="stat.label" class="stat card">
        <div class="stat__top">
          <span class="stat__label">{{ stat.label }}</span>
          <span v-if="stat.milestone" class="stat__badge">{{ stat.milestone }}</span>
        </div>
        <strong class="stat__value num">{{ stat.value }}</strong>
        <span class="stat__hint">{{ stat.hint }}</span>
      </article>
    </section>

    <section class="grid">
      <article class="card panel">
        <header class="panel__head">
          <h3>当前账号</h3>
        </header>
        <dl class="kv">
          <div>
            <dt>用户名</dt>
            <dd>{{ auth.user?.username }}</dd>
          </div>
          <div>
            <dt>角色</dt>
            <dd>{{ auth.roleLabel }}</dd>
          </div>
          <div>
            <dt>权限</dt>
            <dd>{{ auth.canWrite ? '可维护库存、成员与设置' : '只读：可查询库存与流水' }}</dd>
          </div>
          <div>
            <dt>最近登录</dt>
            <dd>{{ lastLogin }}</dd>
          </div>
        </dl>
      </article>

      <article class="card panel">
        <header class="panel__head">
          <h3>接下来的路线</h3>
        </header>
        <ul class="roadmap">
          <li v-for="item in roadmap" :key="item.title">
            <span class="roadmap__badge">{{ item.milestone }}</span>
            <div class="roadmap__text">
              <strong>{{ item.title }}</strong>
              <p>{{ item.description }}</p>
            </div>
          </li>
        </ul>
      </article>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { Cpu } from '@element-plus/icons-vue';
import PageHeader from '@/components/PageHeader.vue';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api/client';

const auth = useAuthStore();
const statsData = ref(null);

const stats = computed(() => [
  {
    label: '物料种类',
    value: statsData.value ? statsData.value.items.active : '—',
    hint: '在用物料数量',
    milestone: '',
  },
  {
    label: '低库存',
    value: statsData.value ? statsData.value.items.lowStock : '—',
    hint: '含缺货物料',
    milestone: '',
  },
  {
    label: '本月出库',
    value: statsData.value ? statsData.value.movements.outThisMonth : '—',
    hint: '按数量合计',
    milestone: '',
  },
  {
    label: '未还借出',
    value: statsData.value ? statsData.value.loans.open : '—',
    hint: statsData.value ? `逾期 ${statsData.value.loans.overdue}` : '逾期会高亮',
    milestone: '',
  },
]);

const roadmap = [
  { milestone: 'M2', title: '库存主数据', description: '物料、分类与位置树，搜索与低库存筛选。' },
  { milestone: 'M3', title: '出入库与流水', description: '入库、出库、盘点，全程可追溯。' },
  { milestone: 'M4', title: '借出与归还', description: '实例管理、部分归还与逾期提醒。' },
  { milestone: 'M5', title: '照片与导入导出', description: '手机拍照上传，CSV 导入与导出。' },
];

const lastLogin = computed(() => {
  const iso = auth.user?.lastLoginAt;
  if (!iso) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
});

onMounted(async () => {
  try {
    statsData.value = await api('/api/stats');
  } catch {
    // 统计失败不阻塞仪表盘
  }
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
  padding: var(--space-4);
}

.stat__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.stat__label {
  color: var(--ink-600);
  font-size: 12px;
}

.stat__badge {
  padding: 1px 7px;
  border-radius: var(--r-pill);
  background: rgba(15, 23, 42, 0.05);
  color: var(--ink-400);
  font-size: 10px;
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
  padding: var(--space-5);
}

.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-4);
}

.panel__head h3 {
  font-size: 14px;
  font-weight: 600;
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
  color: var(--ink-400);
  font-size: 12px;
}

.kv dd {
  color: var(--ink-900);
  font-size: 13px;
  text-align: right;
}

.roadmap {
  display: grid;
  gap: var(--space-3);
}

.roadmap li {
  display: flex;
  gap: var(--space-3);
}

.roadmap__badge {
  flex-shrink: 0;
  height: 22px;
  padding: 0 8px;
  border-radius: var(--r-pill);
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 11px;
  font-weight: 600;
  line-height: 22px;
}

.roadmap__text strong {
  font-size: 13px;
  font-weight: 600;
}

.roadmap__text p {
  margin-top: 3px;
  color: var(--ink-600);
  font-size: 12px;
  line-height: 1.6;
}

@media (max-width: 960px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .grid {
    grid-template-columns: 1fr;
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
}
</style>
