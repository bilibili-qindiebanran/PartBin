<template>
  <div class="security">
    <section class="security__block">
      <div class="security__row">
        <div>
          <h4>动态验证码（TOTP）</h4>
          <p class="muted">
            {{ auth.totpEnabled ? '已启用，登录时需要输入验证器中的 6 位码。' : '推荐启用；支持任意 TOTP 验证器。' }}
          </p>
        </div>
        <el-tag :type="auth.totpEnabled ? 'success' : 'info'" round>
          {{ auth.totpEnabled ? '已启用' : '未启用' }}
        </el-tag>
      </div>
      <div class="security__actions">
        <el-button v-if="!auth.totpEnabled" type="primary" @click="startSetup">启用</el-button>
        <template v-else>
          <el-button @click="rotateCodes">重新生成恢复码</el-button>
          <el-button type="danger" plain @click="openDisable">关闭</el-button>
        </template>
      </div>
    </section>

    <section class="security__block">
      <div class="security__row">
        <div>
          <h4>登录设备</h4>
          <p class="muted">发现陌生设备可立即撤销会话。</p>
        </div>
        <el-button text :loading="loadingSessions" @click="loadSessions">刷新</el-button>
      </div>
      <ul class="sessions">
        <li v-for="session in sessions" :key="session.id">
          <div>
            <span class="session-agent">{{ session.userAgent || '未知设备' }}</span>
            <span v-if="session.current" class="current">当前</span>
            <p class="muted">
              最近活动 {{ formatDate(session.lastSeenAt, { withTime: true }) }} ·
              到期 {{ formatDate(session.expiresAt) }}
            </p>
          </div>
          <el-button text type="danger" size="small" @click="revokeSession(session)">撤销</el-button>
        </li>
      </ul>
    </section>

    <el-dialog v-model="setup.visible" title="绑定动态验证码" width="min(460px, 92vw)" align-center>
      <p class="muted">在验证器 App 中手动输入以下密钥（或使用下面的 otpauth 链接）：</p>
      <code class="secret">{{ setup.secret }}</code>
      <p class="otpauth">{{ setup.otpauthUrl }}</p>
      <el-input
        v-model="setup.code"
        maxlength="6"
        placeholder="输入验证器显示的 6 位码"
        class="code-input"
      />
      <template #footer>
        <el-button @click="setup.visible = false">取消</el-button>
        <el-button type="primary" :loading="setup.saving" @click="enableTotp">确认启用</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="recovery.visible" title="恢复码" width="min(460px, 92vw)" align-center>
      <p class="muted">只显示这一次，请保存到安全的地方。每枚恢复码只能使用一次。</p>
      <div class="recovery-grid">
        <code v-for="code in recovery.codes" :key="code">{{ code }}</code>
      </div>
      <template #footer>
        <el-button @click="recovery.visible = false">我已保存</el-button>
        <el-button type="primary" @click="copyRecovery">复制全部</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="disable.visible" title="关闭动态验证码" width="min(400px, 92vw)" align-center>
      <p class="muted">需要验证当前密码与动态码。</p>
      <el-input v-model="disable.password" type="password" show-password placeholder="当前密码" />
      <el-input v-model="disable.code" maxlength="6" placeholder="6 位动态码" class="code-input" />
      <template #footer>
        <el-button @click="disable.visible = false">取消</el-button>
        <el-button type="danger" :loading="disable.saving" @click="confirmDisable">确认关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api/client';
import { formatDate } from '@/lib/format';
import { ensureReauth } from '@/lib/reauth';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const sessions = ref([]);
const loadingSessions = ref(false);
const setup = reactive({ visible: false, saving: false, secret: '', otpauthUrl: '', code: '' });
const recovery = reactive({ visible: false, codes: [] });
const disable = reactive({ visible: false, saving: false, password: '', code: '' });

async function reauthOrCancel() {
  try {
    await ensureReauth();
    return true;
  } catch (error) {
    if (error === 'cancel' || error === 'close') return false;
    ElMessage.error(error.message || '验证失败');
    return false;
  }
}

async function loadSessions() {
  loadingSessions.value = true;
  try {
    const data = await api('/api/auth/sessions');
    sessions.value = data.data;
  } catch (error) {
    ElMessage.error(error.message || '加载设备失败');
  } finally {
    loadingSessions.value = false;
  }
}

async function startSetup() {
  if (!(await reauthOrCancel())) return;
  try {
    const data = await api('/api/auth/totp/setup', { method: 'POST' });
    Object.assign(setup, {
      visible: true,
      secret: data.secret,
      otpauthUrl: data.otpauthUrl,
      code: '',
    });
  } catch (error) {
    ElMessage.error(error.message || '初始化失败');
  }
}

async function enableTotp() {
  setup.saving = true;
  try {
    const data = await api('/api/auth/totp/enable', {
      method: 'POST',
      body: { code: setup.code.trim() },
    });
    auth.totpEnabled = true;
    setup.visible = false;
    recovery.codes = data.recoveryCodes;
    recovery.visible = true;
    ElMessage.success('动态验证码已启用');
  } catch (error) {
    ElMessage.error(error.message || '启用失败');
  } finally {
    setup.saving = false;
  }
}

async function rotateCodes() {
  if (!(await reauthOrCancel())) return;
  try {
    const data = await api('/api/auth/totp/recovery', { method: 'POST' });
    recovery.codes = data.recoveryCodes;
    recovery.visible = true;
  } catch (error) {
    ElMessage.error(error.message || '生成失败');
  }
}

function openDisable() {
  disable.password = '';
  disable.code = '';
  disable.visible = true;
}

async function confirmDisable() {
  disable.saving = true;
  try {
    await api('/api/auth/totp/disable', {
      method: 'POST',
      body: { password: disable.password, code: disable.code.trim() },
    });
    auth.totpEnabled = false;
    disable.visible = false;
    ElMessage.success('已关闭动态验证码');
  } catch (error) {
    ElMessage.error(error.message || '关闭失败');
  } finally {
    disable.saving = false;
  }
}

async function revokeSession(session) {
  try {
    await ElMessageBox.confirm('撤销后该设备需要重新登录。', '撤销会话', {
      type: 'warning',
      confirmButtonText: '撤销',
      cancelButtonText: '取消',
    });
    await api(`/api/auth/sessions/${session.id}`, { method: 'DELETE' });
    if (session.current) {
      auth.user = null;
      window.location.href = '/login';
      return;
    }
    await loadSessions();
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(error.message || '撤销失败');
  }
}

async function copyRecovery() {
  try {
    await navigator.clipboard.writeText(recovery.codes.join('\n'));
    ElMessage.success('已复制');
  } catch {
    ElMessage.warning('复制失败，请手动抄录');
  }
}

onMounted(loadSessions);
</script>

<style scoped>
.security {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.security__block {
  padding-bottom: 16px;
  border-bottom: 1px dashed var(--line);
}

.security__block:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.security__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.security__row h4 {
  font-size: 13px;
  font-weight: 600;
}

.security__row .muted {
  margin-top: 3px;
}

.security__actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.sessions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

.sessions li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.session-agent {
  font-size: 12px;
  word-break: break-all;
}

.current {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 10px;
}

.secret {
  display: block;
  margin: 8px 0;
  padding: 10px;
  border-radius: 8px;
  background: #f3f7f7;
  font-size: 15px;
  letter-spacing: 1px;
  word-break: break-all;
}

.otpauth {
  color: var(--ink-400);
  font-size: 10px;
  word-break: break-all;
}

.code-input {
  margin-top: 10px;
}

.recovery-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-top: 10px;
}

.recovery-grid code {
  padding: 6px 8px;
  border-radius: 6px;
  background: #f3f7f7;
  font-size: 13px;
  letter-spacing: 1px;
}
</style>
