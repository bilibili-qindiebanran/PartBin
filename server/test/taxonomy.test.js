import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFixture,
  destroyFixture,
  createAdminAccount,
  createUserAccount,
  request,
} from './helpers.js';

describe('分类与位置树', () => {
  let ctx;
  let admin;

  beforeEach(async () => {
    ctx = await createFixture();
    admin = await createAdminAccount(ctx);
  });

  afterEach(async () => {
    await destroyFixture(ctx);
  });

  function post(url, payload) {
    return request(ctx.app, {
      method: 'POST',
      url,
      cookie: admin.cookie,
      payload,
    });
  }

  it('支持三级分类与位置，并返回完整路径', async () => {
    const root = await post('/api/categories', { name: '开发板' });
    expect(root.statusCode).toBe(201);
    const child = await post('/api/categories', {
      name: '单片机',
      parentId: root.json().category.id,
    });
    const leaf = await post('/api/categories', {
      name: 'STM32',
      parentId: child.json().category.id,
    });

    const tree = await request(ctx.app, { url: '/api/categories', cookie: admin.cookie });
    expect(tree.statusCode).toBe(200);
    const rootNode = tree.json().data.find((node) => node.name === '开发板');
    expect(rootNode.children[0].children[0].path).toBe('开发板/单片机/STM32');
    expect(leaf.json().category.path).toBe('开发板/单片机/STM32');

    const cabinet = await post('/api/locations', { name: 'A柜', code: 'A' });
    const drawer = await post('/api/locations', {
      name: '抽屉3',
      parentId: cabinet.json().location.id,
    });
    const box = await post('/api/locations', {
      name: '盒12',
      parentId: drawer.json().location.id,
      code: 'A-3-12',
    });
    expect(box.json().location.path).toBe('A柜/抽屉3/盒12');

    const locations = await request(ctx.app, { url: '/api/locations', cookie: admin.cookie });
    expect(locations.json().data[0].children[0].children[0].path).toBe('A柜/抽屉3/盒12');
  });

  it('同级重名返回 409，大小写不敏感', async () => {
    await post('/api/categories', { name: 'Sensor' });
    const duplicate = await post('/api/categories', { name: 'sensor' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('DUPLICATE');
  });

  it('拒绝把节点挂到自己的子孙下', async () => {
    const root = await post('/api/categories', { name: '根' });
    const child = await post('/api/categories', {
      name: '子',
      parentId: root.json().category.id,
    });

    const cycle = await request(ctx.app, {
      method: 'PATCH',
      url: `/api/categories/${root.json().category.id}`,
      cookie: admin.cookie,
      payload: { parentId: child.json().category.id },
    });
    expect(cycle.statusCode).toBe(409);
    expect(cycle.json().error.code).toBe('TREE_CYCLE');
  });

  it('删除分类会解除物料与子分类的引用', async () => {
    const root = await post('/api/categories', { name: '根' });
    const child = await post('/api/categories', {
      name: '子',
      parentId: root.json().category.id,
    });
    const item = await post('/api/items', {
      name: '测试板',
      categoryId: child.json().category.id,
    });
    expect(item.statusCode).toBe(201);

    const removed = await request(ctx.app, {
      method: 'DELETE',
      url: `/api/categories/${root.json().category.id}`,
      cookie: admin.cookie,
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().detachedItems).toBe(0);
    expect(removed.json().orphanedChildren).toBe(1);

    // 删除根后子分类成为根，物料仍引用子分类
    const afterRootRemoval = await request(ctx.app, {
      url: `/api/items/${item.json().item.id}`,
      cookie: admin.cookie,
    });
    expect(afterRootRemoval.json().item.categoryId).toBe(child.json().category.id);

    const tree = await request(ctx.app, { url: '/api/categories', cookie: admin.cookie });
    const orphan = tree.json().data.find((node) => node.name === '子');
    expect(orphan).toBeTruthy();
    expect(orphan.parentId).toBeNull();

    // 删除子分类后，物料引用被置空
    const removedChild = await request(ctx.app, {
      method: 'DELETE',
      url: `/api/categories/${child.json().category.id}`,
      cookie: admin.cookie,
    });
    expect(removedChild.json().detachedItems).toBe(1);

    const detail = await request(ctx.app, {
      url: `/api/items/${item.json().item.id}`,
      cookie: admin.cookie,
    });
    expect(detail.json().item.categoryId).toBeNull();
  });

  it('只读账号不能修改分类或位置', async () => {
    const viewer = await createUserAccount(ctx, 'viewer');

    const category = await request(ctx.app, {
      method: 'POST',
      url: '/api/categories',
      cookie: viewer.cookie,
      payload: { name: '不允许' },
    });
    expect(category.statusCode).toBe(403);

    const location = await request(ctx.app, {
      method: 'POST',
      url: '/api/locations',
      cookie: viewer.cookie,
      payload: { name: '不允许' },
    });
    expect(location.statusCode).toBe(403);
  });
});
