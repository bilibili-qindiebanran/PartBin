import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFixture,
  destroyFixture,
  loginUser,
  registerUser,
  request,
} from './helpers.js';

describe('注册与登录', () => {
  let ctx;

  beforeEach(async () => {
    ctx = await createFixture();
  });

  afterEach(async () => {
    await destroyFixture(ctx);
  });

  it('首个注册者是管理员，第二个是只读用户', async () => {
    const admin = await registerUser(ctx.app, 'admin');
    expect(admin.res.statusCode).toBe(201);
    expect(admin.body.firstUser).toBe(true);
    expect(admin.body.user.role).toBe('admin');
    expect(admin.cookie).toMatch(/^inv_sid=/);

    const viewer = await registerUser(ctx.app, 'viewer');
    expect(viewer.res.statusCode).toBe(201);
    expect(viewer.body.firstUser).toBe(false);
    expect(viewer.body.user.role).toBe('user');

    const config = await request(ctx.app, { url: '/api/auth/config' });
    expect(config.json()).toMatchObject({ hasUsers: true, allowRegistration: true });
  });

  it('用户名大小写不敏感去重', async () => {
    await registerUser(ctx.app, 'AdminUser');
    const duplicate = await registerUser(ctx.app, 'adminuser');
    expect(duplicate.res.statusCode).toBe(409);
    expect(duplicate.body.error.code).toBe('USERNAME_TAKEN');
  });

  it('拒绝非法用户名与弱密码', async () => {
    const badName = await registerUser(ctx.app, 'a!');
    expect(badName.res.statusCode).toBe(400);
    expect(badName.body.error.code).toBe('VALIDATION');

    const badPassword = await registerUser(ctx.app, 'someone', '123');
    expect(badPassword.res.statusCode).toBe(400);

    const sameAsName = await registerUser(ctx.app, 'sameasname', 'sameasname');
    expect(sameAsName.res.statusCode).toBe(400);
  });

  it('登录、获取当前用户、退出', async () => {
    await registerUser(ctx.app, 'admin');

    const me = await request(ctx.app, {
      url: '/api/auth/me',
      cookie: (await loginUser(ctx.app, 'admin')).cookie,
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe('admin');

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
    await registerUser(ctx.app, 'admin');
    const res = await loginUser(ctx.app, 'admin', 'wrongpassword');
    expect(res.res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error.message).toBe('账号或密码错误');
  });

  it('会话过期后立即失效', async () => {
    await registerUser(ctx.app, 'admin');
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
    await registerUser(ctx.app, 'admin');
    const other = await loginUser(ctx.app, 'admin');
    const current = await loginUser(ctx.app, 'admin');

    const changed = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/password',
      cookie: current.cookie,
      payload: { currentPassword: 'password123', newPassword: 'newpassword456' },
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

    const newPassword = await loginUser(ctx.app, 'admin', 'newpassword456');
    expect(newPassword.res.statusCode).toBe(200);
  });

  it('登录失败达到阈值后返回 429 与 Retry-After', async () => {
    await registerUser(ctx.app, 'admin');

    for (let i = 0; i < 5; i += 1) {
      const attempt = await loginUser(ctx.app, 'admin', 'wrongpassword');
      expect(attempt.res.statusCode).toBe(401);
    }

    const blocked = await loginUser(ctx.app, 'admin', 'wrongpassword');
    expect(blocked.res.statusCode).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.res.headers['retry-after']).toBeTruthy();
  });

  it('管理员关闭注册后新用户无法注册', async () => {
    const admin = await registerUser(ctx.app, 'admin');

    const closed = await request(ctx.app, {
      method: 'PATCH',
      url: '/api/settings',
      cookie: admin.cookie,
      payload: { allowRegistration: false },
    });
    expect(closed.statusCode).toBe(200);

    const blocked = await registerUser(ctx.app, 'newcomer');
    expect(blocked.res.statusCode).toBe(403);
    expect(blocked.body.error.code).toBe('REGISTRATION_CLOSED');

    const config = await request(ctx.app, { url: '/api/auth/config' });
    expect(config.json().allowRegistration).toBe(false);
  });

  it('拒绝跨站来源的状态变更请求', async () => {
    const res = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'password123' },
      headers: { origin: 'http://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });
});
