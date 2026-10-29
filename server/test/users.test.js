import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFixture,
  destroyFixture,
  createAdminAccount,
  createUserAccount,
  loginUser,
  request,
  TEST_PASSWORD,
} from './helpers.js';

describe('用户管理与权限', () => {
  let ctx;
  let admin;
  let viewer;

  beforeEach(async () => {
    ctx = await createFixture();
    admin = await createAdminAccount(ctx);
    viewer = await createUserAccount(ctx, 'viewer');
    const reauth = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/reauth',
      cookie: admin.cookie,
      payload: { password: TEST_PASSWORD },
    });
    expect(reauth.statusCode).toBe(200);
  });

  afterEach(async () => {
    await destroyFixture(ctx);
  });

  it('只读账号无法访问管理接口或修改设置', async () => {
    const users = await request(ctx.app, {
      url: '/api/users',
      cookie: viewer.cookie,
    });
    expect(users.statusCode).toBe(403);
    expect(users.json().error.code).toBe('FORBIDDEN');

    const settings = await request(ctx.app, {
      method: 'PATCH',
      url: '/api/settings',
      cookie: viewer.cookie,
      payload: { allowRegistration: false },
    });
    expect(settings.statusCode).toBe(403);

    const anonymous = await request(ctx.app, { url: '/api/users' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('管理员可以提升角色，提升后可访问管理接口', async () => {
    const promote = await request(ctx.app, {
      method: 'PATCH',
      url: '/api/users/2',
      cookie: admin.cookie,
      payload: { role: 'admin' },
    });
    expect(promote.statusCode).toBe(200);
    expect(promote.json().user.role).toBe('admin');

    const users = await request(ctx.app, {
      url: '/api/users',
      cookie: viewer.cookie,
    });
    expect(users.statusCode).toBe(200);
    expect(users.json().data).toHaveLength(2);
  });

  it('保护最后一个管理员，且不能禁用自己', async () => {
    const demote = await request(ctx.app, {
      method: 'PATCH',
      url: '/api/users/1',
      cookie: admin.cookie,
      payload: { role: 'user' },
    });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().error.code).toBe('LAST_ADMIN');

    const disableSelf = await request(ctx.app, {
      method: 'PATCH',
      url: '/api/users/1',
      cookie: admin.cookie,
      payload: { isActive: false },
    });
    expect(disableSelf.statusCode).toBe(409);
    expect(disableSelf.json().error.code).toBe('CANNOT_DISABLE_SELF');
  });

  it('禁用用户会使其现有会话立即失效并无法登录', async () => {
    const disabled = await request(ctx.app, {
      method: 'PATCH',
      url: '/api/users/2',
      cookie: admin.cookie,
      payload: { isActive: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().user.isActive).toBe(false);

    const me = await request(ctx.app, {
      url: '/api/auth/me',
      cookie: viewer.cookie,
    });
    expect(me.statusCode).toBe(401);

    const login = await loginUser(ctx.app, 'viewer');
    expect(login.res.statusCode).toBe(401);
  });

  it('管理员重置密码后旧密码失效、会话被吊销', async () => {
    const reset = await request(ctx.app, {
      method: 'POST',
      url: '/api/users/2/reset-password',
      cookie: admin.cookie,
      payload: { newPassword: 'resetpassword789' },
    });
    expect(reset.statusCode).toBe(200);

    const oldSession = await request(ctx.app, {
      url: '/api/auth/me',
      cookie: viewer.cookie,
    });
    expect(oldSession.statusCode).toBe(401);

    const oldPassword = await loginUser(ctx.app, 'viewer');
    expect(oldPassword.res.statusCode).toBe(401);

    const newPassword = await loginUser(ctx.app, 'viewer', 'resetpassword789');
    expect(newPassword.res.statusCode).toBe(200);
  });

  it('管理员重置自己的密码会要求重新登录', async () => {
    const reset = await request(ctx.app, {
      method: 'POST',
      url: '/api/users/1/reset-password',
      cookie: admin.cookie,
      payload: { newPassword: 'selfreset456' },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().mustRelogin).toBe(true);

    const me = await request(ctx.app, {
      url: '/api/auth/me',
      cookie: admin.cookie,
    });
    expect(me.statusCode).toBe(401);
  });

  it('参数校验与不存在的用户', async () => {
    const badRole = await request(ctx.app, {
      method: 'PATCH',
      url: '/api/users/2',
      cookie: admin.cookie,
      payload: { role: 'root' },
    });
    expect(badRole.statusCode).toBe(400);

    const emptyPatch = await request(ctx.app, {
      method: 'PATCH',
      url: '/api/users/2',
      cookie: admin.cookie,
      payload: {},
    });
    expect(emptyPatch.statusCode).toBe(400);

    const missing = await request(ctx.app, {
      method: 'PATCH',
      url: '/api/users/999',
      cookie: admin.cookie,
      payload: { isActive: false },
    });
    expect(missing.statusCode).toBe(404);
  });
});
