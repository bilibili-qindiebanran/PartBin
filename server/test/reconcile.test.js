import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdminAccount, createFixture, createUserAccount, destroyFixture } from './helpers.js';

/** 快速对料：扫码 → 找到已有物料 / 手动匹配 / 新增 */
describe('快速对料', () => {
  let ctx;
  let admin;

  beforeEach(async () => {
    ctx = await createFixture({
      // 上游固定返回同一个料，避免测试依赖外网
      lcscFetch: async (_url, init) => {
        const keyword = JSON.parse(init.body).keyword;
        return {
          ok: true,
          json: async () => ({
            code: 200,
            data: {
              componentPageInfo: {
                list: [
                  {
                    componentCode: keyword,
                    erpComponentName: '0603 100nF 50V 陶瓷电容',
                    componentModelEn: 'CL10B104KB8NNNC',
                    componentBrandEn: 'Samsung',
                    componentSpecificationEn: '0603 100nF 50V X7R',
                    stockCount: 12345,
                  },
                ],
              },
            },
          }),
        };
      },
    });
    admin = await createAdminAccount(ctx);
  });

  afterEach(async () => {
    await destroyFixture(ctx);
  });

  function call(method, url, payload) {
    return ctx.app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload }),
      headers: { cookie: admin.cookie },
    });
  }

  async function seedCandidates() {
    const box = await call('POST', '/api/locations', { name: '电容盒', gridRows: 2, gridCols: 3 });
    const locationId = box.json().location.id;

    const loose = await call('POST', '/api/items', {
      name: '0603 100nF 50V',
      unit: '个',
      quantity: 60,
      locationId,
      cellRow: 1,
      cellCol: 2,
    });
    const other = await call('POST', '/api/items', {
      name: '0603 10uF 16V',
      unit: '个',
      quantity: 9,
    });
    return { locationId, loose: loose.json().item, other: other.json().item };
  }

  it('扫码命中已有料号时直接返回该物料', async () => {
    await call('POST', '/api/items', {
      name: '0603 100nF 50V',
      unit: '个',
      quantity: 60,
      lcscCode: 'C14663',
    });

    const res = await call('POST', '/api/lcsc/reconcile/preview', { code: 'c14663' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.code).toBe('C14663');
    expect(body.matched).toMatchObject({ name: '0603 100nF 50V', lcscCode: 'C14663' });
    expect(body.candidates).toEqual([]);
    expect(body.archivedItem).toBe(null);
  });

  it('未命中时给出未绑定料号的候选物料', async () => {
    const { loose } = await seedCandidates();

    const res = await call('POST', '/api/lcsc/reconcile/preview', { code: 'C14663' });
    const body = res.json();

    expect(body.matched).toBe(null);
    expect(body.candidates.length).toBeGreaterThan(0);
    expect(body.candidates[0]).toMatchObject({ itemId: loose.id, name: '0603 100nF 50V' });
    // 已经绑了别的料号的物料不会出现在候选里
    expect(body.candidates.every((row) => row.lcscCode === null)).toBe(true);
  });

  it('手动匹配把料号写到已有物料上', async () => {
    const { loose } = await seedCandidates();

    const res = await call('POST', '/api/lcsc/reconcile/link', {
      code: 'C14663',
      itemId: loose.id,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ linked: true });
    expect(res.json().item).toMatchObject({ id: loose.id, lcscCode: 'C14663' });

    // 再次扫码就能直接命中
    const again = await call('POST', '/api/lcsc/reconcile/preview', { code: 'C14663' });
    expect(again.json().matched).toMatchObject({ id: loose.id });

    // 重复绑定同一料号是幂等的
    const repeat = await call('POST', '/api/lcsc/reconcile/link', {
      code: 'C14663',
      itemId: loose.id,
    });
    expect(repeat.json().linked).toBe(false);
  });

  it('拒绝把料号绑到已绑定其它料号的物料上', async () => {
    const created = await call('POST', '/api/items', {
      name: '已有料号',
      unit: '个',
      quantity: 1,
      lcscCode: 'C10000',
    });

    const res = await call('POST', '/api/lcsc/reconcile/link', {
      code: 'C14663',
      itemId: created.json().item.id,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain('C10000');
  });

  it('归档物料不参与命中，但会提示可以恢复', async () => {
    const created = await call('POST', '/api/items', {
      name: '已归档电容',
      unit: '个',
      quantity: 3,
      lcscCode: 'C14663',
    });
    const itemId = created.json().item.id;
    await call('DELETE', `/api/items/${itemId}`);

    const res = await call('POST', '/api/lcsc/reconcile/preview', { code: 'C14663' });
    const body = res.json();
    expect(body.matched).toBe(null);
    expect(body.archivedItem).toMatchObject({ itemId, name: '已归档电容' });
  });

  it('上游不可用时仍可手动匹配', async () => {
    const broken = await createFixture({
      lcscFetch: async () => {
        throw new Error('offline');
      },
    });
    try {
      const admin2 = await createAdminAccount(broken);
      const item = await broken.app.inject({
        method: 'POST',
        url: '/api/items',
        payload: { name: '离线候补电容', unit: '个', quantity: 5 },
        headers: { cookie: admin2.cookie },
      });

      const res = await broken.app.inject({
        method: 'POST',
        url: '/api/lcsc/reconcile/preview',
        payload: { code: 'C14663' },
        headers: { cookie: admin2.cookie },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.part).toBe(null);
      expect(body.warning).toBeTruthy();

      const linked = await broken.app.inject({
        method: 'POST',
        url: '/api/lcsc/reconcile/link',
        payload: { code: 'C14663', itemId: item.json().item.id },
        headers: { cookie: admin2.cookie },
      });
      expect(linked.statusCode).toBe(200);
      expect(linked.json().item.lcscCode).toBe('C14663');
    } finally {
      await destroyFixture(broken);
    }
  });

  it('料号格式不对报 400，只读账号不能用', async () => {
    const bad = await call('POST', '/api/lcsc/reconcile/preview', { code: 'XYZ' });
    expect(bad.statusCode).toBe(400);

    const reader = await createUserAccount(ctx, 'reader3');
    const denied = await ctx.app.inject({
      method: 'POST',
      url: '/api/lcsc/reconcile/preview',
      payload: { code: 'C14663' },
      headers: { cookie: reader.cookie },
    });
    expect(denied.statusCode).toBe(403);
  });
});
