<template>
  <div class="page">
    <PageHeader title="设置" subtitle="账号安全与成员管理" />

    <section class="grid">
      <article class="card panel">
        <header class="panel__head">
          <h3>账号信息</h3>
          <el-icon><UserFilled /></el-icon>
        </header>
        <dl class="kv">
          <div>
            <dt>用户名</dt>
            <dd>{{ auth.user?.username }}</dd>
          </div>
          <div>
            <dt>角色</dt>
            <dd>
              <el-tag round effect="plain" :type="isAdmin ? 'success' : 'info'">
                {{ auth.roleLabel }}
              </el-tag>
            </dd>
          </div>
          <div>
            <dt>最近登录</dt>
            <dd>{{ formatDate(auth.user?.lastLoginAt) }}</dd>
          </div>
        </dl>
        <p v-if="!isAdmin" class="notice">
          当前账号为只读：可以查询库存与流水，维护操作请联系管理员。
        </p>
      </article>

      <article class="card panel">
        <header class="panel__head">
          <h3>修改密码</h3>
          <el-icon><Key /></el-icon>
        </header>
        <form class="stack" @submit.prevent="changePassword">
          <el-input
            v-model="passwordForm.current"
            type="password"
            size="large"
            show-password
            placeholder="当前密码"
            autocomplete="current-password"
          />
          <el-input
            v-model="passwordForm.next"
            type="password"
            size="large"
            show-password
            placeholder="新密码（至少 8 位）"
            autocomplete="new-password"
          />
          <el-input
            v-model="passwordForm.confirm"
            type="password"
            size="large"
            show-password
            placeholder="再输入一次新密码"
            autocomplete="new-password"
          />
          <el-button type="primary" native-type="submit" :loading="savingPassword">
            保存新密码
          </el-button>
        </form>
      </article>

      <article v-if="isAdmin" class="card panel panel--wide">
        <header class="panel__head">
          <div>
            <h3>开放注册</h3>
            <p class="panel__sub">关闭后只有现有账号能登录，新用户无法注册。</p>
          </div>
          <el-switch v-model="registrationOpen" @change="onRegistrationChange" />
        </header>
      </article>

      <article v-if="isAdmin" class="card panel panel--wide">
        <header class="panel__head">
          <div>
            <h3>成员管理</h3>
            <p class="panel__sub">
              共 {{ users.length }} 个账号。管理员可维护库存与成员；只读账号只能查询。
            </p>
          </div>
          <el-button text :loading="loadingUsers" @click="loadUsers">刷新</el-button>
        </header>

        <div v-loading="loadingUsers" class="table-wrap">
          <el-table :data="users" style="width: 100%" empty-text="还没有成员">
            <el-table-column prop="username" label="用户名" min-width="140" />
            <el-table-column label="角色" width="132">
              <template #default="{ row }">
                <el-select
                  :model-value="row.role"
                  size="small"
                  @change="(value) => changeRole(row, value)"
                >
                  <el-option label="管理员" value="admin" />
                  <el-option label="只读" value="user" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="启用" width="100">
              <template #default="{ row }">
                <el-switch v-model="row.isActive" @change="(value) => toggleActive(row, value)" />
              </template>
            </el-table-column>
            <el-table-column label="最近登录" min-width="170">
              <template #default="{ row }">{{ formatDate(row.lastLoginAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="120" align="right">
              <template #default="{ row }">
                <el-button text type="primary" @click="openReset(row)">重置密码</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </article>

      <article v-if="isAdmin" class="card panel panel--wide">
        <header class="panel__head">
          <div>
            <h3>分类管理</h3>
            <p class="panel__sub">给物料分组，支持多级；删除时物料会变为未分类。</p>
          </div>
        </header>
        <TaxonomyManager kind="categories" />
      </article>

      <article v-if="isAdmin" class="card panel panel--wide">
        <header class="panel__head">
          <div>
            <h3>位置管理</h3>
            <p class="panel__sub">按柜 / 层 / 盒组织存放位置，路径会显示在库存列表。</p>
          </div>
        </header>
        <TaxonomyManager kind="locations" />
      </article>
    </section>

    <el-dialog
      v-model="resetDialog.visible"
      title="重置密码"
      width="min(420px, 92vw)"
      align-center
    >
      <p class="dialog-text">
        为 <strong>{{ resetDialog.user?.username }}</strong> 设置新密码。重置后该账号的所有会话会立即失效。
      </p>
      <el-input
        v-model="resetDialog.password"
        type="password"
        size="large"
        show-password
        placeholder="新密码（至少 8 位）"
      />
      <template #footer>
        <el-button @click="resetDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="resetDialog.saving" @click="submitReset">
          确认重置
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Key, UserFilled } from '@element-plus/icons-vue';
import PageHeader from '@/components/PageHeader.vue';
import TaxonomyManager from '@/components/TaxonomyManager.vue';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();

const isAdmin = computed(() => auth.canWrite);
const users = ref([]);
const loadingUsers = ref(false);
const savingPassword = ref(false);
const registrationOpen = ref(auth.allowRegistration);

const passwordForm = reactive({ current: '', next: '', confirm: '' });
const resetDialog = reactive({ visible: false, saving: false, user: null, password: '' });

onMounted(async () => {
  registrationOpen.value = auth.allowRegistration;
  if (isAdmin.value) await loadUsers();
});

async function loadUsers() {
  loadingUsers.value = true;
  try {
    const data = await api('/api/users');
    users.value = data.data;
  } catch (error) {
    await handleError(error);
  } finally {
    loadingUsers.value = false;
  }
}

async function handleError(error) {
  if (error?.status === 401) {
    await auth.logout();
    router.replace({ name: 'login' });
    return;
  }
  ElMessage.error(error?.message || '操作失败，请稍后再试');
}

async function changePassword() {
  if (!passwordForm.current) {
    ElMessage.warning('请输入当前密码');
    return;
  }
  if (passwordForm.next.length < 8) {
    ElMessage.warning('新密码至少 8 个字符');
    return;
  }
  if (passwordForm.next !== passwordForm.confirm) {
    ElMessage.warning('两次输入的新密码不一致');
    return;
  }

  savingPassword.value = true;
  try {
    await api('/api/auth/password', {
      method: 'POST',
      body: {
        currentPassword: passwordForm.current,
        newPassword: passwordForm.next,
      },
    });
    ElMessage.success('密码已更新，其他设备已被登出');
    Object.assign(passwordForm, { current: '', next: '', confirm: '' });
  } catch (error) {
    await handleError(error);
  } finally {
    savingPassword.value = false;
  }
}

async function onRegistrationChange(value) {
  try {
    await api('/api/settings', { method: 'PATCH', body: { allowRegistration: value } });
    auth.allowRegistration = value;
    ElMessage.success(value ? '已开放注册' : '已关闭注册');
  } catch (error) {
    registrationOpen.value = !value;
    await handleError(error);
  }
}

async function changeRole(user, role) {
  if (role === user.role) return;
  try {
    const data = await api(`/api/users/${user.id}`, { method: 'PATCH', body: { role } });
    Object.assign(user, data.user);
    ElMessage.success(`${user.username} 现在${role === 'admin' ? '是管理员' : '是只读账号'}`);
  } catch (error) {
    await loadUsers();
    await handleError(error);
  }
}

async function toggleActive(user, value) {
  try {
    if (!value) {
      await ElMessageBox.confirm(
        `禁用后 ${user.username} 会立即退出登录，且无法再次登录。`,
        '禁用账号',
        {
          type: 'warning',
          confirmButtonText: '禁用',
          cancelButtonText: '取消',
        },
      );
    }

    const data = await api(`/api/users/${user.id}`, {
      method: 'PATCH',
      body: { isActive: value },
    });
    Object.assign(user, data.user);
    ElMessage.success(value ? '已启用该账号' : '已禁用该账号');
  } catch (error) {
    user.isActive = !value;
    if (error !== 'cancel' && error !== 'close') await handleError(error);
  }
}

function openReset(user) {
  resetDialog.user = user;
  resetDialog.password = '';
  resetDialog.visible = true;
}

async function submitReset() {
  if (resetDialog.password.length < 8) {
    ElMessage.warning('新密码至少 8 个字符');
    return;
  }

  resetDialog.saving = true;
  try {
    const data = await api(`/api/users/${resetDialog.user.id}/reset-password`, {
      method: 'POST',
      body: { newPassword: resetDialog.password },
    });
    ElMessage.success(`已重置 ${resetDialog.user.username} 的密码`);
    resetDialog.visible = false;

    if (data.mustRelogin) {
      await auth.logout();
      router.replace({ name: 'login' });
    }
  } catch (error) {
    await handleError(error);
  } finally {
    resetDialog.saving = false;
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}
</script>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}

.panel {
  padding: var(--space-5);
}

.panel--wide {
  grid-column: 1 / -1;
}

.panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.panel__head h3 {
  font-size: 14px;
  font-weight: 600;
}

.panel__head > .el-icon {
  color: var(--ink-400);
  font-size: 18px;
}

.panel__sub {
  margin-top: 4px;
  color: var(--ink-400);
  font-size: 12px;
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
  font-size: 13px;
  text-align: right;
}

.notice {
  margin-top: var(--space-4);
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(180, 83, 9, 0.07);
  color: var(--warning);
  font-size: 12px;
  line-height: 1.6;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.table-wrap {
  overflow-x: auto;
}

.dialog-text {
  margin-bottom: var(--space-3);
  color: var(--ink-600);
  font-size: 13px;
  line-height: 1.7;
}

@media (max-width: 960px) {
  .grid {
    grid-template-columns: 1fr;
  }

  .panel--wide {
    grid-column: auto;
  }
}
</style>
