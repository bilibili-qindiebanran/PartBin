import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crc32, readXlsxRows } from '../src/lib/xlsx.js';
import {
  createFixture,
  destroyFixture,
  createAdminAccount,
  createUserAccount,
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
      package: '0603',
      voltage: '50V',
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

  it('封装或耐压不一致时标记为部分匹配', async () => {
    await seed();
    const csv = ['位号,名称,立创料号,数量,封装,耐压', 'C1,100nF 电容,,1,0805,25V'].join('\n');
    const res = await call('POST', '/api/bom/preview', { csvText: csv });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.summary.partial).toBe(1);
    expect(body.summary.matched).toBe(0);
    const row = body.groups[0];
    expect(row.status).toBe('partial');
    expect(row.mismatches.join(' ')).toContain('封装');
    expect(row.mismatches.join(' ')).toContain('耐压');
    // 参数不一致仍算本地有货，可用于取料
    expect(body.pickup[0].items).toHaveLength(1);
  });

  it('参数一致或本地未填参数时算完全匹配', async () => {
    await seed();
    const csv = [
      '位号,名称,数量,封装,耐压',
      'C1,100nF 电容,1,0603,50v',
      'C2,10k 电阻,1,0603,',
    ].join('\n');
    const res = await call('POST', '/api/bom/preview', { csvText: csv });
    const body = res.json();
    expect(body.summary.partial).toBe(0);
    expect(body.groups.every((row) => row.status === 'matched')).toBe(true);
  });

  it('值+封装族匹配：40kΩ / 100Ω 与库内 0603 40K / 0603 100R 视为同一物料', async () => {
    await call('POST', '/api/items', { name: '0603 40K', unit: '个', quantity: 50, package: '0603' });
    await call('POST', '/api/items', { name: '0603 100R', unit: '个', quantity: 50, package: '0603' });

    const csv = ['位号,名称,数量,封装', 'R1,40kΩ,1,R0603', 'R2,100Ω,1,R0603'].join('\n');
    const res = await call('POST', '/api/bom/preview', { csvText: csv });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.summary).toMatchObject({ matched: 2, missing: 0 });
    expect(body.groups.map((row) => row.matchedBy)).toEqual(['value', 'value']);
    expect(body.groups[0].itemName).toBe('0603 40K');
  });

  it('封装比较改成严格后，同一行回退为部分匹配', async () => {
    await call('POST', '/api/items', { name: '0603 40K', unit: '个', quantity: 50, package: '0603' });

    const csv = ['位号,名称,数量,封装', 'R1,40kΩ,1,R0603'].join('\n');
    const res = await call('POST', '/api/bom/preview', {
      csvText: csv,
      options: { packageTolerance: 'strict' },
    });

    const body = res.json();
    expect(body.summary.partial).toBe(1);
    expect(body.groups[0].status).toBe('partial');
    expect(body.summary.options.packageTolerance).toBe('strict');
  });

  it('识别 Manufacturer Part 列作为型号匹配', async () => {
    await call('POST', '/api/items', {
      name: '贴片电阻',
      unit: '个',
      quantity: 40,
      model: 'CSA0603C0G150J500JT',
    });

    const csv = ['位号,Comment,Quantity,Footprint,Manufacturer Part', 'C3,15pF,1,C0603,CSA0603C0G150J500JT'].join(
      '\n',
    );
    const res = await call('POST', '/api/bom/preview', { csvText: csv });

    const body = res.json();
    expect(body.summary.matched).toBe(1);
    expect(body.groups[0].matchedBy).toBe('model');
  });

  it('型号宽松匹配：BOM 写短型号 W25Q128JV，库里是 W25Q128JVSIQ 也能命中', async () => {
    await call('POST', '/api/items', {
      name: 'W25Q128JVSIQ 闪存',
      unit: '个',
      quantity: 30,
      model: 'W25Q128JVSIQ',
      package: 'SOP-8',
    });

    const csv = ['位号,名称,数量,封装,型号', 'U1,W25Q128JVSIQ,1,SOP-8,W25Q128JV'].join('\n');
    const res = await call('POST', '/api/bom/preview', { csvText: csv });

    const body = res.json();
    expect(body.summary).toMatchObject({ matched: 1, missing: 0, ambiguous: 0 });
    expect(body.groups[0]).toMatchObject({
      status: 'matched',
      matchedBy: 'model',
      itemName: 'W25Q128JVSIQ 闪存',
    });
  });

  it('型号宽松匹配支持分隔符差异（W25Q128JV-SIQ ↔ W25Q128JVSIQ）', async () => {
    await call('POST', '/api/items', {
      name: 'W25Q128JVSIQ 闪存',
      unit: '个',
      quantity: 10,
      model: 'W25Q128JVSIQ',
    });

    const csv = ['位号,名称,数量,型号', 'U1,Flash,1,w25q128jv-siq'].join('\n');
    const res = await call('POST', '/api/bom/preview', { csvText: csv });

    const body = res.json();
    expect(body.summary.matched).toBe(1);
    expect(body.groups[0].matchedBy).toBe('model');
  });

  it('Comment 直接写型号、Manufacturer Part 为空时也能命中库内型号', async () => {
    await call('POST', '/api/items', {
      name: 'W25Qxx 16MB flash',
      unit: '个',
      quantity: 10,
      model: 'W25Q128JVSIQ',
      package: 'SOP-8',
    });

    // 立创 EDA 导出：Comment=型号名，Value 与 Manufacturer Part 都为空
    const csv = [
      'No.,Quantity,Comment,Designator,Footprint,Value,Manufacturer Part',
      '4,1,W25Q128JVSIQ,,, ,',
    ].join('\n');
    const res = await call('POST', '/api/bom/preview', { csvText: csv });

    const body = res.json();
    expect(body.summary).toMatchObject({ matched: 1, missing: 0 });
    expect(body.groups[0]).toMatchObject({
      status: 'matched',
      matchedBy: 'model',
      itemName: 'W25Qxx 16MB flash',
      stock: 10,
    });
  });

  it('同时有 Comment 与 Value 两列时，Value 不会被丢弃', async () => {
    await call('POST', '/api/items', {
      name: 'W25Qxx 16MB flash',
      unit: '个',
      quantity: 10,
      model: 'W25Q128JVSIQ',
    });

    // Comment 写元件值，Value 才写型号
    const csv = [
      '位号,Comment,Quantity,Footprint,Value',
      'U1,Flash,1,SOP-8,W25Q128JVSIQ',
    ].join('\n');
    const res = await call('POST', '/api/bom/preview', { csvText: csv });

    const body = res.json();
    expect(body.summary.matched).toBe(1);
    expect(body.groups[0]).toMatchObject({
      matchedBy: 'model',
      itemName: 'W25Qxx 16MB flash',
    });
  });

  it('只有 Value 列、没有 Comment 列时仍能按名称匹配', async () => {
    await call('POST', '/api/items', {
      name: '10k 电阻',
      unit: '个',
      quantity: 100,
      lcscCode: 'C25804',
    });

    const csv = ['位号,Value,Quantity', 'R1,10k 电阻,1'].join('\n');
    const res = await call('POST', '/api/bom/preview', { csvText: csv });

    const body = res.json();
    expect(body.summary.matched).toBe(1);
    expect(body.groups[0].itemName).toBe('10k 电阻');
  });

  it('型号前缀命中多条时返回候选而不是直接判定缺失', async () => {
    await call('POST', '/api/items', {
      name: 'W25Q128JVSIQ 闪存',
      unit: '个',
      quantity: 10,
      model: 'W25Q128JVSIQ',
    });
    await call('POST', '/api/items', {
      name: 'W25Q128JVSSIQ 闪存',
      unit: '个',
      quantity: 5,
      model: 'W25Q128JVSSIQ',
    });

    const csv = ['位号,名称,数量,型号', 'U1,Flash,1,W25Q128JV'].join('\n');
    const res = await call('POST', '/api/bom/preview', { csvText: csv });

    const body = res.json();
    expect(body.summary.ambiguous).toBe(1);
    expect(body.groups[0].status).toBe('ambiguous');
    expect(body.groups[0].candidates.map((item) => item.model).sort()).toEqual([
      'W25Q128JVSIQ',
      'W25Q128JVSSIQ',
    ]);
  });

  it('不像料号的短名称不会被前缀匹配误命中', async () => {
    await call('POST', '/api/items', {
      name: '0603 40K',
      unit: '个',
      quantity: 50,
      package: '0603',
      model: '0603WAF4002T5E',
    });

    const csv = ['位号,名称,数量,封装,型号', 'R1,电阻,1,0603,0603'].join('\n');
    const res = await call('POST', '/api/bom/preview', { csvText: csv });

    const body = res.json();
    expect(body.summary.matched).toBe(0);
    expect(body.summary.missing).toBe(1);
  });

  it('库内多条同值同封装时返回候选而不是直接缺失', async () => {
    await call('POST', '/api/items', { name: '0603 15pF 50V', unit: '个', quantity: 50, package: '0603' });
    await call('POST', '/api/items', { name: '0603 15pF 100V', unit: '个', quantity: 20, package: '0603' });

    const csv = ['位号,名称,数量,封装', 'C1,15pF,1,C0603'].join('\n');
    const res = await call('POST', '/api/bom/preview', { csvText: csv });

    const body = res.json();
    expect(body.summary.ambiguous).toBe(1);
    const row = body.groups[0];
    expect(row.status).toBe('ambiguous');
    expect(row.candidates).toHaveLength(2);
    expect(row.candidates.map((item) => item.name).sort()).toEqual([
      '0603 15pF 100V',
      '0603 15pF 50V',
    ]);
    expect(row.candidates[0]).toHaveProperty('available');
  });

  it('覆盖重算：前端回传分组 + 人工指定后变成已匹配', async () => {
    const created = await call('POST', '/api/items', {
      name: '0603 15pF 50V',
      unit: '个',
      quantity: 50,
      package: '0603',
    });
    const itemId = created.json().item.id;

    const csv = ['位号,名称,数量,封装', 'C1,22pF,1,C0603'].join('\n');
    const preview = await call('POST', '/api/bom/preview', { csvText: csv });
    const row = preview.json().groups[0];
    expect(row.status).toBe('missing');

    const applied = await call('POST', '/api/bom/apply', {
      sets: 2,
      groups: preview.json().groups,
      overrides: [{ key: row.matchKey, itemId }],
    });
    expect(applied.statusCode).toBe(200);

    const body = applied.json();
    const updated = body.groups[0];
    expect(updated).toMatchObject({
      status: 'matched',
      matchedBy: 'manual',
      itemId,
      demand: 2,
      stock: 50,
      shortage: 0,
      setsPossible: 50,
    });
    expect(body.summary.matched).toBe(1);
  });

  it('记住人工对应关系后，下次上传同一份 BOM 自动命中', async () => {
    const created = await call('POST', '/api/items', {
      name: '0603 15pF 50V',
      unit: '个',
      quantity: 50,
      package: '0603',
    });
    const itemId = created.json().item.id;

    const csv = ['位号,名称,数量,封装', 'C1,22pF,1,C0603'].join('\n');
    const first = await call('POST', '/api/bom/preview', { csvText: csv });
    const matchKey = first.json().groups[0].matchKey;

    const saved = await call('POST', '/api/bom/resolve', { matchKey, itemId, action: 'bind' });
    expect(saved.statusCode).toBe(201);
    expect(saved.json().alias).toMatchObject({ matchKey, itemId, skipParams: false });

    const second = await call('POST', '/api/bom/preview', { csvText: csv });
    const row = second.json().groups[0];
    expect(row).toMatchObject({ status: 'matched', matchedBy: 'alias', itemId });

    const aliases = await call('GET', '/api/bom/aliases');
    expect(aliases.json().data).toHaveLength(1);

    const removed = await call('POST', '/api/bom/resolve', { matchKey, action: 'unbind' });
    expect(removed.json().removed).toBe(true);

    const third = await call('POST', '/api/bom/preview', { csvText: csv });
    expect(third.json().groups[0].status).toBe('missing');
  });

  it('接受差异：封装不同的行也能升级为完全匹配', async () => {
    const seeded = await seed();
    const csv = ['位号,名称,数量,封装', 'C1,100nF 电容,1,0805'].join('\n');

    const before = await call('POST', '/api/bom/preview', { csvText: csv });
    expect(before.json().groups[0].status).toBe('partial');

    const accepted = await call('POST', '/api/bom/resolve', {
      matchKey: before.json().groups[0].matchKey,
      itemId: seeded.capacitor.id,
      action: 'accept',
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().alias.skipParams).toBe(true);

    const after = await call('POST', '/api/bom/preview', { csvText: csv });
    expect(after.json().groups[0]).toMatchObject({
      status: 'matched',
      matchedBy: 'alias',
      skipParams: true,
    });
    expect(after.json().groups[0].mismatches).toEqual([]);
  });

  it('只读账号不能写入人工对应关系，但可以查看', async () => {
    const reader = await createUserAccount(ctx, 'reader');
    const created = await call('POST', '/api/items', { name: '0603 15pF 50V', unit: '个', quantity: 5 });
    const itemId = created.json().item.id;

    const forbidden = await request(ctx.app, {
      method: 'POST',
      url: '/api/bom/resolve',
      cookie: reader.cookie,
      payload: { matchKey: 'val:0603|c:2.2e-11', itemId, action: 'bind' },
    });
    expect(forbidden.statusCode).toBe(403);

    const list = await request(ctx.app, {
      method: 'GET',
      url: '/api/bom/aliases',
      cookie: reader.cookie,
    });
    expect(list.statusCode).toBe(200);
  });

  it('对应关系列表带创建人，支持批量删除', async () => {
    const created = await call('POST', '/api/items', {
      name: '0603 22pF 50V',
      unit: '个',
      quantity: 50,
      package: '0603',
    });
    const itemId = created.json().item.id;

    for (const [index, key] of ['val:0603|c:2.2e-11', 'name:22pf'].entries()) {
      const res = await call('POST', '/api/bom/resolve', {
        matchKey: key,
        itemId,
        action: 'bind',
        note: `第 ${index + 1} 条`,
      });
      expect(res.statusCode).toBe(201);
    }

    const list = await call('GET', '/api/bom/aliases');
    const rows = list.json().data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: 'name',
      itemId,
      itemName: '0603 22pF 50V',
      itemQuantity: 50,
      itemArchived: false,
      createdBy: 'admin',
      note: '第 2 条',
    });
    expect(rows[1].kind).toBe('val');

    const removed = await call('POST', '/api/bom/aliases/delete', {
      ids: rows.map((row) => row.id),
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().removed).toBe(2);
    expect((await call('GET', '/api/bom/aliases')).json().data).toHaveLength(0);
  });

  it('只读账号不能批量删除对应关系', async () => {
    const reader = await createUserAccount(ctx, 'reader2');
    const res = await request(ctx.app, {
      method: 'POST',
      url: '/api/bom/aliases/delete',
      cookie: reader.cookie,
      payload: { ids: [1] },
    });
    expect(res.statusCode).toBe(403);
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
