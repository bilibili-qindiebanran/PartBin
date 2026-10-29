import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFixture,
  destroyFixture,
  registerUser,
  request,
} from './helpers.js';

describe('物料主数据', () => {
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

  async function createItem(payload) {
    const response = await call('POST', '/api/items', payload);
    expect(response.statusCode).toBe(201);
    return response.json().item;
  }

  it('新建物料时写入初始入库流水', async () => {
    const item = await createItem({
      name: 'STM32F103C8T6 最小系统板',
      code: 'U-STM32F103',
      model: 'STM32F103C8T6',
      spec: '72MHz / 64KB Flash',
      unit: '块',
      quantity: 5,
      minQuantity: 2,
    });

    expect(item.quantity).toBe(5);
    expect(item.available).toBe(5);
    expect(item.lowStock).toBe(false);
    expect(item.categoryPath).toBeNull();

    const movements = ctx.app.db
      .prepare('SELECT * FROM movement WHERE item_id = ?')
      .all(item.id);
    expect(movements).toHaveLength(1);
    expect(movements[0].type).toBe('in');
    expect(movements[0].quantity_delta).toBe(5);
    expect(movements[0].balance_after).toBe(5);
    expect(movements[0].user_id).toBe(admin.body.user.id);

    const detail = await call('GET', `/api/items/${item.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().item.name).toContain('STM32');
    expect(detail.json().item.photos).toEqual([]);
  });

  it('搜索、分类子孙过滤与位置过滤', async () => {
    const root = await call('POST', '/api/categories', { name: '开发板' });
    const child = await call('POST', '/api/categories', {
      name: '单片机',
      parentId: root.json().category.id,
    });
    const cabinet = await call('POST', '/api/locations', { name: 'A柜' });
    const drawer = await call('POST', '/api/locations', {
      name: '抽屉3',
      parentId: cabinet.json().location.id,
    });

    await createItem({
      name: 'STM32F103 最小系统板',
      model: 'STM32F103C8T6',
      spec: '72MHz',
      quantity: 2,
      categoryId: child.json().category.id,
      locationId: drawer.json().location.id,
    });
    await createItem({ name: 'ESP32 开发板', model: 'ESP32-S3', quantity: 1 });

    const byName = await call('GET', '/api/items?q=STM32');
    expect(byName.json().total).toBe(1);

    const bySpec = await call('GET', '/api/items?q=72MHz');
    expect(bySpec.json().total).toBe(1);

    const multi = await call('GET', '/api/items?q=STM32%2072MHz');
    expect(multi.json().total).toBe(1);

    const noMatch = await call('GET', '/api/items?q=STM32%20NOPE');
    expect(noMatch.json().total).toBe(0);

    const byRootCategory = await call(
      'GET',
      `/api/items?categoryId=${root.json().category.id}`,
    );
    expect(byRootCategory.json().total).toBe(1);

    const byLocation = await call(
      'GET',
      `/api/items?locationId=${cabinet.json().location.id}`,
    );
    expect(byLocation.json().total).toBe(1);
    expect(byLocation.json().data[0].locationPath).toBe('A柜/抽屉3');
  });

  it('低库存筛选与分页排序', async () => {
    await createItem({ name: 'A 元件', quantity: 0 });
    await createItem({ name: 'B 元件', quantity: 2, minQuantity: 2 });
    await createItem({ name: 'C 元件', quantity: 5, minQuantity: 2 });

    const low = await call('GET', '/api/items?lowStock=1');
    const names = low.json().data.map((item) => item.name).sort();
    expect(names).toEqual(['A 元件', 'B 元件']);

    const page1 = await call('GET', '/api/items?page=1&pageSize=2&sort=name');
    expect(page1.json().total).toBe(3);
    expect(page1.json().data).toHaveLength(2);
    expect(page1.json().data[0].name).toBe('A 元件');

    const page2 = await call('GET', '/api/items?page=2&pageSize=2&sort=name');
    expect(page2.json().data).toHaveLength(1);
    expect(page2.json().data[0].name).toBe('C 元件');
  });

  it('归档与恢复影响默认列表', async () => {
    const item = await createItem({ name: '归档测试', quantity: 1 });

    const archived = await call('DELETE', `/api/items/${item.id}`);
    expect(archived.statusCode).toBe(200);
    expect(archived.json().item.isArchived).toBe(true);

    const defaultList = await call('GET', '/api/items');
    expect(defaultList.json().total).toBe(0);

    const withArchived = await call('GET', '/api/items?archived=1');
    expect(withArchived.json().total).toBe(1);

    const restored = await call('POST', `/api/items/${item.id}/restore`);
    expect(restored.json().item.isArchived).toBe(false);

    const afterRestore = await call('GET', '/api/items');
    expect(afterRestore.json().total).toBe(1);
  });

  it('修改物料；数量必须走流水，编号不能重复', async () => {
    const item = await createItem({ name: '旧名称', code: 'CODE-1', quantity: 3 });

    const updated = await call('PATCH', `/api/items/${item.id}`, {
      name: '新名称',
      minQuantity: 4,
      note: '备注',
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().item.name).toBe('新名称');
    expect(updated.json().item.minQuantity).toBe(4);
    expect(updated.json().item.quantity).toBe(3);

    const quantityPatch = await call('PATCH', `/api/items/${item.id}`, { quantity: 10 });
    expect(quantityPatch.statusCode).toBe(400);

    const duplicate = await call('POST', '/api/items', { name: '另一个', code: 'CODE-1' });
    expect(duplicate.statusCode).toBe(409);
  });

  it('实例制物料数量为 0，已有库存时不能切换追踪模式', async () => {
    const instanceItem = await createItem({
      name: '树莓派 4B',
      trackingMode: 'instance',
    });
    expect(instanceItem.quantity).toBe(0);
    expect(instanceItem.trackingMode).toBe('instance');

    const withQuantity = await call('POST', '/api/items', {
      name: '非法实例物料',
      trackingMode: 'instance',
      quantity: 3,
    });
    expect(withQuantity.statusCode).toBe(400);

    const quantityItem = await createItem({ name: '电阻包', quantity: 10 });
    const switchMode = await call('PATCH', `/api/items/${quantityItem.id}`, {
      trackingMode: 'instance',
    });
    expect(switchMode.statusCode).toBe(409);
  });

  it('只读账号可查询但不能写入', async () => {
    const item = await createItem({ name: '只读测试', quantity: 1 });

    const list = await call('GET', '/api/items', undefined, viewer.cookie);
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(1);

    const detail = await call('GET', `/api/items/${item.id}`, undefined, viewer.cookie);
    expect(detail.statusCode).toBe(200);

    const create = await call('POST', '/api/items', { name: '不允许' }, viewer.cookie);
    expect(create.statusCode).toBe(403);

    const update = await call('PATCH', `/api/items/${item.id}`, { name: '不允许' }, viewer.cookie);
    expect(update.statusCode).toBe(403);

    const archive = await call('DELETE', `/api/items/${item.id}`, undefined, viewer.cookie);
    expect(archive.statusCode).toBe(403);
  });

  it('拒绝不存在的分类与不存在的物料', async () => {
    const badCategory = await call('POST', '/api/items', {
      name: '坏分类',
      categoryId: 999,
    });
    expect(badCategory.statusCode).toBe(400);

    const missing = await call('GET', '/api/items/999');
    expect(missing.statusCode).toBe(404);
  });

  it('价格、购买日期与空值字段正确保存', async () => {
    const item = await createItem({
      name: '万用表',
      quantity: 1,
      price: 129.9,
      purchaseDate: '2026-09-01',
      manufacturer: 'UNI-T',
      note: '放在工具抽屉',
    });

    const detail = await call('GET', `/api/items/${item.id}`);
    expect(detail.json().item.price).toBe(129.9);
    expect(detail.json().item.purchaseDate).toBe('2026-09-01');
    expect(detail.json().item.manufacturer).toBe('UNI-T');
    expect(detail.json().item.note).toBe('放在工具抽屉');
    expect(detail.json().item.code).toBeNull();
  });
});
