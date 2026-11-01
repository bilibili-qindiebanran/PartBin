import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFixture,
  destroyFixture,
  createAdminAccount,
  createUserAccount,
  request,
} from './helpers.js';

const C2286 = {
  componentCode: 'C2286',
  componentId: 2659,
  erpComponentName: '0603 红灯 高亮',
  componentModelEn: 'KT-0603R',
  componentBrandEn: 'Hubei KENTO Elec',
  componentSpecificationEn: '0603',
  describe: '1.8V~2.4V 120° 20mA 红色 LED',
  secondSortName: 'Optoelectronics',
  stockCount: 1000,
  componentPrices: [{ startNumber: 1, productPrice: 0.0077 }],
  lcscGoodsUrl: 'https://www.lcsc.com/product-detail/x_C2286.html',
  dataManualUrl: 'https://example.com/C2286.pdf',
};

function mockFetch(list = [C2286]) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      code: 200,
      data: { componentPageInfo: { total: list.length, list } },
    }),
  });
}

describe('快速入库', () => {
  let ctx;
  let admin;
  let viewer;

  beforeEach(async () => {
    ctx = await createFixture({ lcscFetch: mockFetch() });
    admin = await createAdminAccount(ctx);
    viewer = await createUserAccount(ctx, 'viewer');
  });

  afterEach(async () => {
    await destroyFixture(ctx);
  });

  function call(method, url, payload, cookie = admin.cookie) {
    return request(ctx.app, { method, url, cookie, payload });
  }

  async function createItem(payload) {
    const response = await call('POST', '/api/items', payload);
    expect(response.statusCode).toBe(201);
    return response.json().item;
  }

  it('预览返回立创信息，且没有同名料号时 existing 为 null', async () => {
    const res = await call('POST', '/api/lcsc/quick-in/preview', { code: 'c2286' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.part).toMatchObject({ code: 'C2286', model: 'KT-0603R' });
    expect(body.existing).toBeNull();
  });

  it('预览能认出库存里已有同料号物料', async () => {
    const item = await createItem({
      name: '0603 红灯',
      lcscCode: 'C2286',
      quantity: 3,
    });

    const res = await call('POST', '/api/lcsc/quick-in/preview', { code: 'C2286' });
    expect(res.statusCode).toBe(200);
    expect(res.json().existing).toMatchObject({ id: item.id, quantity: 3 });
  });

  it('上游不可用时降级返回已有物料与提示', async () => {
    const item = await createItem({
      name: '0603 红灯',
      lcscCode: 'C2286',
      quantity: 3,
    });
    ctx.app.lcscFetch = async () => {
      throw new Error('network down');
    };

    const res = await call('POST', '/api/lcsc/quick-in/preview', { code: 'C2286' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.part).toBeNull();
    expect(body.existing).toMatchObject({ id: item.id });
    expect(body.warning).toContain('立创');
  });

  it('add 模式累加数量、写流水并补位置', async () => {
    const location = await call('POST', '/api/locations', { name: '工具柜' });
    const locationId = location.json().location.id;
    const item = await createItem({ name: '0603 红灯', lcscCode: 'C2286', quantity: 3 });

    const res = await call('POST', '/api/lcsc/quick-in', {
      mode: 'add',
      code: 'C2286',
      itemId: item.id,
      quantity: 10,
      locationId,
      orderNo: 'SO2610270429',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('add');
    expect(body.item).toMatchObject({
      id: item.id,
      quantity: 13,
      locationId,
      locationPath: '工具柜',
    });
    expect(body.movement).toMatchObject({ type: 'in', quantity: 10, balanceAfter: 13 });

    const movements = ctx.app.db
      .prepare('SELECT * FROM movement WHERE item_id = ? ORDER BY id')
      .all(item.id);
    expect(movements).toHaveLength(2);
    expect(movements[1].note).toBe('立创订单 SO2610270429');
    expect(movements[1].user_id).toBe(admin.body.user.id);
  });

  it('add 模式拒绝料号不一致或已归档的物料', async () => {
    const other = await createItem({ name: '别的料', lcscCode: 'C1000', quantity: 1 });
    const mismatch = await call('POST', '/api/lcsc/quick-in', {
      mode: 'add',
      code: 'C2286',
      itemId: other.id,
      quantity: 1,
    });
    expect(mismatch.statusCode).toBe(400);

    const item = await createItem({ name: '0603 红灯', lcscCode: 'C2286', quantity: 1 });
    await call('DELETE', `/api/items/${item.id}`);
    const archived = await call('POST', '/api/lcsc/quick-in', {
      mode: 'add',
      code: 'C2286',
      itemId: item.id,
      quantity: 1,
    });
    expect(archived.statusCode).toBe(409);
  });

  it('add 模式拒绝实例制物料', async () => {
    const item = await createItem({
      name: '开发板',
      lcscCode: 'C2286',
      trackingMode: 'instance',
    });

    const res = await call('POST', '/api/lcsc/quick-in', {
      mode: 'add',
      code: 'C2286',
      itemId: item.id,
      quantity: 1,
    });
    expect(res.statusCode).toBe(409);
  });

  it('create 模式按预览字段新建物料并记录订单备注', async () => {
    const location = await call('POST', '/api/locations', { name: '元件柜 A' });
    const locationId = location.json().location.id;

    const res = await call('POST', '/api/lcsc/quick-in', {
      mode: 'create',
      code: 'C2286',
      quantity: 10,
      locationId,
      orderNo: 'SO2610270429',
      item: {
        name: '0603 红灯 高亮',
        model: 'KT-0603R',
        manufacturer: 'Hubei KENTO Elec',
        package: '0603',
        unit: '个',
        minQuantity: 5,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.mode).toBe('create');
    expect(body.item).toMatchObject({
      name: '0603 红灯 高亮',
      lcscCode: 'C2286',
      quantity: 10,
      minQuantity: 5,
      locationId,
      trackingMode: 'quantity',
      note: '立创订单 SO2610270429',
    });
    expect(body.item.lcscMatchedAt).toBeTruthy();

    const movements = ctx.app.db
      .prepare('SELECT * FROM movement WHERE item_id = ?')
      .all(body.item.id);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: 'in', quantity: 10, balance_after: 10 });
    expect(movements[0].note).toBe('立创订单 SO2610270429');
  });

  it('普通用户不能预览或提交', async () => {
    const preview = await call(
      'POST',
      '/api/lcsc/quick-in/preview',
      { code: 'C2286' },
      viewer.cookie,
    );
    expect(preview.statusCode).toBe(403);

    const commit = await call(
      'POST',
      '/api/lcsc/quick-in',
      { mode: 'create', code: 'C2286', quantity: 1, item: { name: 'x' } },
      viewer.cookie,
    );
    expect(commit.statusCode).toBe(403);
  });
});
