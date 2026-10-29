<template>
  <div class="shell">
    <aside class="sidebar glass">
      <div class="brand">
        <span class="brand__mark">
          <el-icon><Cpu /></el-icon>
        </span>
        <span class="brand__text">
          <strong>{{ BRAND.name }}</strong>
          <span>{{ BRAND.tagline }}</span>
        </span>
      </div>

      <nav class="nav" aria-label="主导航">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ 'is-active': isActive(item.to) }"
        >
          <el-icon class="nav-item__icon"><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar__footer">
        <div class="identity">
          <span class="avatar">{{ initial }}</span>
          <span class="identity__text">
            <strong>{{ auth.user?.username }}</strong>
            <span class="role-chip" :class="{ 'role-chip--admin': auth.canWrite }">{{ auth.roleLabel }}</span>
          </span>
        </div>
        <el-dropdown trigger="click" @command="handleCommand">
          <button class="more-btn" type="button" aria-label="账号菜单">
            <el-icon><MoreFilled /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="settings">账号与设置</el-dropdown-item>
              <el-dropdown-item command="logout" divided>
                <el-icon><SwitchButton /></el-icon>退出登录
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </aside>

    <div class="main">
      <header class="topbar glass">
        <div class="topbar__left">
          <span class="topbar__title">{{ pageTitle }}</span>
          <span v-if="auth.user && !auth.canWrite" class="readonly-chip">只读账号</span>
        </div>
        <div class="topbar__right">
          <el-dropdown trigger="click" @command="handleCommand">
            <button class="topbar__user" type="button">
              <span class="avatar avatar--sm">{{ initial }}</span>
              <span class="topbar__name">{{ auth.user?.username }}</span>
              <el-icon><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="settings">设置</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <main class="content">
        <RouterView v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>
    </div>

    <nav class="tabbar glass" aria-label="底部导航">
      <RouterLink
        v-for="item in tabItems"
        :key="item.to"
        :to="item.to"
        class="tab-item"
        :class="{ 'is-active': isActive(item.to) }"
      >
        <el-icon><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowDown,
  Box,
  Cpu,
  Document,
  House,
  MoreFilled,
  Setting,
  SwitchButton,
  Tickets,
  UserFilled,
} from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';
import { BRAND } from '@/brand';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const navItems = [
  { to: '/', label: '仪表盘', icon: House },
  { to: '/items', label: '库存', icon: Box },
  { to: '/movements', label: '流水', icon: Tickets },
  { to: '/loans', label: '借出', icon: Document },
  { to: '/settings', label: '设置', icon: Setting },
];

const tabItems = [
  { to: '/', label: '首页', icon: House },
  { to: '/items', label: '库存', icon: Box },
  { to: '/loans', label: '借出', icon: Document },
  { to: '/settings', label: '我的', icon: UserFilled },
];

const pageTitle = computed(() => route.meta.title || BRAND.name);
const initial = computed(() => (auth.user?.username || '?').slice(0, 1).toUpperCase());

function isActive(to) {
  return to === '/' ? route.path === '/' : route.path.startsWith(to);
}

async function handleCommand(command) {
  if (command === 'settings') {
    router.push('/settings');
    return;
  }
  if (command === 'logout') {
    await auth.logout();
    router.replace({ name: 'login' });
  }
}
</script>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  min-height: 100dvh;
}

.sidebar {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  height: 100dvh;
  padding: 20px 16px;
  border-radius: 0;
  border-top: 0;
  border-bottom: 0;
  border-left: 0;
  background: rgba(255, 255, 255, 0.55);
  box-shadow: none;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 8px;
}

.brand__mark {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: var(--primary);
  color: #fff;
  font-size: 20px;
  box-shadow: 0 6px 16px rgba(10, 122, 122, 0.28);
}

.brand__text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.brand__text strong {
  font-size: 14px;
  font-weight: 600;
}

.brand__text span {
  margin-top: 2px;
  font-size: 10px;
  letter-spacing: 0.02em;
  color: var(--ink-400);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  color: var(--ink-600);
  font-size: 13px;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.72);
  color: var(--ink-900);
}

.nav-item.is-active {
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 600;
}

.nav-item.is-active::before {
  content: '';
  position: absolute;
  left: -16px;
  top: 9px;
  bottom: 9px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--primary);
}

.nav-item__icon {
  font-size: 17px;
}

.sidebar__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
}

.identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.avatar {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--primary));
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}

.avatar--sm {
  width: 26px;
  height: 26px;
  font-size: 12px;
}

.identity__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.identity__text strong {
  max-width: 104px;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-chip {
  font-size: 11px;
  color: var(--ink-400);
}

.role-chip--admin {
  color: var(--primary);
}

.more-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-400);
  cursor: pointer;
}

.more-btn:hover {
  background: var(--primary-soft);
  color: var(--primary);
}

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 56px;
  padding: 0 24px;
  border-top: 0;
  border-right: 0;
  border-left: 0;
  border-radius: 0;
  box-shadow: 0 1px 0 var(--line);
}

.topbar__left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.topbar__title {
  font-size: 14px;
  font-weight: 600;
}

.readonly-chip {
  padding: 2px 8px;
  border: 1px solid rgba(180, 83, 9, 0.16);
  border-radius: var(--r-pill);
  background: rgba(180, 83, 9, 0.08);
  color: var(--warning);
  font-size: 11px;
}

.topbar__user {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 4px 4px;
  border: 0;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--ink-600);
  font-size: 12px;
  cursor: pointer;
}

.topbar__user:hover {
  background: rgba(15, 23, 42, 0.04);
}

.content {
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  padding: 24px 32px 56px;
}

.tabbar {
  display: none;
}

@media (max-width: 767px) {
  .shell {
    display: block;
  }

  .sidebar {
    display: none;
  }

  .topbar {
    height: 54px;
    padding: 0 16px;
  }

  .topbar__name {
    display: none;
  }

  .content {
    padding: 16px 16px calc(84px + env(safe-area-inset-bottom));
  }

  .tabbar {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 200;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    height: calc(56px + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: 0;
  }

  .tab-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    color: var(--ink-400);
    font-size: 11px;
  }

  .tab-item .el-icon {
    font-size: 20px;
  }

  .tab-item.is-active {
    color: var(--primary);
    font-weight: 500;
  }
}
</style>
