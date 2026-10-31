import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFixture,
  destroyFixture,
  createAdminAccount,
  createUserAccount,
  request,
} from './helpers.js';
import { normalizeLcscCode } from '../src/services/lcsc.js';

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

function jlcpcbPayload(list = [C2286]) {
  return { code: 200, data: { componentPageInfo: { total: list.length, list } } };
}

function mockFetch(payload, { fail = null } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (fail) throw fail;
    return { ok: true, status: 200, json: async () => payload };
  };
  impl.calls = calls;
  return impl;
}

describe('立创料号匹配', () => {
  let ctx;
  let admin;
  let viewer;
  let fetchImpl;

  beforeEach(async () => {
    fetchImpl = mockFetch(jlcpcbPayload());
    ctx = await createFixture({ lcscFetch: fetchImpl });
    admin = await createAdminAccount(ctx);
    viewer = await createUserAccount(ctx, 'viewer');
  });

  afterEach(async () => {
    await destroyFixture(ctx);
  });

  function call(method, url, payload, cookie = admin.cookie) {
    return request(ctx.app, { method, url, cookie, payload });
  }

  it('料号归一化支持小写、空格与商品链接', () => {
    expect(normalizeLcscCode('c2286')).toBe('C2286');
    expect(normalizeLcscCode('  C2286 ')).toBe('C2286');
    expect(
      normalizeLcscCode('https://www.lcsc.com/product-detail/led_C2286.html'),
    ).toBe('C2286');
    expect(() => normalizeLcscCode('2286')).toThrow(/C 加数字/);
    expect(() => normalizeLcscCode('')).toThrow(/请输入/);
  });

  it('查询命中后写缓存，第二次不再请求上游', async () => {
    const first = await call('POST', '/api/lcsc/lookup', { code: 'c2286' });
    expect(first.statusCode).toBe(200);
    expect(first.json().cached).toBe(false);
    expect(first.json().part).toMatchObject({
      code: 'C2286',
      name: '0603 红灯 高亮',
      model: 'KT-0603R',
      manufacturer: 'Hubei KENTO Elec',
      package: '0603',
      stock: 1000,
    });
    expect(fetchImpl.calls).toHaveLength(1);

    const second = await call('POST', '/api/lcsc/lookup', { code: 'C2286' });
    expect(second.statusCode).toBe(200);
    expect(second.json().cached).toBe(true);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('refresh=true 会绕过缓存重新请求', async () => {
    await call('POST', '/api/lcsc/lookup', { code: 'C2286' });
    const refreshed = await call('POST', '/api/lcsc/lookup', { code: 'C2286', refresh: true });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().cached).toBe(false);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('上游没有该料号时返回 404，网络失败返回 502', async () => {
    const empty = await createFixture({
      lcscFetch: mockFetch(jlcpcbPayload([])),
    });
    try {
      const admin2 = await createAdminAccount(empty, 'admin2');
      const res = await request(empty.app, {
        method: 'POST',
        url: '/api/lcsc/lookup',
        cookie: admin2.cookie,
        payload: { code: 'C999999' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.message).toContain('没有找到');
    } finally {
      await destroyFixture(empty);
    }

    const broken = await createFixture({
      lcscFetch: mockFetch(null, { fail: new TypeError('fetch failed') }),
    });
    try {
      const admin3 = await createAdminAccount(broken, 'admin3');
      const res = await request(broken.app, {
        method: 'POST',
        url: '/api/lcsc/lookup',
        cookie: admin3.cookie,
        payload: { code: 'C2286' },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().error.code).toBe('UPSTREAM_UNAVAILABLE');
    } finally {
      await destroyFixture(broken);
    }
  });

  it('只读账号不能查询或匹配', async () => {
    const res = await call('POST', '/api/lcsc/lookup', { code: 'C2286' }, viewer.cookie);
    expect(res.statusCode).toBe(403);
  });

  it('物料保存料号时归一化，并记录匹配时间', async () => {
    const plain = await call('POST', '/api/items', {
      name: '红色 LED',
      unit: '个',
      quantity: 0,
      lcscCode: 'c2286',
    });
    expect(plain.statusCode).toBe(201);
    expect(plain.json().item.lcscCode).toBe('C2286');
    expect(plain.json().item.lcscMatchedAt).toBe(null);

    const matched = await call('POST', '/api/items', {
      name: '红色 LED 2',
      unit: '个',
      quantity: 0,
      lcscCode: 'C2286',
      lcscMatched: true,
    });
    expect(matched.statusCode).toBe(201);
    expect(matched.json().item.lcscMatchedAt).toBeTruthy();

    const cleared = await call('PATCH', `/api/items/${plain.json().item.id}`, {
      lcscCode: '',
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().item.lcscCode).toBe(null);
  });

  it('按料号补全已有物料的型号、厂商与规格', async () => {
    const created = await call('POST', '/api/items', {
      name: '红色 LED',
      unit: '个',
      quantity: 0,
      lcscCode: 'C2286',
    });
    const id = created.json().item.id;

    const res = await call('POST', `/api/items/${id}/lcsc`);
    expect(res.statusCode).toBe(200);
    const item = res.json().item;
    expect(item.model).toBe('KT-0603R');
    expect(item.manufacturer).toBe('Hubei KENTO Elec');
    expect(item.spec).toContain('0603');
    expect(item.lcscCode).toBe('C2286');
    expect(item.lcscMatchedAt).toBeTruthy();
    expect(res.json().part.name).toBe('0603 红灯 高亮');
  });
});
