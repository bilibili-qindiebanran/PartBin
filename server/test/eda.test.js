import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAdminAccount,
  createFixture,
  destroyFixture,
  request,
} from './helpers.js';

const API_KEY = 'eda-test-key-0123456789';

function lookup(ctx, payload, extraHeaders = {}) {
  return request(ctx.app, {
    method: 'POST',
    url: '/api/eda/lookup',
    payload,
    headers: { 'x-api-key': API_KEY, 'content-type': 'application/json', ...extraHeaders },
  });
}

async function seedItems(ctx, admin) {
  await request(ctx.app, {
    method: 'POST',
    url: '/api/locations',
    cookie: admin.cookie,
    payload: { name: '元件柜', gridRows: 8, gridCols: 4 },
  });
  const locations = await request(ctx.app, {
    method: 'GET',
    url: '/api/locations',
    cookie: admin.cookie,
  });
  const locationId = locations.json().data[0].id;

  const create = (payload) =>
    request(ctx.app, { method: 'POST', url: '/api/items', cookie: admin.cookie, payload });

  await create({
    name: '10k 电阻',
    unit: '个',
    quantity: 100,
    package: '0603',
    lcscCode: 'C25804',
    model: '0603WAF1002T5E',
    locationId,
    cellRow: 2,
    cellCol: 3,
  });
  await create({ name: '0603 40K', unit: '个', quantity: 50, package: '0603' });
  await create({ name: '100nF 50V X7R', unit: '个', quantity: 120, package: '0603' });
  await create({ name: '100nF 50V X5R', unit: '个', quantity: 10, package: '0603' });
  await create({ name: 'CH340C', unit: '个', quantity: 7, package: 'SOP-16' });
  await create({
    name: 'W25Q128JVSIQ 闪存',
    unit: '个',
    quantity: 30,
    model: 'W25Q128JVSIQ',
    package: 'SOP-8',
  });
}

describe('EDA 查料接口', () => {
  describe('未配置密钥', () => {
    let ctx;
    beforeEach(async () => {
      ctx = await createFixture();
    });
    afterEach(async () => {
      await destroyFixture(ctx);
    });

    it('返回 503，避免空密钥被当成有效密钥', async () => {
      const res = await request(ctx.app, {
        method: 'POST',
        url: '/api/eda/lookup',
        payload: { items: [] },
        headers: { 'x-api-key': '' },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('EDA_DISABLED');
    });
  });

  describe('已配置密钥', () => {
    let ctx;
    let admin;

    beforeEach(async () => {
      ctx = await createFixture({ edaApiKey: API_KEY });
      admin = await createAdminAccount(ctx);
      await seedItems(ctx, admin);
    });

    afterEach(async () => {
      await destroyFixture(ctx);
    });

    it('密钥错误返回 401 + 统一错误结构', async () => {
      const res = await request(ctx.app, {
        method: 'POST',
        url: '/api/eda/lookup',
        payload: { items: [] },
        headers: { 'x-api-key': 'wrong' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('缺少密钥同样返回 401', async () => {
      const res = await request(ctx.app, {
        method: 'POST',
        url: '/api/eda/lookup',
        payload: { items: [] },
      });
      expect(res.statusCode).toBe(401);
    });

    it('按立创料号命中，ref 原样回传并带位置与格位', async () => {
      const res = await lookup(ctx, {
        items: [{ ref: 'R1,R2,R3', lcsc: 'c25804', value: '10k', package: 'C0603' }],
      });
      expect(res.statusCode).toBe(200);

      const [row] = res.json().items;
      expect(row.ref).toBe('R1,R2,R3');
      expect(row.hits).toHaveLength(1);
      expect(row.hits[0]).toMatchObject({
        name: '10k 电阻',
        lcscCode: 'C25804',
        model: '0603WAF1002T5E',
        package: '0603',
        quantity: 100,
        available: 100,
        locationPath: '元件柜',
        cellRow: 2,
        cellCol: 3,
        match: 'lcsc',
        score: 1,
      });
    });

    it('按型号命中', async () => {
      const res = await lookup(ctx, {
        items: [{ ref: 'R9', mpn: '0603WAF1002T5E' }],
      });
      const [row] = res.json().items;
      expect(row.hits).toHaveLength(1);
      expect(row.hits[0].match).toBe('model');
    });

    it('型号宽松匹配：mpn 写短型号也能命中完整型号', async () => {
      const res = await lookup(ctx, {
        items: [{ ref: 'U1', mpn: 'W25Q128JV' }],
      });
      const [row] = res.json().items;
      expect(row.hits).toHaveLength(1);
      expect(row.hits[0]).toMatchObject({
        name: 'W25Q128JVSIQ 闪存',
        model: 'W25Q128JVSIQ',
        match: 'model',
      });
    });

    it('mpn 缺失时用 value 当作料号做宽松匹配', async () => {
      const res = await lookup(ctx, {
        items: [{ ref: 'U2', value: 'W25Q128JV-SIQ' }],
      });
      const [row] = res.json().items;
      expect(row.hits).toHaveLength(1);
      expect(row.hits[0].model).toBe('W25Q128JVSIQ');
    });

    it('值 + 封装族归一后命中（40kΩ ↔ 40K / C0603 ↔ 0603）', async () => {
      const res = await lookup(ctx, {
        items: [{ ref: 'R3', value: '40kΩ', package: 'C0603' }],
      });
      const [row] = res.json().items;
      expect(row.hits).toHaveLength(1);
      expect(row.hits[0]).toMatchObject({ name: '0603 40K', match: 'value+package' });
    });

    it('多结果时返回多个候选，并按可用数量降序', async () => {
      const res = await lookup(ctx, {
        items: [{ ref: 'C1,C2', value: '100nF', package: '0603' }],
      });
      const [row] = res.json().items;
      expect(row.hits).toHaveLength(2);
      expect(row.hits.map((hit) => hit.name)).toEqual(['100nF 50V X7R', '100nF 50V X5R']);
      expect(row.hits.every((hit) => hit.match === 'value+package')).toBe(true);
    });

    it('名称精确匹配归为 value 通道', async () => {
      const res = await lookup(ctx, {
        items: [{ ref: 'U1', value: 'CH340C', package: 'SOP-16' }],
      });
      const [row] = res.json().items;
      expect(row.hits).toHaveLength(1);
      expect(row.hits[0]).toMatchObject({ name: 'CH340C', match: 'value' });
    });

    it('未命中返回空 hits，且保持 ref', async () => {
      const res = await lookup(ctx, {
        items: [{ ref: 'U2', value: '不存在的芯片', package: 'QFN-48' }],
      });
      const [row] = res.json().items;
      expect(row).toEqual({ ref: 'U2', hits: [] });
    });

    it('批量请求按顺序返回，每条都带 ref', async () => {
      const res = await lookup(ctx, {
        items: [
          { ref: 'R1', lcsc: 'C25804' },
          { ref: 'X1' },
          { ref: 'U1', value: 'CH340C' },
        ],
      });
      const items = res.json().items;
      expect(items.map((row) => row.ref)).toEqual(['R1', 'X1', 'U1']);
      expect(items.map((row) => row.hits.length)).toEqual([1, 0, 1]);
    });

    it('允许跨域：带外部 Origin 与 sec-fetch-site 不被同源校验拦截', async () => {
      const res = await lookup(
        ctx,
        { items: [{ ref: 'R1', lcsc: 'C25804' }] },
        { origin: 'https://pro.lceda.cn', 'sec-fetch-site': 'cross-site' },
      );
      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('OPTIONS 预检返回 204 与 CORS 头', async () => {
      const res = await request(ctx.app, {
        method: 'OPTIONS',
        url: '/api/eda/lookup',
        headers: { origin: 'https://pro.lceda.cn' },
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-methods']).toBe('POST, OPTIONS');
      expect(res.headers['access-control-allow-headers']).toBe('Content-Type, X-Api-Key');
      expect(res.headers['access-control-max-age']).toBe('600');
    });

    it('超过 500 条返回 413', async () => {
      const items = Array.from({ length: 501 }, (_, i) => ({ ref: `R${i}`, value: '10k' }));
      const res = await lookup(ctx, { items });
      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('items 不是数组返回 400', async () => {
      const res = await lookup(ctx, { items: 'oops' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION');
    });

    it('默认排除归档物料', async () => {
      const created = await request(ctx.app, {
        method: 'POST',
        url: '/api/items',
        cookie: admin.cookie,
        payload: { name: 'BTN', unit: '个', quantity: 3, lcscCode: 'C99999' },
      });
      const itemId = created.json().item.id;
      await request(ctx.app, {
        method: 'DELETE',
        url: `/api/items/${itemId}`,
        cookie: admin.cookie,
      });

      const res = await lookup(ctx, { items: [{ ref: 'SW1', lcsc: 'C99999' }] });
      expect(res.json().items[0].hits).toHaveLength(0);
    });
  });
});
