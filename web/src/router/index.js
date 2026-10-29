import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { BRAND } from '@/brand';

import Login from '@/views/Login.vue';
import AppShell from '@/layouts/AppShell.vue';
import Dashboard from '@/views/Dashboard.vue';
import Items from '@/views/Items.vue';
import Movements from '@/views/Movements.vue';
import Loans from '@/views/Loans.vue';
import Settings from '@/views/Settings.vue';

const routes = [
  {
    path: '/login',
    name: 'login',
    component: Login,
    meta: { public: true, title: '登录' },
  },
  {
    path: '/',
    component: AppShell,
    children: [
      { path: '', name: 'dashboard', component: Dashboard, meta: { title: '仪表盘' } },
      { path: 'items', name: 'items', component: Items, meta: { title: '库存' } },
      { path: 'movements', name: 'movements', component: Movements, meta: { title: '流水' } },
      { path: 'loans', name: 'loans', component: Loans, meta: { title: '借出' } },
      { path: 'settings', name: 'settings', component: Settings, meta: { title: '设置' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 };
  },
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.checked) await auth.bootstrap();

  if (to.meta.public) {
    if (to.name === 'login' && auth.user) return { path: '/' };
    return true;
  }

  if (!auth.user) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · ${BRAND.name}` : BRAND.title;
});

export default router;
