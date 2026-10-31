import { ERROR } from '../lib/errors.js';
import { buildPathMap } from '../lib/tree.js';
import { isZipBuffer, readXlsxRows } from '../lib/xlsx.js';
import { parseCsv } from './transfer.js';

/**
 * BOM 匹配：把 BOM 的每一行对应到本地物料，算出需求、库存、缺口与可支持套数。
 * 只读操作，不写任何流水。
 */

const HEADER_ALIASES = {
  designator: ['designator', '位号', 'refdes', 'reference', 'references', 'ref', '位号/ref'],
  name: ['comment', '名称', '元件名称', '物料名称', '元件', 'value', 'partname', 'part name'],
  lcsc: [
    'lcsc',
    'lcscpart',
    'lcsc part',
    'lcsc part #',
    'lcsc编号',
    'lcsc料号',
    '立创料号',
    '立创编号',
    '商品编号',
    'jlc',
    'jlcpcb',
    'jlcpcb part #',
    'supplier part',
    'supplier part number',
  ],
  quantity: ['quantity', '数量', 'qty', '用量', '单板用量', '每板用量'],
  model: ['model', '型号', 'partnumber', 'part number', '料号', '规格型号'],
  package: ['package', '封装', 'footprint', '封装/规格', 'package/footprint'],
  voltage: ['voltage', '耐压', '电压', '额定电压', 'vds', 'vmax', '工作电压'],
  manufacturer: ['manufacturer', '厂商', '品牌', 'mfr'],
  spec: ['spec', 'description', '描述', '规格', '参数'],
};

const MAX_ROWS = 10000;

function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[\s_\-/()（）[\]#.]/g, '');
}

function headerIndex(header) {
  const normalized = header.map(normalizeHeader);
  const index = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const keys = aliases.map(normalizeHeader);
    const position = normalized.findIndex((value) => keys.includes(value));
    if (position >= 0) index[field] = position;
  }
  return index;
}

function cell(cells, index, field) {
  if (index[field] === undefined) return '';
  return String(cells[index[field]] ?? '').trim();
}

/** 位号可能一格多个：R1,R2 / R1 R2 / R1-R4 */
function countDesignators(text) {
  if (!text) return 0;
  const parts = text.split(/[,，;；\s]+/).filter(Boolean);
  let count = 0;
  for (const part of parts) {
    const range = part.match(/^([A-Za-z]+)(\d+)-([A-Za-z]*)(\d+)$/);
    if (range && (range[3] === '' || range[3].toUpperCase() === range[1].toUpperCase())) {
      const from = Number(range[2]);
      const to = Number(range[4]);
      if (to >= from) count += to - from + 1;
      else count += 1;
      continue;
    }
    count += 1;
  }
  return count;
}

function parseQuantity(text) {
  if (!text) return null;
  const number = Number(String(text).replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * 统一读取 BOM 文件为二维字符串数组。
 * @param {{ buffer?: Buffer, text?: string, filename?: string }} input
 */
export function readBomRows({ buffer, text, filename = '' }) {
  if (Buffer.isBuffer(buffer) && isZipBuffer(buffer)) return readXlsxRows(buffer);

  const source = text ?? buffer?.toString('utf8') ?? '';
  if (!source.trim()) throw ERROR.validation('BOM 内容为空');

  const rows = parseCsv(source);
  if (rows.length === 0) throw ERROR.validation('BOM 内容为空');
  return rows;
}

function toCellLabel(row, col) {
  if (!row || !col) return null;
  return `格位 ${String.fromCharCode(64 + Number(row))}${col}`;
}

/** 参数归一化：去空白与大小写差异，1.8V 与 1.8 V 视为相同 */
function normalizeParam(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[（）()]/g, '');
}

/**
 * 对比 BOM 与本地物料的封装/耐压：只在实际两边都有值时判断。
 * @returns {string[]} 不一致项的说明
 */
function compareParams(group, item) {
  const mismatches = [];
  const check = (label, bomValue, itemValue) => {
    const a = normalizeParam(bomValue);
    const b = normalizeParam(itemValue);
    if (!a || !b || a === b) return;
    mismatches.push(`${label}不一致：BOM ${bomValue} / 本地 ${itemValue}`);
  };

  check('封装', group.package, item.package);
  check('耐压', group.voltage, item.voltage);
  return mismatches;
}

function buildLocationMaps(db) {
  const rows = db.prepare('SELECT id, parent_id, name FROM location').all();
  const paths = buildPathMap(rows);
  return {
    rows,
    pathOf(id) {
      if (id == null) return null;
      return paths.get(Number(id)) ?? null;
    },
  };
}

function buildItemIndex(db) {
  const items = db
    .prepare(
      `SELECT i.id, i.name, i.code, i.model, i.spec, i.package, i.voltage, i.unit, i.quantity, i.lcsc_code,
              i.location_id, i.cell_row, i.cell_col, i.is_archived,
              COALESCE((
                SELECT SUM(l.quantity - l.returned_quantity) FROM loan l
                WHERE l.item_id = i.id AND l.returned_quantity < l.quantity
              ), 0) AS lent_quantity
       FROM item i WHERE i.is_archived = 0`,
    )
    .all();

  const byLcsc = new Map();
  const byCode = new Map();
  const byModel = new Map();
  const byName = new Map();

  const push = (map, key, item) => {
    const normalized = String(key ?? '').trim().toLowerCase();
    if (!normalized) return;
    const list = map.get(normalized) ?? [];
    list.push(item);
    map.set(normalized, list);
  };

  for (const item of items) {
    const row = {
      ...item,
      available: Math.max(0, Number(item.quantity) - Number(item.lent_quantity ?? 0)),
    };
    push(byLcsc, item.lcsc_code, row);
    push(byCode, item.code, row);
    push(byModel, item.model, row);
    push(byName, item.name, row);
  }

  return { byLcsc, byCode, byModel, byName };
}

function matchItem(index, group) {
  const lookup = (map, key) => {
    const list = map.get(String(key ?? '').trim().toLowerCase());
    return list && list.length > 0 ? list : null;
  };

  if (group.lcscCode) {
    const hit = lookup(index.byLcsc, group.lcscCode);
    if (hit && hit.length === 1) return { item: hit[0], by: 'lcsc' };
  }
  if (group.model) {
    const hit = lookup(index.byModel, group.model);
    if (hit && hit.length === 1) return { item: hit[0], by: 'model' };
  }
  if (group.name) {
    const hit = lookup(index.byName, group.name);
    if (hit && hit.length === 1) return { item: hit[0], by: 'name' };
    if (hit && hit.length > 1) return { item: null, by: 'name', ambiguous: hit.length };
  }

  return { item: null, by: null };
}

/** 按料号 / 名称+封装+型号 合并同名行 */
function groupRows(rows) {
  const index = headerIndex(rows[0]);
  if (index.name === undefined && index.lcsc === undefined && index.model === undefined) {
    throw ERROR.validation('BOM 缺少「名称」或「立创料号」列，无法匹配');
  }

  const groups = new Map();
  let line = 1;
  for (let i = 1; i < rows.length; i += 1) {
    line = i + 1;
    const cells = rows[i];
    const name = cell(cells, index, 'name');
    const lcscCode = cell(cells, index, 'lcsc').toUpperCase().match(/C\d{4,10}/)?.[0] ?? '';
    const model = cell(cells, index, 'model');
    if (!name && !lcscCode && !model) continue;

    const designator = cell(cells, index, 'designator');
    const explicit = parseQuantity(cell(cells, index, 'quantity'));
    const perLine = explicit ?? (designator ? countDesignators(designator) : 1);

    const key = lcscCode
      ? `lcsc:${lcscCode}`
      : `n:${name.toLowerCase()}|p:${cell(cells, index, 'package').toLowerCase()}|m:${model.toLowerCase()}`;

    const existing = groups.get(key);
    if (existing) {
      existing.perSet += perLine;
      if (designator) existing.designators.push(designator);
      if (!existing.package) existing.package = cell(cells, index, 'package');
      if (!existing.voltage) existing.voltage = cell(cells, index, 'voltage');
      continue;
    }

    groups.set(key, {
      key,
      line,
      name,
      lcscCode: lcscCode || '',
      model,
      package: cell(cells, index, 'package'),
      voltage: cell(cells, index, 'voltage'),
      manufacturer: cell(cells, index, 'manufacturer'),
      spec: cell(cells, index, 'spec'),
      perSet: perLine,
      designators: designator ? [designator] : [],
    });
  }

  if (groups.size === 0) throw ERROR.validation('BOM 中没有可识别的元件行');
  return [...groups.values()];
}

/**
 * 生成 BOM 匹配报告。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ buffer?: Buffer, text?: string, filename?: string, sets?: number }} input
 */
export function matchBom(db, input = {}) {
  const rows = readBomRows(input);
  if (rows.length > MAX_ROWS) {
    throw ERROR.payloadTooLarge(`BOM 行数超过 ${MAX_ROWS}，请拆分后再导入`);
  }

  const rawSets = input.sets;
  const sets =
    rawSets == null || rawSets === ''
      ? null
      : Math.max(1, Math.min(10000, Number.parseInt(rawSets, 10) || 1));

  const index = buildItemIndex(db);
  const locations = buildLocationMaps(db);
  const groups = groupRows(rows);

  const report = [];
  let maxSets = Number.POSITIVE_INFINITY;
  let maxSetsLimited = false;

  for (const group of groups) {
    const { item, by, ambiguous } = matchItem(index, group);
    const perSet = group.perSet;
    const demand = sets == null ? perSet : perSet * sets;

    let status = 'matched';
    const mismatches = item ? compareParams(group, item) : [];
    if (!item) status = ambiguous ? 'ambiguous' : 'missing';
    else if (mismatches.length > 0) status = 'partial';

    const stock = item ? item.available : null;
    const shortage = item ? Math.max(0, demand - stock) : demand;
    const setsPossible =
      item && perSet > 0 ? Math.floor(item.available / perSet) : null;

    if (setsPossible != null) {
      if (setsPossible < maxSets) maxSets = setsPossible;
      if (setsPossible < 9999) maxSetsLimited = true;
    }

    report.push({
      key: group.key,
      line: group.line,
      name: group.name || item?.name || '',
      lcscCode: group.lcscCode || item?.lcsc_code || null,
      model: group.model || item?.model || null,
      package: group.package || item?.package || null,
      voltage: group.voltage || item?.voltage || null,
      manufacturer: group.manufacturer || null,
      perSet,
      demand,
      stock,
      shortage,
      setsPossible,
      status,
      mismatches,
      matchedBy: by,
      ambiguous: ambiguous ?? null,
      itemId: item?.id ?? null,
      itemName: item?.name ?? null,
      unit: item?.unit ?? '个',
      location: locations.pathOf(item?.location_id),
      cell: toCellLabel(item?.cell_row, item?.cell_col),
      designators: group.designators,
    });
  }

  const shortages = report.filter((row) => row.shortage > 0);
  const summary = {
    rows: rows.length - 1,
    groups: report.length,
    matched: report.filter((row) => row.status === 'matched').length,
    partial: report.filter((row) => row.status === 'partial').length,
    missing: report.filter((row) => row.status === 'missing').length,
    ambiguous: report.filter((row) => row.status === 'ambiguous').length,
    shortageGroups: shortages.length,
    sets,
    maxSets:
      maxSets === Number.POSITIVE_INFINITY ? null : maxSetsLimited ? maxSets : Math.min(maxSets, 9999),
  };

  // 取料清单：按位置分组，方便一次走完所有柜子
  const pickupMap = new Map();
  for (const row of report) {
    if ((row.status !== 'matched' && row.status !== 'partial') || !row.location) continue;
    const bucket = pickupMap.get(row.location) ?? [];
    bucket.push({
      itemId: row.itemId,
      name: row.itemName,
      cell: row.cell,
      demand: row.demand,
      unit: row.unit,
      shortage: row.shortage,
    });
    pickupMap.set(row.location, bucket);
  }
  const pickup = [...pickupMap.entries()]
    .map(([location, items]) => ({
      location,
      items: items.sort((a, b) => String(a.cell ?? '').localeCompare(String(b.cell ?? ''))),
    }))
    .sort((a, b) => a.location.localeCompare(b.location));

  return { summary, groups: report, pickup };
}
