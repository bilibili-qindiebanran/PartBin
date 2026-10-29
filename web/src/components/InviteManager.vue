<template>
  <div class="invites">
    <div class="invite-form">
      <el-input-number v-model="form.maxUses" :min="1" :max="100" controls-position="right" />
      <el-input-number v-model="form.expiresInHours" :min="1" :max="720" controls-position="right" />
      <el-select v-model="form.role" class="role">
        <el-option label="只读用户" value="user" />
        <el-option label="管理员" value="admin" />
      </el-select>
      <el-input v-model="form.note" maxlength="200" placeholder="备注（可选）" class="note" />
      <el-button type="primary" :loading="creating" @click="createInvite">生成邀请码</el-button>
    </div>
    <p class="hint">可用次数与有效期从生成时开始计算；生成和撤销都需要重新验证密码。</p>

    <div v-if="createdCode" class="created">
      <p>新邀请码（只显示这一次）：</p>
      <code>{{ createdCode }}</code>
      <el-button text type="primary" @click="copyCode">复制</el-button>
    </div>

    <div v-if="invites.length > 0" class="invite-list">
      <article v-for="invite in invites" :key="invite.id" class="invite-item">
        <div>
          <div class="invite-item__head">
            <el-tag size="small" :type="statusType(invite.status)" round effect="plain">
              {{ statusLabel(invite.status) }}
            </el-tag>
            <span class="muted">{{ invite.role === 'admin' ? '管理员' : '只读' }}</span>
            <span class="muted">{{ invite.usedCount }} / {{ invite.maxUses }} 次</span>
          </div>
          <p class="muted">
            到期 {{ formatDate(invite.expiresAt, { withTime: true }) }} · 创建人
            {{ invite.createdByName || '—' }}
            <span v-if="invite.note"> · {{ invite.note }}</span>
          </p>
        </div>
        <el-button text type="danger" size="small" @click="revoke(invite)">撤销</el-button>
      </article>
    </div>
    <p v-else-if="!loading" class="muted">还没有邀请码。</p>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api/client';
import { formatDate } from '@/lib/format';
import { ensureReauth } from '@/lib/reauth';

const invites = ref([]);
const loading = ref(false);
const creating = ref(false);
const createdCode = ref('');
const form = reactive({ maxUses: 1, expiresInHours: 168, role: 'user', note: '' });

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

async function load() {
  loading.value = true;
  try {
    const data = await api('/api/invites');
    invites.value = data.data;
  } catch (error) {
    ElMessage.error(error.message || '加载邀请码失败');
  } finally {
    loading.value = false;
  }
}

async function createInvite() {
  if (!(await reauthOrCancel())) return;
  creating.value = true;
  try {
    const data = await api('/api/invites', {
      method: 'POST',
      body: {
        maxUses: form.maxUses,
        expiresInHours: form.expiresInHours,
        role: form.role,
        note: form.note.trim() || null,
      },
    });
    createdCode.value = data.code;
    ElMessage.success('邀请码已生成');
    await load();
  } catch (error) {
    ElMessage.error(error.message || '生成失败');
  } finally {
    creating.value = false;
  }
}

async function revoke(invite) {
  try {
    await ElMessageBox.confirm('撤销后该邀请码立即失效。', '撤销邀请码', {
      type: 'warning',
      confirmButtonText: '撤销',
      cancelButtonText: '取消',
    });
    if (!(await reauthOrCancel())) return;
    await api(`/api/invites/${invite.id}`, { method: 'DELETE' });
    ElMessage.success('已撤销');
    await load();
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(error.message || '撤销失败');
  }
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(createdCode.value);
    ElMessage.success('已复制');
  } catch {
    ElMessage.warning('复制失败，请手动抄录');
  }
}

function statusLabel(status) {
  return { active: '可用', expired: '已过期', exhausted: '已用完' }[status] ?? status;
}

function statusType(status) {
  return { active: 'success', expired: 'info', exhausted: 'warning' }[status] ?? 'info';
}

onMounted(load);
</script>

<style scoped>
.invites {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.invite-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.invite-form .role {
  width: 120px;
}

.invite-form .note {
  flex: 1;
  min-width: 140px;
}

.hint {
  color: var(--ink-400);
  font-size: 11px;
}

.created {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 12px;
}

.created code {
  font-size: 14px;
  letter-spacing: 1px;
}

.invite-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.invite-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
}

.invite-item__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.invite-item .muted {
  margin-top: 3px;
  font-size: 11px;
}
</style>
