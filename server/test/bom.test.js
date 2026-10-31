import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crc32, readXlsxRows } from '../src/lib/xlsx.js';
import {
  createFixture,
  destroyFixture,
  createAdminAccount,
  request,
} from './helpers.js';

/** 构造一个最小 zip（stored 或 deflate），用于生成测试用 xlsx */
function buildZip(files, { compress = true } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const body = compress ? deflateRawSync(data) : data;
    const method = compress ? 8 : 0;
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);

    const entry = Buffer.alloc(46 + nameBuf.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    nameBuf.copy(entry, 46);

    locals.push(local, body);
    central.push(entry);
    offset += local.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

function sheetXml(rowsXml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowsXml}</sheetData>
</worksheet>`;
}

function makeXlsx(rowsXml, sharedStrings = []) {
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'xl/workbook.xml':
      '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="BOM" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheetXml(rowsXml),
  };
  if (sharedStrings.length > 0) {
    files['xl/sharedStrings.xml'] = `<?xml version="1.0"?><sst>${sharedStrings
      .map((text) => `<si><t>${text}</t></si>`)
      .join('')}</sst>`;
  }
  return buildZip(files);
}

describe('xlsx 读取', () => {
  it('读取共享字符串、稀疏列与内联字符串', () => {
    const rowsXml = `
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>R1,R2</t></is></c><c r="B2"><v>10</v></c></row>`;
    const buffer = makeXlsx(rowsXml, ['位号', '数量', '备注']);

    const rows = readXlsxRows(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(['位号', '数量', '', '备注']);
    expect(rows[1][0]).toBe('R1,R2');
    expect(rows[1][1]).toBe('10');
  });

  it('支持不压缩（stored）的 zip 与实体转义', () => {
    const rowsXml = `<row r="1"><c r="A1" t="inlineStr"><is><t>R&amp;D</t></is></c></row>`;
    const buffer = buildZip(
      {
        'xl/worksheets/sheet1.xml': sheetXml(rowsXml),
      },
      { compress: false },
    );
    expect(readXlsxRows(buffer)[0][0]).toBe('R&D');
  });

  it('非 zip 内容报错', () => {
    expect(() => readXlsxRows(Buffer.from('hello'))).toThrow(/xlsx/);
  });
});

describe('BOM 匹配', () => {
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

  async function seed() {
    const box = await call('POST', '/api/locations', {
      name: '电阻盒',
      gridRows: 8,
      gridCols: 3,
    });
    const boxId = box.json().location.id;
    const resistor = await call('POST', '/api/items', {
      name: '10k 电阻',
      unit: '个',
      quantity: 100,
      locationId: boxId,
      cellRow: 1,
      cellCol: 1,
      model: '0603WAF1002T5E',
      lcscCode: 'C25804',
    });
    const capacitor = await call('POST', '/api/items', {
      name: '100nF 电容',
      unit: '个',
      quantity: 5,
      locationId: boxId,
      cellRow: 1,
      cellCol: 2,
    });
    return { resistor: resistor.json().item, capacitor: capacitor.json().item };
  }

  const CSV = [
    '位号,名称,立创料号,数量,封装',
    '"R1,R2,R3",10k 电阻,C25804,3,0603',
    'C1,100nF 电容,,2,0603',
    'U1,不存在的芯片,,1,SOP-8',
  ].join('\n');

  it('按料号与名称匹配，并算出需求、缺口与可支持套数', async () => {
    await seed();
    const res = await call('POST', '/api/bom/preview', { csvText: CSV, sets: 2 });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.summary).toMatchObject({
      groups: 3,
      matched: 2,
      missing: 1,
      sets: 2,
      maxSets: 2,
    });

    const resistor = body.groups.find((row) => row.lcscCode === 'C25804');
    expect(resistor).toMatchObject({
      perSet: 3,
      demand: 6,
      stock: 100,
      shortage: 0,
      setsPossible: 33,
      status: 'matched',
      matchedBy: 'lcsc',
      location: '电阻盒',
      cell: '格位 A1',
    });

    const capacitor = body.groups.find((row) => row.name === '100nF 电容');
    expect(capacitor).toMatchObject({ perSet: 2, demand: 4, stock: 5, shortage: 0, setsPossible: 2 });

    const missing = body.groups.find((row) => row.name === '不存在的芯片');
    expect(missing).toMatchObject({ perSet: 1, demand: 2, status: 'missing', stock: null, shortage: 2 });
  });

  it('套数超出库存时给出缺口', async () => {
    await seed();
    const res = await call('POST', '/api/bom/preview', { csvText: CSV, sets: 5 });
    const body = res.json();
    const capacitor = body.groups.find((row) => row.name === '100nF 电容');
    expect(capacitor).toMatchObject({ demand: 10, stock: 5, shortage: 5, setsPossible: 2 });
    expect(body.summary.shortageGroups).toBeGreaterThan(0);
    expect(body.summary.maxSets).toBe(2);
  });

  it('未给套数时按单套需求量计算', async () => {
    await seed();
    const res = await call('POST', '/api/bom/preview', { csvText: CSV });
    const body = res.json();
    expect(body.summary.sets).toBe(null);
    expect(body.groups.find((row) => row.lcscCode === 'C25804').demand).toBe(3);
  });

  it('取料清单按位置分组', async () => {
    await seed();
    const res = await call('POST', '/api/bom/preview', { csvText: CSV, sets: 1 });
    const body = res.json();
    expect(body.pickup).toHaveLength(1);
    expect(body.pickup[0].location).toBe('电阻盒');
    expect(body.pickup[0].items.map((item) => item.cell)).toEqual(['格位 A1', '格位 A2']);
  });

  it('支持 xlsx 上传（multipart）', async () => {
    await seed();
    const rowsXml = `
      <row r="1"><c r="A1" t="inlineStr"><is><t>位号</t></is></c><c r="B1" t="inlineStr"><is><t>名称</t></is></c><c r="C1" t="inlineStr"><is><t>立创料号</t></is></c><c r="D1" t="inlineStr"><is><t>数量</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>R1,R2</t></is></c><c r="B2" t="inlineStr"><is><t>10k 电阻</t></is></c><c r="C2" t="inlineStr"><is><t>C25804</t></is></c><c r="D2"><v>2</v></c></row>`;
    const xlsx = makeXlsx(rowsXml);
    expect(xlsx.length).toBeGreaterThan(100);

    const boundary = '----partbinbom';
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bom.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
    );
    const setsField = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="sets"\r\n\r\n2`);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

    const res = await request(ctx.app, {
      method: 'POST',
      url: '/api/bom/preview',
      cookie: admin.cookie,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([head, xlsx, setsField, tail]),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.sets).toBe(2);
    expect(body.groups[0]).toMatchObject({
      lcscCode: 'C25804',
      perSet: 2,
      demand: 4,
      status: 'matched',
    });
  });

  it('缺少关键列时报 400', async () => {
    const res = await call('POST', '/api/bom/preview', { csvText: '批次,日期\n1,2026-01-01' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('缺少');
  });

  it('未登录不能使用 BOM 匹配', async () => {
    const res = await request(ctx.app, {
      method: 'POST',
      url: '/api/bom/preview',
      payload: { csvText: CSV },
    });
    expect(res.statusCode).toBe(401);
  });
});
