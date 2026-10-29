import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentStep, totpAt } from '../src/lib/totp.js';
import {
  createAdminAccount,
  createFixture,
  destroyFixture,
  loginUser,
  request,
  TEST_PASSWORD,
} from './helpers.js';

describe('TOTP 双因素', () => {
  let ctx;
  let admin;

  beforeEach(async () => {
    ctx = await createFixture();
    admin = await createAdminAccount(ctx);
  });

  afterEach(async () => {
    await destroyFixture(ctx);
  });

  it('绑定需要 reauth，错误验证码不能启用', async () => {
    const noReauth = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/totp/setup',
      cookie: admin.cookie,
    });
    expect(noReauth.statusCode).toBe(403);
    expect(noReauth.json().error.code).toBe('REAUTH_REQUIRED');

    const reauth = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/reauth',
      cookie: admin.cookie,
      payload: { password: TEST_PASSWORD },
    });
    expect(reauth.statusCode).toBe(200);

    const setup = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/totp/setup',
      cookie: admin.cookie,
    });
    expect(setup.statusCode).toBe(200);
    expect(setup.json().secret).toMatch(/^[A-Z2-7]+$/);
    expect(setup.json().otpauthUrl).toContain('otpauth://totp/');

    const wrong = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/totp/enable',
      cookie: admin.cookie,
      payload: { code: '000000' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('INVALID_TOTP');
  });

  it('启用、登录二次验证、恢复码与关闭', async () => {
    const reauth = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/reauth',
      cookie: admin.cookie,
      payload: { password: TEST_PASSWORD },
    });
    expect(reauth.statusCode).toBe(200);

    const setup = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/totp/setup',
      cookie: admin.cookie,
    });
    const secret = setup.json().secret;

    const enabled = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/totp/enable',
      cookie: admin.cookie,
      payload: { code: totpAt(secret, currentStep()) },
    });
    expect(enabled.statusCode).toBe(200);
    const recoveryCodes = enabled.json().recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);

    const me = await request(ctx.app, { url: '/api/auth/me', cookie: admin.cookie });
    expect(me.json().totpEnabled).toBe(true);

    const withoutCode = await loginUser(ctx.app, 'admin');
    expect(withoutCode.res.statusCode).toBe(401);
    expect(withoutCode.body.error.code).toBe('TOTP_REQUIRED');

    const login = await loginUser(ctx.app, 'admin');
    const nextCode = totpAt(secret, currentStep() + 1);
    const verified = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: TEST_PASSWORD, totpCode: nextCode },
    });
    expect(verified.statusCode).toBe(200);

    const recoveryLogin = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: 'admin',
        password: TEST_PASSWORD,
        recoveryCode: recoveryCodes[0],
      },
    });
    expect(recoveryLogin.statusCode).toBe(200);

    const reuse = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: 'admin',
        password: TEST_PASSWORD,
        recoveryCode: recoveryCodes[0],
      },
    });
    expect(reuse.statusCode).toBe(401);

    // 用另一枚恢复码建立新会话后关闭
    const fresh = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: 'admin',
        password: TEST_PASSWORD,
        recoveryCode: recoveryCodes[1],
      },
    });
    expect(fresh.statusCode).toBe(200);

    const disabled = await request(ctx.app, {
      method: 'POST',
      url: '/api/auth/totp/disable',
      cookie: admin.cookie,
      payload: {
        password: TEST_PASSWORD,
        code: totpAt(secret, currentStep() + 1),
      },
    });
    expect(disabled.statusCode).toBe(200);

    const passwordOnly = await loginUser(ctx.app, 'admin');
    expect(passwordOnly.res.statusCode).toBe(200);
  });
});
