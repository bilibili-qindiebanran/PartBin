<template>
  <div class="login">
    <section class="login__brand">
      <div class="brand-content">
        <div class="brand-mark">
          <el-icon><Cpu /></el-icon>
        </div>
        <div class="wordmark">
          <strong>{{ BRAND.name }}</strong>
          <span>{{ BRAND.tagline }}</span>
        </div>
        <h1>先查一下，再下单</h1>
        <p class="brand-sub">记录每一块开发板、每一颗电阻的去向。</p>
        <ul class="brand-points">
          <li><span class="dot" />按「柜 / 抽屉 / 盒」记录存放位置</li>
          <li><span class="dot" />每次出入库都有流水与操作人</li>
          <li><span class="dot" />借出归还不再靠记忆</li>
        </ul>
      </div>
    </section>

    <section class="login__panel">
      <div class="auth-card glass-strong">
        <div v-if="auth.allowRegistration" class="tabs" role="tablist" aria-label="登录或注册">
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'login'"
            :class="{ 'is-active': mode === 'login' }"
            @click="setMode('login')"
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'register'"
            :class="{ 'is-active': mode === 'register' }"
            @click="setMode('register')"
          >
            注册
          </button>
        </div>

        <header class="auth-card__header">
          <h2>{{ needsTotp ? '两步验证' : mode === 'login' ? '欢迎回来' : '创建账号' }}</h2>
          <p v-if="needsTotp">该账号已启用动态验证码，请输入 6 位验证码或恢复码。</p>
          <p v-else-if="mode === 'login'">用账号和密码进入你的库存。</p>
          <p v-else-if="auth.registrationMode === 'invite'">注册需要管理员提供的邀请码。</p>
          <p v-else>只需用户名和密码，不需要邮箱。</p>
        </header>

        <form class="auth-form" novalidate @submit.prevent="submit">
          <label class="field">
            <span>用户名</span>
            <el-input
              v-model="form.username"
              size="large"
              placeholder="3–32 位，中文 / 字母 / 数字"
              autocomplete="username"
              :prefix-icon="User"
            />
          </label>

          <label class="field">
            <span>密码</span>
            <el-input
              v-model="form.password"
              type="password"
              size="large"
              placeholder="至少 12 位"
              show-password
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              :prefix-icon="Lock"
            />
          </label>

          <label v-if="mode === 'register'" class="field">
            <span>确认密码</span>
            <el-input
              v-model="form.confirm"
              type="password"
              size="large"
              placeholder="再输入一次"
              show-password
              autocomplete="new-password"
              :prefix-icon="Lock"
            />
          </label>

          <label v-if="mode === 'register' && auth.registrationMode === 'invite'" class="field">
            <span>邀请码</span>
            <el-input
              v-model="form.inviteCode"
              size="large"
              placeholder="PB-XXXX-XXXX-XXXX"
              autocomplete="off"
              :prefix-icon="Ticket"
            />
          </label>

          <div v-if="needsTotp" class="totp-block">
            <label v-if="!useRecovery" class="field">
              <span>动态验证码</span>
              <el-input
                v-model="form.totpCode"
                size="large"
                maxlength="6"
                placeholder="6 位数字"
                autocomplete="one-time-code"
                :prefix-icon="Key"
              />
            </label>
            <label v-else class="field">
              <span>恢复码</span>
              <el-input
                v-model="form.recoveryCode"
                size="large"
                placeholder="XXXX-XXXX"
                autocomplete="one-time-code"
                :prefix-icon="Key"
              />
            </label>
            <el-button text size="small" @click="useRecovery = !useRecovery">
              {{ useRecovery ? '改用动态验证码' : '使用恢复码' }}
            </el-button>
          </div>

          <p v-if="error" class="error" role="alert">{{ error }}</p>

          <el-button
            class="submit"
            type="primary"
            size="large"
            native-type="submit"
            :loading="auth.loading"
          >
            {{ needsTotp ? '验证并登录' : mode === 'login' ? '登录' : '注册并进入' }}
          </el-button>
        </form>

        <p class="footnote">
          {{ BRAND.name }} · 自托管 · 数据保存在你自己的服务器上
        </p>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Cpu, Key, Lock, Ticket, User } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';
import { BRAND } from '@/brand';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const mode = ref('login');
const form = reactive({
  username: '',
  password: '',
  confirm: '',
  inviteCode: '',
  totpCode: '',
  recoveryCode: '',
});
const error = ref('');
const needsTotp = ref(false);
const useRecovery = ref(false);

const registerNeedsInvite = computed(() => auth.registrationMode === 'invite');

onMounted(async () => {
  try {
    await auth.fetchConfig();
  } catch {
    // 配置拉取失败时保持默认值，真正的错误会在提交时返回
  }

  const invite = route.query.invite ?? route.query.code;
  if (typeof invite === 'string' && invite) {
    form.inviteCode = invite;
    if (auth.allowRegistration) mode.value = 'register';
  }
});

function setMode(next) {
  mode.value = next;
  error.value = '';
  needsTotp.value = false;
  useRecovery.value = false;
}

function safeRedirect() {
  const target = route.query.redirect;
  if (typeof target === 'string' && target.startsWith('/') && !target.startsWith('//')) {
    return target;
  }
  return '/';
}

async function submit() {
  error.value = '';
  const username = form.username.trim();

  if (!username) {
    error.value = '请输入用户名';
    return;
  }

  if (mode.value === 'register') {
    if (form.password.length < 12) {
      error.value = '密码至少 12 个字符';
      return;
    }
    if (form.password !== form.confirm) {
      error.value = '两次输入的密码不一致';
      return;
    }
    if (registerNeedsInvite.value && !form.inviteCode.trim()) {
      error.value = '请输入邀请码';
      return;
    }
  }

  if (needsTotp.value) {
    if (useRecovery.value && !form.recoveryCode.trim()) {
      error.value = '请输入恢复码';
      return;
    }
    if (!useRecovery.value && !/^\d{6}$/.test(form.totpCode.trim())) {
      error.value = '请输入 6 位动态验证码';
      return;
    }
  }

  try {
    if (mode.value === 'login') {
      const factors = needsTotp.value
        ? useRecovery.value
          ? { recoveryCode: form.recoveryCode.trim() }
          : { totpCode: form.totpCode.trim() }
        : {};
      await auth.login(username, form.password, factors);
      ElMessage.success('登录成功');
    } else {
      await auth.register(username, form.password, form.inviteCode.trim() || undefined);
      ElMessage.success('注册成功，欢迎使用');
    }
    router.replace(safeRedirect());
  } catch (requestError) {
    if (requestError.code === 'TOTP_REQUIRED') {
      needsTotp.value = true;
      error.value = '请输入动态验证码';
      return;
    }
    if (requestError.code === 'INVALID_TOTP') {
      needsTotp.value = true;
      error.value = '动态验证码或恢复码不正确';
      return;
    }
    error.value = requestError.message || '操作失败，请稍后再试';
  }
}
</script>

<style scoped>
.login {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  min-height: 100dvh;
}

.login__brand {
  position: relative;
  display: flex;
  align-items: center;
  padding: 64px;
  overflow: hidden;
}

.login__brand::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(620px 420px at 18% 12%, rgba(79, 209, 197, 0.2), transparent 62%),
    radial-gradient(520px 380px at 82% 78%, rgba(96, 165, 250, 0.14), transparent 60%);
  pointer-events: none;
}

.brand-content {
  position: relative;
  max-width: 440px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: 18px;
  border-radius: 18px;
  background: var(--primary);
  color: #fff;
  font-size: 28px;
  box-shadow: 0 18px 40px rgba(10, 122, 122, 0.25);
}

.wordmark {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 24px;
}

.wordmark strong {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.wordmark span {
  color: var(--ink-400);
  font-size: 12px;
}

.brand-content h1 {
  font-size: 40px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.02em;
}

.brand-sub {
  margin-top: 14px;
  color: var(--ink-600);
  font-size: 16px;
}

.brand-points {
  display: grid;
  gap: 14px;
  margin-top: 40px;
}

.brand-points li {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ink-600);
  font-size: 14px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 4px rgba(79, 209, 197, 0.14);
}

.login__panel {
  display: grid;
  place-items: center;
  padding: 48px 32px;
}

.auth-card {
  width: min(420px, 100%);
  padding: 32px;
  border-radius: 24px;
}

.tabs {
  display: inline-flex;
  padding: 4px;
  border-radius: var(--r-pill);
  background: rgba(15, 23, 42, 0.05);
}

.tabs button {
  padding: 7px 20px;
  border: 0;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--ink-600);
  font-size: 13px;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.tabs button.is-active {
  background: #fff;
  color: var(--ink-900);
  font-weight: 600;
  box-shadow: var(--shadow-1);
}

.auth-card__header {
  margin-top: 24px;
}

.auth-card__header h2 {
  font-size: 24px;
  font-weight: 600;
}

.auth-card__header p {
  margin-top: 6px;
  color: var(--ink-600);
  font-size: 13px;
}

.hint {
  margin-top: 18px;
  padding: 10px 12px;
  border: 1px solid rgba(10, 122, 122, 0.12);
  border-radius: 10px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 12px;
}

.totp-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.6);
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 24px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--ink-600);
  font-size: 12px;
}

.error {
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(180, 35, 24, 0.06);
  color: var(--danger);
  font-size: 13px;
}

.submit {
  height: 46px;
  margin-top: 4px;
  border-radius: 12px;
  font-size: 15px;
}

.footnote {
  margin-top: 24px;
  color: var(--ink-400);
  font-size: 11px;
  text-align: center;
}

@media (max-width: 900px) {
  .login {
    grid-template-columns: 1fr;
  }

  .login__brand {
    padding: 32px 24px 0;
  }

  .brand-mark {
    width: 48px;
    height: 48px;
    margin-bottom: 14px;
    border-radius: 16px;
    font-size: 24px;
  }

  .wordmark {
    margin-bottom: 16px;
  }

  .wordmark strong {
    font-size: 20px;
  }

  .wordmark span {
    font-size: 11px;
  }

  .brand-content h1 {
    font-size: 28px;
  }

  .brand-sub {
    font-size: 14px;
  }

  .brand-points {
    display: none;
  }

  .login__panel {
    place-items: start center;
    padding: 24px 16px 40px;
  }

  .auth-card {
    padding: 24px;
    border-radius: 20px;
  }
}
</style>
