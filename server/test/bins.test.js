import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFixture,
  destroyFixture,
  createAdminAccount,
  createUserAccount,
  request,
} from './helpers.js';

describe('元件盒（分类盒 / 大盒）', () => {
  let ctx;
  let admin;

  beforeEach(async () => {
    ctx = await createFixture();
    admin = await createAdminAccount(ctx);
  });

  afterEach(async () => {
    await destroyFixture(ctx);
  });

  function call(method, url, payload) {
    return request(ctx.app, { method, url, cookie: admin.cookie, payload });
  }

  async function makeBox({ rows = 8, cols = 3, name = 'A柜/元件盒1' } = {}) {
    const res = await call('POST', '/api/locations', { name, gridRows: rows, gridCols: cols });
    expect(res.statusCode).toBe(201);
    return res.json().location;
  }

  async function makeItem(payload) {
    const res = await call('POST', '/api/items', {
      unit: '个',
      quantity: 0,
      ...payload,
    });
    return res;
  }

  it('创建分类盒返回网格尺寸，行列必须成对且不超过 52', async () => {
    const box = await makeBox();
    expect(box.isGrid).toBe(true);
    expect(box.gridRows).toBe(8);
    expect(box.gridCols).toBe(3);

    const onlyRows = await call('POST', '/api/locations', { name: '半个盒', gridRows: 3 });
    expect(onlyRows.statusCode).toBe(400);
    expect(onlyRows.json().error.message).toContain('行数与列数');

    const tooBig = await call('POST', '/api/locations', {
      name: '超大盒',
      gridRows: 53,
      gridCols: 3,
    });
    expect(tooBig.statusCode).toBe(400);
  });

  it('物料可放入格位，盒详情按坐标返回', async () => {
    const box = await makeBox();
    const created = await makeItem({
      name: '10k 电阻',
      locationId: box.id,
      cellRow: 2,
      cellCol: 3,
      quantity: 100,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().item.cellRow).toBe(2);
    expect(created.json().item.cellCol).toBe(3);

    const detail = await call('GET', `/api/bins/${box.id}`);
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.box.isGrid).toBe(true);
    expect(body.box.capacity).toBe(24);
    expect(body.cells).toHaveLength(1);
    expect(body.cells[0]).toMatchObject({ row: 2, col: 3, quantity: 100 });
    expect(body.cells[0].item.name).toBe('10k 电阻');
    expect(body.unassigned).toHaveLength(0);
  });

  it('同一格位不能放两种物料，越界与非网格位置会被拒绝', async () => {
    const box = await makeBox();
    const first = await makeItem({ name: '电阻', locationId: box.id, cellRow: 1, cellCol: 1 });
    expect(first.statusCode).toBe(201);

    const second = await makeItem({ name: '电容', locationId: box.id, cellRow: 1, cellCol: 1 });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.message).toContain('格位');

    const outside = await makeItem({ name: '电感', locationId: box.id, cellRow: 9, cellCol: 1 });
    expect(outside.statusCode).toBe(400);
    expect(outside.json().error.message).toContain('8 行 × 3 列');

    const loose = await call('POST', '/api/locations', { name: '大盒' });
    const looseId = loose.json().location.id;
    const inLoose = await makeItem({ name: '袋子', locationId: looseId, cellRow: 1, cellCol: 1 });
    expect(inLoose.statusCode).toBe(400);
    expect(inLoose.json().error.message).toContain('不是分类盒');

    const onlyRow = await makeItem({ name: '缺列', locationId: box.id, cellRow: 2 });
    expect(onlyRow.statusCode).toBe(400);
  });

  it('大盒可混装多种物料，各自独立数量', async () => {
    const bag = await call('POST', '/api/locations', { name: '元件袋盒' });
    const bagId = bag.json().location.id;

    await makeItem({ name: '0603 电阻', locationId: bagId, quantity: 200 });
    await makeItem({ name: '0603 电容', locationId: bagId, quantity: 50 });

    const detail = await call('GET', `/api/bins/${bagId}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().box.isGrid).toBe(false);
    expect(detail.json().items).toHaveLength(2);
    expect(detail.json().items.map((item) => item.quantity).sort((a, b) => a - b)).toEqual([
      50, 200,
    ]);
  });

  it('缩小网格或改成大盒前会阻止丢格位', async () => {
    const box = await makeBox();
    await makeItem({ name: '电阻', locationId: box.id, cellRow: 8, cellCol: 3 });

    const shrink = await call('PATCH', `/api/locations/${box.id}`, { gridRows: 4, gridCols: 3 });
    expect(shrink.statusCode).toBe(409);
    expect(shrink.json().error.message).toContain('容纳不下');

    const toLoose = await call('PATCH', `/api/locations/${box.id}`, {
      gridRows: null,
      gridCols: null,
    });
    expect(toLoose.statusCode).toBe(409);
    expect(toLoose.json().error.message).toContain('先清空格位');

    const grow = await call('PATCH', `/api/locations/${box.id}`, { gridRows: 10, gridCols: 4 });
    expect(grow.statusCode).toBe(200);
    expect(grow.json().location.gridRows).toBe(10);
  });

  it('移动物料到其他位置会清空旧格位', async () => {
    const box = await makeBox();
    const other = await makeBox({ name: '元件盒2' });
    const created = await makeItem({
      name: '电阻',
      locationId: box.id,
      cellRow: 1,
      cellCol: 2,
    });
    const itemId = created.json().item.id;

    const moved = await call('PATCH', `/api/items/${itemId}`, { locationId: other.id });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().item.cellRow).toBe(null);
    expect(moved.json().item.cellCol).toBe(null);

    const again = await call('PATCH', `/api/items/${itemId}`, { cellRow: 2, cellCol: 1 });
    expect(again.statusCode).toBe(200);
    expect(again.json().item.cellRow).toBe(2);
  });

  it('元件盒列表只包含分类盒与装料位置，并带占用统计', async () => {
    const box = await makeBox();
    await makeItem({ name: '电阻', locationId: box.id, cellRow: 1, cellCol: 1, quantity: 10 });
    await call('POST', '/api/locations', { name: '空柜子' });

    const list = await call('GET', '/api/bins');
    expect(list.statusCode).toBe(200);
    const boxes = list.json().data;
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({
      id: box.id,
      isGrid: true,
      gridRows: 8,
      gridCols: 3,
      itemCount: 1,
      cellCount: 1,
      unassignedCount: 0,
    });
  });

  it('交换行列会把网格与格位一起转置', async () => {
    const box = await makeBox({ rows: 3, cols: 8 });
    await makeItem({ name: '电阻', locationId: box.id, cellRow: 2, cellCol: 5, quantity: 10 });
    await makeItem({ name: '电容', locationId: box.id, cellRow: 1, cellCol: 8, quantity: 5 });

    const swapped = await call('POST', `/api/locations/${box.id}/swap-grid`);
    expect(swapped.statusCode).toBe(200);
    expect(swapped.json().location).toMatchObject({ gridRows: 8, gridCols: 3 });

    const detail = await call('GET', `/api/bins/${box.id}`);
    const cells = detail.json().cells.map((cell) => `${cell.row}-${cell.col}:${cell.item.name}`);
    expect(cells.sort()).toEqual(['5-2:电阻', '8-1:电容'].sort());

    const loose = await call('POST', '/api/locations', { name: '大盒' });
    const noGrid = await call('POST', `/api/locations/${loose.json().location.id}/swap-grid`);
    expect(noGrid.statusCode).toBe(400);
  });

  it('盒视图总览包含格位明细、大盒清单与排序', async () => {
    const grid = await makeBox({ rows: 3, cols: 8, name: '网格盒' });
    const bag = await call('POST', '/api/locations', { name: '大盒' });
    const bagId = bag.json().location.id;
    await makeItem({ name: '电阻', locationId: grid.id, cellRow: 1, cellCol: 2, quantity: 10 });
    await makeItem({ name: '电容', locationId: bagId, quantity: 7 });
    await makeItem({ name: '电感', locationId: bagId, quantity: 3 });

    const overview = await call('GET', '/api/bins/overview');
    expect(overview.statusCode).toBe(200);
    const boxes = overview.json().data;
    expect(boxes).toHaveLength(2);

    const gridBox = boxes.find((box) => box.id === grid.id);
    expect(gridBox).toMatchObject({ isGrid: true, gridRows: 3, gridCols: 8, itemCount: 1 });
    expect(gridBox.cells[0]).toMatchObject({ row: 1, col: 2 });
    expect(gridBox.cells[0].item.name).toBe('电阻');

    const bagBox = boxes.find((box) => box.id === bagId);
    expect(bagBox).toMatchObject({ isGrid: false, itemCount: 2, kindCount: 2 });
    expect(bagBox.items.map((item) => item.name).sort()).toEqual(['电容', '电感']);

    const reorder = await call('POST', '/api/bins/reorder', { ids: [bagId, grid.id] });
    expect(reorder.statusCode).toBe(200);
    expect(reorder.json().updated).toBe(2);

    const again = await call('GET', '/api/bins/overview');
    expect(again.json().data.map((box) => box.id)).toEqual([bagId, grid.id]);

    const bad = await call('POST', '/api/bins/reorder', { ids: [bagId, 9999] });
    expect(bad.statusCode).toBe(404);
  });

  it('只读账号可以看总览但不能排序', async () => {
    const box = await makeBox();
    const viewerUser = await createUserAccount(ctx, 'viewer');
    const viewerCall = (method, url, payload) =>
      request(ctx.app, { method, url, cookie: viewerUser.cookie, payload });

    const overview = await viewerCall('GET', '/api/bins/overview');
    expect(overview.statusCode).toBe(200);

    const reorder = await viewerCall('POST', '/api/bins/reorder', { ids: [box.id] });
    expect(reorder.statusCode).toBe(403);
  });
});
