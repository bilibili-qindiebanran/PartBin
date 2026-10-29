import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/env.js';
import { createAdmin } from '../src/services/users.js';
import {
  createFixture,
  destroyFixture,
  registerUser,
  request,
} from './helpers.js';

describe('M6 安全基础设施', () => {
  it('下发 CSP/COOP 等安全头，HTTPS 下才发 HSTS', async () => {
    const ctx = await createFixture();
    const secure = await createFixture({
      cookieSecure: true,
      appSecret: 'test-secret-for-security-suite',
      publicOrigin: 'https://partbin.example.com',
    });
    try {
      const plain = await request(ctx.app, { url: '/health' });
      expect(plain.headers['content-security-policy']).toContain("default-src 'self'");
      expect(plain.headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(plain.headers['strict-transport-security']).toBeUndefined();

      const https = await request(secure.app, { url: '/health' });
      expect(https.headers['strict-transport-security']).toContain('max-age=');
    } finally {
      await destroyFixture(ctx);
      await destroyFixture(secure);
    }
  });

  it('会话绝对过期时间不会被滑动续期绕过', async () => {
    const ctx = await createFixture();
    try {
      const admin = await registerUser(ctx.app, 'admin');
      const me = await request(ctx.app, { url: '/api/auth/me', cookie: admin.cookie });
      expect(me.statusCode).toBe(200);

      ctx.app.db
        .prepare("UPDATE session SET absolute_expires_at = '2000-01-01T00:00:00.000Z'")
        .run();

      const expired = await request(ctx.app, { url: '/api/auth/me', cookie: admin.cookie });
      expect(expired.statusCode).toBe(401);
    } finally {
      await destroyFixture(ctx);
    }
  });

  it('创建邀请码需要重新验证密码，并写审计', async () => {
    const ctx = await createFixture();
    try {
      const admin = await registerUser(ctx.app, 'admin');
      const viewer = await registerUser(ctx.app, 'viewer');

      const withoutReauth = await request(ctx.app, {
        method: 'POST',
        url: '/api/invites',
        cookie: admin.cookie,
        payload: { maxUses: 2, expiresInHours: 24 },
      });
      expect(withoutReauth.statusCode).toBe(403);
      expect(withoutReauth.json().error.code).toBe('REAUTH_REQUIRED');

      const reauth = await request(ctx.app, {
        method: 'POST',
        url: '/api/auth/reauth',
        cookie: admin.cookie,
        payload: { password: 'password123' },
      });
      expect(reauth.statusCode).toBe(200);

      const created = await request(ctx.app, {
        method: 'POST',
        url: '/api/invites',
        cookie: admin.cookie,
        payload: { maxUses: 2, expiresInHours: 24, note: '给同学' },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().code).toMatch(/^PB-[A-Z2-7]{4}-/);

      const list = await request(ctx.app, { url: '/api/invites', cookie: admin.cookie });
      expect(list.statusCode).toBe(200);
      expect(list.json().data[0].status).toBe('active');
      expect(list.json().data[0].usedCount).toBe(0);

      const audit = ctx.app.db
        .prepare("SELECT action FROM audit_log WHERE action = 'invite.create'")
        .get();
      expect(audit).toBeTruthy();

      await request(ctx.app, {
        method: 'POST',
        url: '/api/auth/reauth',
        cookie: viewer.cookie,
        payload: { password: 'password123' },
      });
      const forbidden = await request(ctx.app, {
        method: 'POST',
        url: '/api/invites',
        cookie: viewer.cookie,
        payload: {},
      });
      expect(forbidden.statusCode).toBe(403);

      const revoked = await request(ctx.app, {
        method: 'DELETE',
        url: `/api/invites/${created.json().invite.id}`,
        cookie: admin.cookie,
      });
      expect(revoked.statusCode).toBe(200);
    } finally {
      await destroyFixture(ctx);
    }
  });

  it('CLI 使用 createAdmin 可直接建管理员，且用户名唯一', async () => {
    const ctx = await createFixture();
    try {
      const user = createAdmin(ctx.app.db, {
        username: 'CyanButterfly',
        password: 'password123',
      });
      expect(user.role).toBe('admin');
      expect(() =>
        createAdmin(ctx.app.db, { username: 'CyanButterfly', password: 'password123' }),
      ).toThrow(/占用/);
    } finally {
      await destroyFixture(ctx);
    }
  });

  it('生产环境缺少 APP_SECRET 或 PUBLIC_ORIGIN 时拒绝启动', () => {
    expect(() => loadConfig({ nodeEnv: 'production', dataDir: '/tmp/partbin-test' })).toThrow(
      /APP_SECRET/,
    );
    expect(() =>
      loadConfig({
        nodeEnv: 'production',
        dataDir: '/tmp/partbin-test',
        appSecret: 'a'.repeat(32),
      }),
    ).toThrow(/PUBLIC_ORIGIN/);
  });
});
