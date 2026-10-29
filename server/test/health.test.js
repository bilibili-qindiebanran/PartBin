import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, destroyFixture, request } from './helpers.js';

describe('健康检查', () => {
  let ctx;
  beforeEach(async () => {
    ctx = await createFixture();
  });
  afterEach(async () => {
    await destroyFixture(ctx);
  });

  it('公开 /health 返回数据库状态且不泄露配置', async () => {
    const res = await request(ctx.app, { url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: 'ok', db: 'ok' });
    expect(typeof body.version).toBe('string');
    expect(JSON.stringify(body)).not.toContain('APP_SECRET');
    expect(JSON.stringify(body)).not.toContain(ctx.dir);
  });

  it('数据库不可用时返回 503', async () => {
    const original = ctx.app.db.prepare.bind(ctx.app.db);
    ctx.app.db.prepare = () => {
      throw new Error('database is down');
    };
    try {
      const res = await request(ctx.app, { url: '/health' });
      expect(res.statusCode).toBe(503);
      expect(res.json().db).toBe('error');
    } finally {
      ctx.app.db.prepare = original;
    }
  });
});
