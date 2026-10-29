import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, destroyFixture, registerUser, request } from './helpers.js';

describe('实例管理', () => {
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
      name: '树莓派 4B',
      trackingMode: 'instance',
      unit: '台',
      ...payload,
    });
    expect(response.statusCode).toBe(201);
    return response.json().item;
  }

  it('批量创建实例并写一条入库流水', async () => {
    const item = await createItem();

    const batch = await call('POST', `/api/items/${item.id}/instances/batch`, {
      count: 5,
      prefix: 'RPI',
    });
    expect(batch.statusCode).toBe(201);
    expect(batch.json().instances).toHaveLength(5);
    expect(batch.json().instances[0].assetNo).toBe('RPI-001');
    expect(batch.json().instances[4].assetNo).toBe('RPI-005');

    const detail = await call('GET', `/api/items/${item.id}`);
    expect(detail.json().item.quantity).toBe(5);
    expect(detail.json().item.instanceCount).toBe(5);

    const movements = await call('GET', `/api/items/${item.id}/movements`);
    expect(movements.json().total).toBe(1);
    expect(movements.json().data[0].quantityDelta).toBe(5);
  });

  it('状态变更：维修不扣数量，退役扣 1 并写流水', async () => {
    const item = await createItem();
    const created = await call('POST', `/api/items/${item.id}/instances`, { assetNo: 'RPI-1' });
    const instance = created.json().instance;

    const broken = await call('PATCH', `/api/instances/${instance.id}`, { status: 'broken' });
    expect(broken.statusCode).toBe(200);
    let detail = await call('GET', `/api/items/${item.id}`);
    expect(detail.json().item.quantity).toBe(1);

    const retired = await call('PATCH', `/api/instances/${instance.id}`, { status: 'retired' });
    expect(retired.statusCode).toBe(200);
    detail = await call('GET', `/api/items/${item.id}`);
    expect(detail.json().item.quantity).toBe(0);

    const movements = await call('GET', `/api/items/${item.id}/movements`);
    expect(movements.json().data[0].type).toBe('discard');
    expect(movements.json().data[0].quantityDelta).toBe(-1);

    const resurrect = await call('PATCH', `/api/instances/${instance.id}`, { status: 'in_stock' });
    expect(resurrect.statusCode).toBe(409);
  });

  it('拒绝手工设置借出状态、重复资产编号与非实例制物料', async () => {
    const item = await createItem();
    await call('POST', `/api/items/${item.id}/instances`, { assetNo: 'RPI-1' });

    const duplicate = await call('POST', `/api/items/${item.id}/instances`, { assetNo: 'RPI-1' });
    expect(duplicate.statusCode).toBe(409);

    const lent = await call('PATCH', '/api/instances/1', { status: 'lent' });
    expect(lent.statusCode).toBe(400);

    const quantityItem = await call('POST', '/api/items', { name: '电阻包', quantity: 2 });
    const invalid = await call('POST', `/api/items/${quantityItem.json().item.id}/instances`, {});
    expect(invalid.statusCode).toBe(400);
  });

  it('只读账号不能登记或修改实例', async () => {
    const item = await createItem();
    const write = await call('POST', `/api/items/${item.id}/instances`, {}, viewer.cookie);
    expect(write.statusCode).toBe(403);

    const list = await call('GET', `/api/items/${item.id}/instances`, undefined, viewer.cookie);
    expect(list.statusCode).toBe(200);
  });
});
