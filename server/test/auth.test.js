import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFixture,
  destroyFixture,
  createAdminAccount,
  loginUser,
  registerUser,
  request,
  TEST_PASSWORD,
} from './helpers.js';

async function makeInvite(admin, options = {}) {
  const reauth = await request(admin.app, {
    method: 'POST',
    url: '/api/auth/reauth',
    cookie: admin.cookie,
    payload: { password: TEST_PASSWORD },
  });
  expect(reauth.statusCode).toBe(200);

  const res = await request(admin.app, {
    method: 'POST',
    url: '/api/invites',
    cookie: admin.cookie,
    payload: { maxUses: 1, expiresInHours: 24, ...options },
  });
  expect(res.statusCode).toBe(201);
  return res.json().code;
}

describe('注册与登录', () => {
  let ctx;

  beforeEach(async () => {
    ctx = await createFixture();
  });

  afterEach(async () => {
    await destroyFixture(ctx);
  });

  it('默认邀请制注册：无邀请码拒绝，有邀请码创建普通用户', async () => {
    const admin = await createAdminAccount(ctx);
    admin.app = ctx.app;

    const config = await request(ctx.app, { url: '/api/auth/config' });
    expect(config.json()).toMatchObject({
      registrationMode: 'invite',
      allowRegistration: true,
      firstUserBecomesAdmin: false,
    });

    const missing = await registerUser(ctx.app, 'alice');
    expect(missing.res.statusCode).toBe(400);

    const code = await makeInvite(admin);
    const registered = await registerUser(ctx.app, 'alice', TEST_PASSWORD, code);
    expect(registered.res.statusCode).toBe(201);
    expect(registered.body.user.role).toBe('user');
    expect(registered.body.firstUser).toBe(false);
    expect(registered.cookie).toMatch(/^inv_sid=/);

    const reused = await registerUser(ctx.app, 'bob', TEST_PASSWORD, code);
    expect(reused.res.statusCode).toBe(400);
    expect(reused.body.error.message).toContain('用完');
  });

  it('邀请码可以指定管理员角色', async () => {
    const admin = await createAdminAccount(ctx);
    admin.app = ctx.app;
    const code = await makeInvite(admin, { role: 'admin' });
    const registered = await registerUser(ctx.app, 'second-admin', TEST_PASSWORD, code);
    expect(registered.body.user.role).toBe('admin');
  });

  it('用户名大小写不敏感去重', async () => {
    const admin = await createAdminAccount(ctx);
    admin.app = ctx.app;
    const code = await makeInvite(admin, { maxUses: 2 });

    const first = await registerUser(ctx.app, 'AdminUser', TEST_PASSWORD, code);
    expect(first.res.statusCode).toBe(201);
    const duplicate = await registerUser(ctx.app, 'adminuser', TEST_PASSWORD, code);
    expect(duplicate.res.statusCode).toBe(409);
    expect(duplicate.body.error.code).toBe('USERNAME_TAKEN');
  });

  it('拒绝非法用户名与弱密码', async () => {
    const admin = await createAdminAccount(ctx);
    admin.app = ctx.app;
    const code = await makeInvite(admin, { maxUses: 4 });

    const badName = await registerUser(ctx.app, 'a!', TEST_PASSWORD, code);
    expect(badName.res.statusCode).toBe(400);

    const shortPassword = await registerUser(ctx.app, 'someone', 'password123', code);
    expect(shortPassword.res.statusCode).toBe(400);
    expect(shortPassword.body.error.message).toContain('12');

    const weak = await registerUser(ctx.app, 'someone2', 'password12345', code);
    expect(weak.res.statusCode).toBe(400);

    const sameAsName = await registerUser(ctx.app, 'sameasname', 'sameasname', code);
    expect(sameAsName.res.statusCode).toBe(400);
  });

  it('登录、获取当前用户、退出', async () => {
    await createAdminAccount(ctx);

    const me = await request(ctx.app, {
      url: '/api/auth/me',
      cookie: (await loginUser(ctx.app, 'admin')).cookie,
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe('admin');
    expect(me.json().totpEnabled).toBe(false);

    const login = await loginUser(ctx.app, 'admin');
    expect(login.res.statusCode).toBe(200);

    const logout = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/logout',
      cookie: login.cookie,
    });
    expect(logout.statusCode).toBe(204);

    const afterLogout = await request(ctx.app, {
      url: '/api/auth/me',
      cookie: login.cookie,
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('错误密码返回统一文案', async () => {
    await createAdminAccount(ctx);
    const res = await loginUser(ctx.app, 'admin', 'wrongpassword123');
    expect(res.res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error.message).toBe('账号或密码错误');
  });

  it('会话过期后立即失效', async () => {
    await createAdminAccount(ctx);
    const login = await loginUser(ctx.app, 'admin');

    ctx.app.db
      .prepare('UPDATE session SET expires_at = ? WHERE user_id = 1')
      .run('2000-01-01T00:00:00.000Z');

    const me = await request(ctx.app, {
      url: '/api/auth/me',
      cookie: login.cookie,
    });
    expect(me.statusCode).toBe(401);
  });

  it('改密会吊销其他设备会话，保留当前会话', async () => {
    await createAdminAccount(ctx);
    const other = await loginUser(ctx.app, 'admin');
    const current = await loginUser(ctx.app, 'admin');

    const changed = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/password',
      cookie: current.cookie,
      payload: { currentPassword: TEST_PASSWORD, newPassword: 'New-Test-Pass-2026' },
    });
    expect(changed.statusCode).toBe(200);

    const otherMe = await request(ctx.app, {
      url: '/api/auth/me',
      cookie: other.cookie,
    });
    expect(otherMe.statusCode).toBe(401);

    const currentMe = await request(ctx.app, {
      url: '/api/auth/me',
      cookie: current.cookie,
    });
    expect(currentMe.statusCode).toBe(200);

    const oldPassword = await loginUser(ctx.app, 'admin');
    expect(oldPassword.res.statusCode).toBe(401);

    const newPassword = await loginUser(ctx.app, 'admin', 'New-Test-Pass-2026');
    expect(newPassword.res.statusCode).toBe(200);
  });

  it('失败达到阈值后持久锁定账号，正确密码也暂时拒绝', async () => {
    await createAdminAccount(ctx);

    for (let i = 0; i < 4; i += 1) {
      const attempt = await loginUser(ctx.app, 'admin', 'wrongpassword123');
      expect(attempt.res.statusCode).toBe(401);
    }

    const fifth = await loginUser(ctx.app, 'admin', 'wrongpassword123');
    expect(fifth.res.statusCode).toBe(429);
    expect(fifth.res.headers['retry-after']).toBeTruthy();

    const correct = await loginUser(ctx.app, 'admin');
    expect(correct.res.statusCode).toBe(429);

    const locked = ctx.app.db
      .prepare('SELECT locked_until FROM user WHERE username_norm = ?')
      .get('admin');
    expect(locked.locked_until).toBeTruthy();
  });

  it('管理员关闭注册后即使有邀请码也无法注册', async () => {
    const admin = await createAdminAccount(ctx);
    admin.app = ctx.app;
    const code = await makeInvite(admin);

    const closed = await request(ctx.app, {
      method: 'PATCH',
      url: '/api/settings',
      cookie: admin.cookie,
      payload: { registrationMode: 'closed' },
    });
    expect(closed.statusCode).toBe(200);

    const blocked = await registerUser(ctx.app, 'newcomer', TEST_PASSWORD, code);
    expect(blocked.res.statusCode).toBe(403);
    expect(blocked.body.error.code).toBe('REGISTRATION_CLOSED');
  });

  it('开放注册模式下无需邀请码，但只创建普通用户', async () => {
    const admin = await createAdminAccount(ctx);
    admin.app = ctx.app;
    await request(ctx.app, {
      method: 'PATCH',
      url: '/api/settings',
      cookie: admin.cookie,
      payload: { registrationMode: 'open' },
    });

    const registered = await registerUser(ctx.app, 'open-user');
    expect(registered.res.statusCode).toBe(201);
    expect(registered.body.user.role).toBe('user');
  });

  it('拒绝跨站来源的状态变更请求', async () => {
    const res = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: TEST_PASSWORD },
      headers: { origin: 'http://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });
});
