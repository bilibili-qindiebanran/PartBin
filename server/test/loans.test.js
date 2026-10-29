import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, destroyFixture, registerUser, request } from './helpers.js';

describe('借出与归还', () => {
  let ctx;
  let admin;
  let viewer;

  beforeEach(async () => {
    ctx = await createFixture();
    admin = await registerUser(ctx.app, 'admin');
    viewer = await registerUser(ctx.app, 'viewer');
  });

  afterEach(async () => {
    await destroyFixture(ctx);
  });

  function call(method, url, payload, cookie = admin.cookie) {
    return request(ctx.app, { method, url, cookie, payload });
  }

  async function createItem(payload = {}) {
    const response = await call('POST', '/api/items', {
      name: '开发板',
      unit: '块',
      quantity: 5,
      ...payload,
    });
    expect(response.statusCode).toBe(201);
    return response.json().item;
  }

  it('借出不影响拥有量但减少可用量，支持部分归还', async () => {
    const item = await createItem();

    const loan = await call('POST', '/api/loans', {
      itemId: item.id,
      quantity: 3,
      borrower: '张三',
      dueAt: '2026-12-31',
    });
    expect(loan.statusCode).toBe(201);
    expect(loan.json().available).toBe(2);
    expect(loan.json().loan.remaining).toBe(3);

    let detail = await call('GET', `/api/items/${item.id}`);
    expect(detail.json().item.quantity).toBe(5);
    expect(detail.json().item.lentQuantity).toBe(3);
    expect(detail.json().item.available).toBe(2);

    const returned = await call('POST', `/api/loans/${loan.json().loan.id}/return`, { quantity: 1 });
    expect(returned.json().remaining).toBe(2);
    expect(returned.json().loan.returnedQuantity).toBe(1);

    detail = await call('GET', `/api/items/${item.id}`);
    expect(detail.json().item.available).toBe(3);

    const allReturned = await call('POST', `/api/loans/${loan.json().loan.id}/return`, { quantity: 2 });
    expect(allReturned.json().loan.returnedAt).toBeTruthy();

    const open = await call('GET', '/api/loans?status=open');
    expect(open.json().total).toBe(0);

    const movements = await call('GET', '/api/movements');
    expect(movements.json().data.some((row) => row.type === 'borrow')).toBe(true);
    expect(movements.json().data.filter((row) => row.type === 'return')).toHaveLength(2);
  });

  it('超过可用量借出返回 409', async () => {
    const item = await createItem({ quantity: 2 });
    const response = await call('POST', '/api/loans', {
      itemId: item.id,
      quantity: 3,
      borrower: '李四',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('实例借出会置为 lent，归还后回到 in_stock', async () => {
    const item = await createItem({ name: '逻辑分析仪', trackingMode: 'instance', quantity: undefined });
    const created = await call('POST', `/api/items/${item.id}/instances`, { assetNo: 'LA-1' });
    const instance = created.json().instance;

    const loan = await call('POST', '/api/loans', {
      itemId: item.id,
      instanceId: instance.id,
      quantity: 1,
      borrower: '王五',
    });
    expect(loan.statusCode).toBe(201);

    let instances = await call('GET', `/api/items/${item.id}/instances`);
    expect(instances.json().data[0].status).toBe('lent');

    await call('POST', `/api/loans/${loan.json().loan.id}/return`, { quantity: 1 });

    instances = await call('GET', `/api/items/${item.id}/instances`);
    expect(instances.json().data[0].status).toBe('in_stock');
  });

  it('逾期筛选与撤销借出', async () => {
    const item = await createItem();

    const loan = await call('POST', '/api/loans', {
      itemId: item.id,
      quantity: 1,
      borrower: '赵六',
      dueAt: '2026-12-31',
    });
    expect(loan.statusCode).toBe(201);

    // 模拟已经逾期（直接改库，避免借出校验阻挡过去的日期）
    ctx.app.db
      .prepare('UPDATE loan SET due_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', loan.json().loan.id);

    const overdue = await call('GET', '/api/loans?status=overdue');
    expect(overdue.json().total).toBe(1);
    expect(overdue.json().data[0].overdue).toBe(true);

    const cancelled = await call('DELETE', `/api/loans/${loan.json().loan.id}`);
    expect(cancelled.statusCode).toBe(200);

    const loans = await call('GET', '/api/loans');
    expect(loans.json().total).toBe(0);

    const movements = await call('GET', '/api/movements');
    expect(movements.json().data.some((row) => row.type === 'borrow')).toBe(false);
  });

  it('只读账号不能借出或归还', async () => {
    const item = await createItem();
    const response = await call(
      'POST',
      '/api/loans',
      { itemId: item.id, quantity: 1, borrower: '张三' },
      viewer.cookie,
    );
    expect(response.statusCode).toBe(403);

    const list = await call('GET', '/api/loans', undefined, viewer.cookie);
    expect(list.statusCode).toBe(200);
  });
});
