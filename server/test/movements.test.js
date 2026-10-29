import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFixture,
  destroyFixture,
  registerUser,
  request,
} from './helpers.js';

describe('出入库与流水', () => {
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
      name: '测试物料',
      unit: '个',
      ...payload,
    });
    expect(response.statusCode).toBe(201);
    return response.json().item;
  }

  function move(itemId, payload, cookie = admin.cookie) {
    return call('POST', `/api/items/${itemId}/movements`, payload, cookie);
  }

  it('入库与出库更新数量、余额并记录流水', async () => {
    const item = await createItem();

    const inbound = await move(item.id, { type: 'in', quantity: 5, note: '采购到货' });
    expect(inbound.statusCode).toBe(201);
    expect(inbound.json().movement.balanceAfter).toBe(5);
    expect(inbound.json().item.quantity).toBe(5);

    const outbound = await move(item.id, { type: 'out', quantity: 2, note: '焊到板子上' });
    expect(outbound.statusCode).toBe(201);
    expect(outbound.json().movement.balanceAfter).toBe(3);
    expect(outbound.json().item.quantity).toBe(3);

    const detail = await call('GET', `/api/items/${item.id}`);
    expect(detail.json().item.quantity).toBe(3);
    expect(detail.json().item.lowStock).toBe(false);

    const timeline = await call('GET', `/api/items/${item.id}/movements`);
    expect(timeline.statusCode).toBe(200);
    expect(timeline.json().total).toBe(2);
    expect(timeline.json().data[0].type).toBe('out');
    expect(timeline.json().data[0].balanceAfter).toBe(3);
    expect(timeline.json().data[0].userName).toBe('admin');
  });

  it('出库超过库存返回 409，且不写流水', async () => {
    const item = await createItem({ quantity: 3 });

    const failed = await move(item.id, { type: 'out', quantity: 10 });
    expect(failed.statusCode).toBe(409);
    expect(failed.json().error.code).toBe('INSUFFICIENT_STOCK');

    const detail = await call('GET', `/api/items/${item.id}`);
    expect(detail.json().item.quantity).toBe(3);

    const timeline = await call('GET', `/api/items/${item.id}/movements`);
    expect(timeline.json().total).toBe(1); // 只有初始入库
  });

  it('盘点调整需要方向与原因，且不能调成负数', async () => {
    const item = await createItem({ quantity: 5 });

    const noNote = await move(item.id, { type: 'adjust', quantity: 1, direction: 'down' });
    expect(noNote.statusCode).toBe(400);

    const noDirection = await move(item.id, { type: 'adjust', quantity: 1, note: '盘点' });
    expect(noDirection.statusCode).toBe(400);

    const down = await move(item.id, {
      type: 'adjust',
      quantity: 2,
      direction: 'down',
      note: '盘亏',
    });
    expect(down.statusCode).toBe(201);
    expect(down.json().movement.quantityDelta).toBe(-2);
    expect(down.json().item.quantity).toBe(3);

    const up = await move(item.id, {
      type: 'adjust',
      quantity: 1,
      direction: 'up',
      note: '盘盈',
    });
    expect(up.json().item.quantity).toBe(4);

    const negative = await move(item.id, {
      type: 'adjust',
      quantity: 10,
      direction: 'down',
      note: '盘亏',
    });
    expect(negative.statusCode).toBe(409);
  });

  it('报废与丢失减少拥有量', async () => {
    const item = await createItem({ quantity: 4 });

    const discarded = await move(item.id, { type: 'discard', quantity: 1, note: '烧坏' });
    expect(discarded.json().item.quantity).toBe(3);

    const lost = await move(item.id, { type: 'lost', quantity: 2, note: '遗失' });
    expect(lost.json().item.quantity).toBe(1);

    const zero = await move(item.id, { type: 'lost', quantity: 1, note: '遗失' });
    expect(zero.json().item.quantity).toBe(0);
    expect(zero.json().item.lowStock).toBe(true);
  });

  it('实例制物料拒绝直接出入库', async () => {
    const item = await createItem({ name: '树莓派', trackingMode: 'instance' });
    const response = await move(item.id, { type: 'in', quantity: 1 });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONFLICT');
  });

  it('只读账号不能写入流水，但能查询', async () => {
    const item = await createItem({ quantity: 2 });

    const write = await move(item.id, { type: 'in', quantity: 1 }, viewer.cookie);
    expect(write.statusCode).toBe(403);

    const timeline = await call('GET', `/api/items/${item.id}/movements`, undefined, viewer.cookie);
    expect(timeline.statusCode).toBe(200);

    const ledger = await call('GET', '/api/movements', undefined, viewer.cookie);
    expect(ledger.statusCode).toBe(200);
  });

  it('全局台账支持类型与物料筛选、分页', async () => {
    const first = await createItem({ name: '物料 A' });
    const second = await createItem({ name: '物料 B' });

    await move(first.id, { type: 'in', quantity: 2 });
    await move(first.id, { type: 'out', quantity: 1 });
    await move(second.id, { type: 'in', quantity: 3 });

    const all = await call('GET', '/api/movements');
    expect(all.json().total).toBe(3);
    expect(all.json().data[0].itemName).toBe('物料 B');

    const onlyIn = await call('GET', '/api/movements?type=in');
    expect(onlyIn.json().total).toBe(2);

    const onlyFirst = await call('GET', `/api/movements?itemId=${first.id}`);
    expect(onlyFirst.json().total).toBe(2);

    const paged = await call('GET', '/api/movements?page=1&pageSize=2');
    expect(paged.json().data).toHaveLength(2);
    expect(paged.json().total).toBe(3);
  });

  it('统计接口返回物料、低库存与本月流水', async () => {
    await createItem({ name: 'A', quantity: 0 });
    await createItem({ name: 'B', quantity: 2, minQuantity: 2 });
    await createItem({ name: 'C', quantity: 5 });

    const stats = await call('GET', '/api/stats');
    expect(stats.statusCode).toBe(200);
    const data = stats.json();
    expect(data.items.total).toBe(3);
    expect(data.items.lowStock).toBe(2);
    expect(data.items.outOfStock).toBe(1);
    expect(data.movements.inThisMonth).toBe(7);
    expect(data.loans.open).toBe(0);
  });
});
