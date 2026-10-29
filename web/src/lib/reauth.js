import { ElMessageBox } from 'element-plus';
import { api } from '@/api/client';

let lastReauthAt = 0;
const REAUTH_WINDOW_MS = 9 * 60 * 1000;

/** 弹出密码框并调用 reauth；9 分钟内重复调用直接复用。取消时抛出 'cancel' */
export async function ensureReauth({ force = false } = {}) {
  if (!force && Date.now() - lastReauthAt < REAUTH_WINDOW_MS) return;

  const result = await ElMessageBox.prompt('请输入当前密码以继续。10 分钟内有效。', '安全验证', {
    inputType: 'password',
    inputPlaceholder: '当前密码',
    confirmButtonText: '继续',
    cancelButtonText: '取消',
  });
  await api('/api/auth/reauth', {
    method: 'POST',
    body: { password: result.value },
  });
  lastReauthAt = Date.now();
}
