import { defineStore } from 'pinia';
import { api } from '@/api/client';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,
    allowRegistration: true,
    registrationMode: 'invite',
    hasUsers: true,
    totpEnabled: false,
    siteName: 'PartBin',
    checked: false,
    loading: false,
  }),

  getters: {
    isLoggedIn: (state) => Boolean(state.user),
    canWrite: (state) => state.user?.role === 'admin',
    roleLabel: (state) => (state.user?.role === 'admin' ? '管理员' : '只读'),
  },

  actions: {
    async fetchConfig() {
      const config = await api('/api/auth/config');
      this.allowRegistration = Boolean(config.allowRegistration);
      this.registrationMode = config.registrationMode || 'invite';
      this.hasUsers = Boolean(config.hasUsers);
      this.siteName = config.siteName || this.siteName;
      return config;
    },

    /** 首次进入时恢复登录态；401 视为未登录 */
    async bootstrap() {
      if (this.checked) return;

      try {
        await this.fetchConfig();
      } catch (error) {
        console.error('[auth] 获取站点配置失败', error);
      }

      try {
        const me = await api('/api/auth/me');
        this.user = me.user;
        this.allowRegistration = Boolean(me.allowRegistration);
        this.registrationMode = me.registrationMode || 'invite';
        this.hasUsers = Boolean(me.hasUsers);
        this.totpEnabled = Boolean(me.totpEnabled);
      } catch (error) {
        if (error.status !== 401) console.error('[auth] 获取当前用户失败', error);
        this.user = null;
      } finally {
        this.checked = true;
      }
    },

    async login(username, password, factors = {}) {
      this.loading = true;
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: { username, password, ...factors },
        });
        this.user = data.user;
        this.totpEnabled = Boolean(data.totpEnabled);
        this.checked = true;
        return data;
      } finally {
        this.loading = false;
      }
    },

    async register(username, password, inviteCode = undefined) {
      this.loading = true;
      try {
        const data = await api('/api/auth/register', {
          method: 'POST',
          body: { username, password, inviteCode },
        });
        this.user = data.user;
        this.hasUsers = true;
        this.checked = true;
        return data;
      } finally {
        this.loading = false;
      }
    },

    async logout() {
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } catch (error) {
        console.warn('[auth] 退出登录请求失败', error);
      } finally {
        this.user = null;
        this.checked = true;
      }
    },
  },
});
