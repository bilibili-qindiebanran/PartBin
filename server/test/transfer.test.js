import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, destroyFixture, createAdminAccount, createUserAccount, request } from './helpers.js';

const CSV_HEADER = '名称,编号,分类,位置,数量,低库存阈值,型号,单位\r\n';

describe('CSV 导入导出', () => {
  let ctx;
  let admin;
  let viewer;

  beforeEach(async () => {
    ctx = await createFixture();
    admin = await createAdminAccount(ctx);
    viewer = await createUserAccount(ctx, 'viewer');
  });

  afterEach(async () => {
    await destroyFixture(ctx);
  });

  function csvRequest(url, body, cookie = admin.cookie) {
    return request(ctx.app, {
      method: 'POST',
      url,
      cookie,
      headers: { 'content-type': 'text/csv' },
      payload: body,
    });
  }

  async function createExisting() {
    const response = await request(ctx.app, {
      method: 'POST',
      url: '/api/items',
      cookie: admin.cookie,
      payload: { name: '旧电阻包', code: 'OLD-1', quantity: 2, unit: '包' },
    });
    return response.json().item;
  }

  it('预览不写库，确认后创建/更新并生成流水', async () => {
    const existing = await createExisting();
    const csv =
      CSV_HEADER +
      '新开发板,NEW-1,开发板/单片机,A柜/抽屉3/盒12,5,2,STM32F103,块\r\n' +
      '旧电阻包,OLD-1,,,5,0,,包\r\n';

    const before = await request(ctx.app, { url: '/api/items', cookie: admin.cookie });
    expect(before.json().total).toBe(1);

    const preview = await csvRequest('/api/import/preview', csv);
    expect(preview.statusCode).toBe(200);
    expect(preview.json().summary.create).toBe(1);
    expect(preview.json().summary.update).toBe(1);

    const still = await request(ctx.app, { url: '/api/items', cookie: admin.cookie });
    expect(still.json().total).toBe(1);

    const commit = await csvRequest('/api/import/commit', csv);
    expect(commit.statusCode).toBe(200);
    expect(commit.json().summary.create).toBe(1);
    expect(commit.json().summary.quantityAdjusted).toBe(1);
    expect(commit.json().summary.createdCategories).toBe(2);

    const list = await request(ctx.app, { url: '/api/items', cookie: admin.cookie });
    expect(list.json().total).toBe(2);
    const updated = list.json().data.find((item) => item.code === 'OLD-1');
    expect(updated.quantity).toBe(5);
    expect(updated.categoryPath).toBeNull();

    const movements = await request(ctx.app, {
      url: `/api/items/${existing.id}/movements`,
      cookie: admin.cookie,
    });
    expect(movements.json().data[0].type).toBe('adjust');
    expect(movements.json().data[0].quantityDelta).toBe(3);
  });

  it('重复导入变为 unchanged；坏行返回错误且拒绝提交', async () => {
    const csv = CSV_HEADER + '电阻,RES-1,,,10,0,,个\r\n';
    await csvRequest('/api/import/commit', csv);

    const again = await csvRequest('/api/import/preview', csv);
    expect(again.json().summary.unchanged).toBe(1);

    const bad = CSV_HEADER + '坏行,BAD-1,,,abc,0,,个\r\n';
    const preview = await csvRequest('/api/import/preview', bad);
    expect(preview.json().summary.error).toBe(1);

    const commit = await csvRequest('/api/import/commit', bad);
    expect(commit.statusCode).toBe(400);
    expect(commit.json().error.code).toBe('VALIDATION');
  });

  it('导出带 BOM、中文表头并转义公式注入', async () => {
    await request(ctx.app, {
      method: 'POST',
      url: '/api/items',
      cookie: admin.cookie,
      payload: { name: '测试', code: 'T-1', quantity: 1, note: '=SUM(A1:A2)' },
    });

    const exported = await request(ctx.app, {
      url: '/api/export/items.csv',
      cookie: viewer.cookie,
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.body.startsWith('\uFEFF')).toBe(true);
    expect(exported.body).toContain('名称,编号');
    expect(exported.body).toContain("'=SUM(A1:A2)");

    const movements = await request(ctx.app, {
      url: '/api/export/movements.csv',
      cookie: admin.cookie,
    });
    expect(movements.statusCode).toBe(200);
    expect(movements.body).toContain('操作后余额');
  });

  it('只读账号不能导入但可以导出', async () => {
    const csv = CSV_HEADER + '只读测试,RO-1,,,1,0,,个\r\n';
    const preview = await csvRequest('/api/import/preview', csv, viewer.cookie);
    expect(preview.statusCode).toBe(403);

    const exported = await request(ctx.app, {
      url: '/api/export/loans.csv',
      cookie: viewer.cookie,
    });
    expect(exported.statusCode).toBe(200);
  });
});
