import { ERROR } from '../lib/errors.js';
import { buildPathMap } from '../lib/tree.js';
import { isZipBuffer, readXlsxRows } from '../lib/xlsx.js';
import { loadAliasMap } from './bom-alias.js';
import { parseCsv } from './transfer.js';

/**
 * BOM 匹配：把 BOM 的每一行对应到本地物料，算出需求、库存、缺口与可支持套数。
 * 只读操作，不写任何流水。
 */

const HEADER_ALIASES = {
  designator: ['designator', '位号', 'refdes', 'reference', 'references', 'ref', '位号/ref'],
  name: ['comment', '名称', '元件名称', '物料名称', '元件', 'partname', 'part name'],
  // 立创 EDA 导出的 BOM 常同时有 Comment 和 Value 两列，内容可能不同：
  // Comment 写元件值或型号名，Value 写元件值（偶尔才是型号）。两列都读，不要丢。
  value: ['value', '元件值', '值'],
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
  model: [
    'model',
    '型号',
    'partnumber',
    'part number',
    '料号',
    '规格型号',
    'manufacturer part',
    'manufacturer part number',
    'mfr part',
    'mfr part number',
    'mpn',
    '厂家料号',
    '厂商料号',
    '制造商料号',
  ],
  package: ['package', '封装', 'footprint', '封装/规格', 'package/footprint'],
  voltage: ['voltage', '耐压', '电压', '额定电压', 'vds', 'vmax', '工作电压'],
  manufacturer: ['manufacturer', '厂商', '品牌', 'mfr'],
  spec: ['spec', 'description', '描述', '规格', '参数'],
  stock: ['my stock', 'mystock', '现有库存', '库存', '库存数'],
};

const MAX_ROWS = 10000;
const MAX_CANDIDATES = 8;
const MAX_NEAR_MISSES = 3;
/** 型号宽松匹配的最短长度：太短的串（0603、10K）不做前缀匹配，避免一片误命中 */
const MODEL_MIN_LENGTH = 6;

/** 匹配选项默认值；前端可逐项覆盖 */
export const DEFAULT_MATCH_OPTIONS = Object.freeze({
  valueMatch: true,
  packageTolerance: 'family',
  includeArchived: false,
  acceptParamMismatch: false,
  useManufacturerPart: true,
});

const PACKAGE_TOLERANCES = new Set(['strict', 'family', 'ignore']);

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'on', 'yes'].includes(String(value).toLowerCase());
}

/**
 * 归一化匹配选项。接受对象或 JSON 字符串，非法值回退默认。
 * @param {unknown} raw
 */
export function resolveOptions(raw) {
  let source = raw;
  if (typeof raw === 'string') {
    try {
      source = JSON.parse(raw);
    } catch {
      source = {};
    }
  }
  if (!source || typeof source !== 'object') source = {};

  return {
    valueMatch: toBool(source.valueMatch, DEFAULT_MATCH_OPTIONS.valueMatch),
    packageTolerance: PACKAGE_TOLERANCES.has(source.packageTolerance)
      ? source.packageTolerance
      : DEFAULT_MATCH_OPTIONS.packageTolerance,
    includeArchived: toBool(source.includeArchived, DEFAULT_MATCH_OPTIONS.includeArchived),
    acceptParamMismatch: toBool(
      source.acceptParamMismatch,
      DEFAULT_MATCH_OPTIONS.acceptParamMismatch,
    ),
    useManufacturerPart: toBool(
      source.useManufacturerPart,
      DEFAULT_MATCH_OPTIONS.useManufacturerPart,
    ),
  };
}

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

// ---------------------------------------------------------------------------
// 型号归一化与宽松匹配
// ---------------------------------------------------------------------------

/**
 * 型号归一：去大小写、空白与常见分隔符。
 * W25Q128JV-SIQ / W25Q128JVSIQ / w25q128jv 归一后都是同一个键。
 */
function normalizeModelKey(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[\s\-_/.,;:＋()\uff08\uff09\[\]]+/g, '');
}

/**
 * 只有「像料号」的串才做前缀匹配：必须同时含字母和数字。
 * 这样可以避免把「10k 电阻」「0603」这类名称当成型号去模糊命中一大片。
 */
function looksLikePartNumber(value) {
  const raw = String(value ?? '').trim();
  if (raw.length < MODEL_MIN_LENGTH) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9\s\-_/.,+]*$/.test(raw)) return false;
  return /[A-Za-z]/.test(raw) && /\d/.test(raw);
}

// ---------------------------------------------------------------------------
// 封装族归一化
// ---------------------------------------------------------------------------

/** EasyEDA / KiCad 长封装名 → 简短族名，便于与手写封装比较 */
const PACKAGE_ALIASES = new Map([
  ['TSOT-23-3', 'SOT-23'],
  ['SOT-23-3', 'SOT-23'],
  ['SOT-323-3', 'SOT-323'],
  ['SOT-363-6', 'SOT-363'],
  ['SMD3215-2P', '3215'],
  ['SMD3225-4P', '3225'],
  ['49S', 'HC-49S'],
]);

/** 从长封装名里抽尺寸码：L4.4-W4.2 / 4.4x4.2 → 4442 */
function dimensionCode(upper) {
  const code = (value) => {
    const [intPart, decPart] = String(value).split('.');
    return decPart ? `${intPart}${decPart}` : `${intPart}0`;
  };

  const pairRe = /[LW]?(\d+(?:\.\d+)?)\s*[-X*×]\s*[LW]?(\d+(?:\.\d+)?)/g;
  let match;
  while ((match = pairRe.exec(upper)) !== null) {
    const a = code(match[1]);
    const b = code(match[2]);
    if (/^\d{2}$/.test(a) && /^\d{2}$/.test(b)) return a + b;
  }
  return '';
}

/**
 * 封装族：C0603 / R0603 / L0603 / 0603_S → 0603；
 * SOT-363_L2.0-W1.3-P0.65-LS2.1-BR → SOT-363；USB-C-SMD_TYPE-C-16P-1 → TYPE-C-16P。
 * @param {unknown} pkg
 */
export function packageFamily(pkg) {
  const raw = String(pkg ?? '').trim();
  if (!raw) return '';

  const upper = raw.toUpperCase().replace(/\s+/g, '');
  const usb = upper.match(/(?:TYPE|USB)-?C[-_]?(\d+)P/);
  if (usb) return `TYPE-C-${usb[1]}P`;

  const head = upper.split('_')[0];

  const chip = head.match(/^[CRLD]?(\d{4})$/);
  if (chip) return chip[1];

  return PACKAGE_ALIASES.get(head) ?? head;
}

/**
 * 封装是否视为一致：族名相等，或者能抽到相同的尺寸码
 * （IND-SMD_L4.4-W4.2 ↔ SMD,4.4x4.2mm 这类手写命名）。
 */
function packageCompatible(left, right) {
  const a = packageFamily(left);
  const b = packageFamily(right);
  if (!a || !b) return true;
  if (a === b) return true;

  const da = dimensionCode(String(left ?? '').toUpperCase().replace(/\s+/g, ''));
  const db = dimensionCode(String(right ?? '').toUpperCase().replace(/\s+/g, ''));
  if (da && db && da === db) return true;

  // 一侧是 EasyEDA 尺寸码（如 3225），另一侧已经是同名的封装族
  if (da && da === b) return true;
  if (db && db === a) return true;

  return false;
}

// ---------------------------------------------------------------------------
// 电气值归一化（40kΩ / 40K / 100Ω / 100R / 4.7uF / 24nH / 8MHz）
// ---------------------------------------------------------------------------

const SI_PREFIX = { p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3, '': 1 };
const MULTIPLIER = { '': 1, k: 1e3, m: 1e6, g: 1e9 };

function parseValueToken(token) {
  const t = token.replace(/[μµ]/g, 'u').toLowerCase();

  const hz = t.match(/^(\d+(?:\.\d+)?)([kmg]?)hz$/);
  if (hz) return { kind: 'HZ', base: Number(hz[1]) * (MULTIPLIER[hz[2]] ?? 1) };

  const cap = t.match(/^(\d+(?:\.\d+)?)([pnum]?)f$/);
  if (cap) return { kind: 'C', base: Number(cap[1]) * (SI_PREFIX[cap[2]] ?? 1) };

  const ind = t.match(/^(\d+(?:\.\d+)?)([pnum]?)h$/);
  if (ind) return { kind: 'H', base: Number(ind[1]) * (SI_PREFIX[ind[2]] ?? 1) };

  const res = t.match(/^(\d+(?:\.\d+)?)([kmg]?)(?:ω|ohm|r)$/);
  if (res) return { kind: 'R', base: Number(res[1]) * (MULTIPLIER[res[2]] ?? 1) };

  return null;
}

/** 稳定的浮点表示，避免 4.7uF 与 4700nF 因浮点误差判为不同 */
function valueCode(value) {
  return Number(Number(value.base).toPrecision(6));
}

const VALUE_TOKEN_SPLIT = /[\s,，、;；/()（）【】[\]]+/;

/**
 * 解析名称里的全部电气值。
 * 阻容/晶振这类命名差异（40kΩ ↔ 40K、100Ω ↔ 100R）靠它兜底。
 * 之所以要「全部」：库内 `0603 2.2R 2R` 这种一条物料同时写了两个等效值的写法，
 * 两个键都该能命中。
 * @returns {{ kind: 'R'|'C'|'H'|'HZ', base: number }[]}
 */
export function parseElectricalValues(input) {
  const text = String(input ?? '').trim();
  if (!text) return [];

  const tokens = text.split(VALUE_TOKEN_SPLIT).filter(Boolean);
  const values = [];
  const add = (value) => {
    if (!values.some((item) => item.kind === value.kind && valueCode(item) === valueCode(value))) {
      values.push(value);
    }
  };

  for (const token of tokens) {
    const hit = parseValueToken(token);
    if (hit) add(hit);
  }

  // 裸数字 + 倍率（10K / 4.7K / 1M）：只在名称里没有电容/频率单位时启用，
  // 避免把晶振名里的 "8M" 误判成 8MΩ 电阻。
  if (!/(?:p|n|u|m)?f$|hz$/i.test(text.replace(/\s+/g, ''))) {
    for (const token of tokens) {
      const bare = token.match(/^(\d+(?:\.\d+)?)([kmg])$/i);
      if (bare) {
        add({ kind: 'R', base: Number(bare[1]) * (MULTIPLIER[bare[2].toLowerCase()] ?? 1) });
      }
    }
  }

  return values;
}

/** 取第一个电气值（BOM 侧只需主值） */
export function parseElectricalValue(input) {
  return parseElectricalValues(input)[0] ?? null;
}

/** 电气值的归一化后缀：r:100 / c:0.00001 / h:2.4e-8 / hz:8000000 */
function valueSuffixesOf(name, all = false) {
  const values = parseElectricalValues(name);
  const picked = all ? values : values.slice(0, 1);
  return picked.map((value) => `${value.kind}:${valueCode(value)}`.toLowerCase());
}

/**
 * 「封装族/尺寸码 + 电气值」联合键，用于值匹配。
 * 尺寸码让 IND-SMD_L4.4-W4.2、OSC-SMD_L3.2-W1.5 这类长名也能对上 4442 / 3215。
 */
function valueKeysOf(name, pkg, all = false) {
  const suffixes = valueSuffixesOf(name, all);
  if (suffixes.length === 0) return [];

  const families = new Set();
  const family = packageFamily(pkg);
  if (family) families.add(family.toLowerCase());

  const dim = dimensionCode(String(pkg ?? '').toUpperCase().replace(/\s+/g, ''));
  if (dim) families.add(dim.toLowerCase());

  const keys = new Set();
  for (const prefix of families) {
    for (const suffix of suffixes) keys.add(`${prefix}|${suffix}`);
  }
  return [...keys];
}

/**
 * 对比 BOM 与本地物料的封装/耐压：只在实际两边都有值时判断。
 * packageTolerance: strict 全串相等 / family 封装族相等 / ignore 不比封装。
 * @returns {string[]} 不一致项的说明
 */
function compareParams(group, item, options) {
  const mismatches = [];
  const tolerance = options.packageTolerance ?? DEFAULT_MATCH_OPTIONS.packageTolerance;

  if (tolerance !== 'ignore') {
    const compatible =
      tolerance === 'family'
        ? packageCompatible(group.package, item.package)
        : (() => {
            const a = normalizeParam(group.package);
            const b = normalizeParam(item.package);
            return !a || !b || a === b;
          })();
    if (!compatible) {
      mismatches.push(`封装不一致：BOM ${group.package} / 本地 ${item.package}`);
    }
  }

  const check = (label, bomValue, itemValue) => {
    const a = normalizeParam(bomValue);
    const b = normalizeParam(itemValue);
    if (!a || !b || a === b) return;
    mismatches.push(`${label}不一致：BOM ${bomValue} / 本地 ${itemValue}`);
  };

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

function buildItemIndex(db, options) {
  const items = db
    .prepare(
      `SELECT i.id, i.name, i.code, i.model, i.spec, i.package, i.voltage, i.unit, i.quantity,
              i.lcsc_code, i.location_id, i.cell_row, i.cell_col, i.is_archived,
              COALESCE((
                SELECT SUM(l.quantity - l.returned_quantity) FROM loan l
                WHERE l.item_id = i.id AND l.returned_quantity < l.quantity
              ), 0) AS lent_quantity
       FROM item i`,
    )
    .all();

  const rows = items.map((item) => ({
    ...item,
    archived: Number(item.is_archived) === 1,
    available: Math.max(0, Number(item.quantity) - Number(item.lent_quantity ?? 0)),
  }));

  // 人工对应可以指向归档物料，因此 byId 一定包含全部条目
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const pool = options.includeArchived ? rows : rows.filter((row) => !row.archived);

  const byLcsc = new Map();
  const byCode = new Map();
  const byModel = new Map();
  const byName = new Map();
  const byValue = new Map();
  /** 归一型号 → 物料行，供前缀宽松匹配使用 */
  const byModelLoose = new Map();

  const push = (map, key, row) => {
    const normalized = String(key ?? '').trim().toLowerCase();
    if (!normalized) return;
    const list = map.get(normalized) ?? [];
    list.push(row);
    map.set(normalized, list);
  };

  for (const row of pool) {
    push(byLcsc, row.lcsc_code, row);
    push(byCode, row.code, row);
    push(byModel, row.model, row);
    push(byName, row.name, row);

    const modelKey = normalizeModelKey(row.model);
    if (modelKey.length >= MODEL_MIN_LENGTH) {
      const list = byModelLoose.get(modelKey) ?? [];
      list.push(row);
      byModelLoose.set(modelKey, list);
    }

    for (const valueKey of valueKeysOf(`${row.name ?? ''} ${row.model ?? ''}`, row.package, true)) {
      const list = byValue.get(valueKey) ?? [];
      list.push(row);
      byValue.set(valueKey, list);
    }
  }

  // 已排序的归一型号键，二分定位前缀区间
  const modelKeys = [...byModelLoose.keys()].sort();

  return {
    rows,
    pool,
    byId,
    byLcsc,
    byCode,
    byModel,
    byName,
    byValue,
    byModelLoose,
    modelKeys,
  };
}

/**
 * 型号宽松匹配：精确相等失败后再试一次。
 * 覆盖两类常见写法差异：
 * - BOM 写短型号 W25Q128JV，库里是完整型号 W25Q128JVSIQ（库内型号以查询串开头）
 * - BOM 写完整型号，库里记的是短型号（查询串以库内型号开头）
 * @returns {object[] | null} null 表示命中过多（型号太泛），宁可当作未命中
 */
function prefixModelRows(index, candidate) {
  if (!looksLikePartNumber(candidate)) return [];
  const needle = normalizeModelKey(candidate);
  if (needle.length < MODEL_MIN_LENGTH) return [];

  const found = new Map();
  const addRows = (rows) => {
    for (const row of rows) {
      found.set(Number(row.id), row);
      if (found.size > MAX_CANDIDATES) return false;
    }
    return true;
  };

  // 库内型号以查询串开头：二分找到下界后线性扫描
  let lo = 0;
  let hi = index.modelKeys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (index.modelKeys[mid] < needle) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < index.modelKeys.length; i += 1) {
    const key = index.modelKeys[i];
    if (!key.startsWith(needle)) break;
    if (!addRows(index.byModelLoose.get(key))) return null;
  }

  // 查询串以库内型号开头：逐个前缀长度查表，长度写在前面才能优先选到更长的型号
  for (let len = needle.length - 1; len >= MODEL_MIN_LENGTH; len -= 1) {
    const rows = index.byModelLoose.get(needle.slice(0, len));
    if (rows && !addRows(rows)) return null;
  }

  return [...found.values()];
}

/**
 * BOM 行里可能写型号的所有字段：厂家型号、Comment、Value。
 * 立创 EDA 导出的 BOM 经常把型号写在 Comment（如 W25Q128JVSIQ），
 * 而 Manufacturer Part 留空，此时只能用名称字段去对库内 model。
 * @returns {string[]} 去重后的非空候选串，已排除 group.model
 */
function partNumberCandidatesOf(group) {
  const model = String(group?.model ?? '').trim();
  const seen = new Set();
  const out = [];
  for (const raw of [group?.name, group?.valueText]) {
    const text = String(raw ?? '').trim();
    if (!text || text === model) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function candidateOf(row, locations) {
  return {
    itemId: Number(row.id),
    name: row.name,
    model: row.model ?? null,
    package: row.package ?? null,
    quantity: Number(row.quantity),
    available: row.available,
    lcscCode: row.lcsc_code ?? null,
    archived: row.archived,
    location: locations.pathOf(row.location_id),
    cell: toCellLabel(row.cell_row, row.cell_col),
  };
}

/**
 * 匹配链：料号 → 型号/厂家料号 → 名称 → 值+封装族。
 * 单条命中才算命中；多条命中先记下候选，继续尝试更弱的通道。
 */
function matchItem(index, group, options) {
  const tiers = [];
  if (group.lcscCode) tiers.push(['lcsc', index.byLcsc, group.lcscCode]);
  if (options.useManufacturerPart && group.model) tiers.push(['model', index.byModel, group.model]);
  if (group.code) tiers.push(['code', index.byCode, group.code]);
  if (group.name) tiers.push(['name', index.byName, group.name]);

  let multiple = null;
  for (const [by, map, key] of tiers) {
    const list = map.get(String(key ?? '').trim().toLowerCase());
    if (!list || list.length === 0) continue;
    if (list.length === 1) return { item: list[0], by };
    if (!multiple) multiple = { by, list };
  }

  // 型号宽松匹配：BOM 写 W25Q128JV、库里是 W25Q128JVSIQ 这类差异靠它兜底
  if (options.useManufacturerPart && group.model) {
    const looseRows = prefixModelRows(index, group.model);
    if (looseRows && looseRows.length === 1) return { item: looseRows[0], by: 'model' };
    if (looseRows && looseRows.length > 1 && !multiple) {
      multiple = { by: 'model', list: looseRows };
    }
  }

  // Manufacturer Part 为空、Comment/Value 直接写型号（如 W25Q128JVSIQ）时，
  // 名称通道同样要能对到库内 model，否则这类行永远判为缺失。
  for (const candidate of partNumberCandidatesOf(group)) {
    const looseRows = prefixModelRows(index, candidate);
    if (!looseRows || looseRows.length === 0) continue;
    if (looseRows.length === 1) return { item: looseRows[0], by: 'model' };
    if (!multiple) multiple = { by: 'model', list: looseRows };
  }

  // 值 + 封装族/尺寸码（可命中多个键）
  if (options.valueMatch && group.valueKeys?.length) {
    const hits = new Map();
    for (const valueKey of group.valueKeys) {
      for (const row of index.byValue.get(valueKey) ?? []) hits.set(Number(row.id), row);
    }
    if (hits.size === 1) return { item: [...hits.values()][0], by: 'value' };
    if (hits.size > 1 && !multiple) multiple = { by: 'value', list: [...hits.values()] };
  }

  if (multiple) {
    return {
      item: null,
      by: multiple.by,
      ambiguous: multiple.list.length,
      candidates: multiple.list,
    };
  }
  return { item: null, by: null };
}

/** 未匹配时给出库内近似候选，方便人工选定 */
function nearMissesOf(index, group) {
  const found = new Map();
  const add = (row) => {
    if (found.size >= MAX_CANDIDATES) return;
    if (!found.has(Number(row.id))) found.set(Number(row.id), row);
  };

  // 型号前缀近似：BOM 型号与库内型号互为前缀；Comment/Value 写型号时同样纳入
  for (const candidate of [group.model, ...partNumberCandidatesOf(group)]) {
    if (!candidate) continue;
    for (const row of prefixModelRows(index, candidate) ?? []) add(row);
  }

  if (group.valueKeys?.length) {
    const wanted = new Set(valueSuffixesOf(group.name, true));
    for (const row of index.pool) {
      const suffixes = valueSuffixesOf(`${row.name ?? ''} ${row.model ?? ''}`, true);
      if (suffixes.some((suffix) => wanted.has(suffix))) add(row);
    }
  }

  const needle = String(group.name ?? '').trim().toLowerCase();
  if (needle.length >= 2) {
    for (const row of index.pool) {
      if (String(row.name ?? '').toLowerCase().includes(needle)) add(row);
    }
  }

  return [...found.values()].slice(0, MAX_NEAR_MISSES);
}

/** 按料号 / 名称+封装+型号 合并同名行 */
function groupRows(rows) {
  const index = headerIndex(rows[0]);
  if (
    index.name === undefined &&
    index.value === undefined &&
    index.lcsc === undefined &&
    index.model === undefined
  ) {
    throw ERROR.validation('BOM 缺少「名称」或「立创料号」列，无法匹配');
  }

  const groups = new Map();
  let line = 1;
  for (let i = 1; i < rows.length; i += 1) {
    line = i + 1;
    const cells = rows[i];
    // Comment 为空时退用 Value，避免只有 Value 列的 BOM 整列丢失
    const comment = cell(cells, index, 'name');
    const valueText = cell(cells, index, 'value');
    const name = comment || valueText;
    const lcscCode = cell(cells, index, 'lcsc').toUpperCase().match(/C\d{4,10}/)?.[0] ?? '';
    const model = cell(cells, index, 'model');
    if (!name && !lcscCode && !model) continue;

    const designator = cell(cells, index, 'designator');
    const explicit = parseQuantity(cell(cells, index, 'quantity'));
    const perLine = explicit ?? (designator ? countDesignators(designator) : 1);
    const pkg = cell(cells, index, 'package');

    const key = lcscCode
      ? `lcsc:${lcscCode}`
      : `n:${name.toLowerCase()}|p:${pkg.toLowerCase()}|m:${model.toLowerCase()}`;

    const existing = groups.get(key);
    if (existing) {
      existing.perSet += perLine;
      if (designator) existing.designators.push(designator);
      if (!existing.package) existing.package = pkg;
      if (!existing.voltage) existing.voltage = cell(cells, index, 'voltage');
      if (!existing.model) existing.model = model;
      if (!existing.valueText) existing.valueText = valueText;
      if (!existing.valueKeys?.length) existing.valueKeys = valueKeysOf(name, existing.package);
      continue;
    }

    groups.set(key, {
      key,
      line,
      name,
      valueText,
      lcscCode: lcscCode || '',
      model,
      package: pkg,
      voltage: cell(cells, index, 'voltage'),
      manufacturer: cell(cells, index, 'manufacturer'),
      spec: cell(cells, index, 'spec'),
      stock: cell(cells, index, 'stock'),
      perSet: perLine,
      designators: designator ? [designator] : [],
      valueKeys: valueKeysOf(name, pkg),
    });
  }

  if (groups.size === 0) throw ERROR.validation('BOM 中没有可识别的元件行');
  return [...groups.values()];
}

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** 分层的匹配键：料号 > 厂家料号 > 值+封装族 > 名称；人工对应按此顺序查 */
function matchKeysOf(group) {
  const keys = [];
  if (group.lcscCode) keys.push(`lcsc:${String(group.lcscCode).toUpperCase()}`);
  if (group.model) keys.push(`mpn:${normalizeText(group.model)}`);
  if (group.valueKeys?.length) keys.push(`val:${group.valueKeys[0]}`);
  if (group.name) keys.push(`name:${normalizeText(group.name)}`);
  return keys.length > 0 ? keys : [`key:${group.key}`];
}

/** 把 match_key 还原成通道名（lcsc / mpn / val / name / key） */
export function kindOfKey(matchKey) {
  const colon = String(matchKey ?? '').indexOf(':');
  return colon > 0 ? String(matchKey).slice(0, colon) : 'manual';
}

function normalizeOverrides(raw) {
  const map = new Map();
  if (!raw) return map;

  const list = Array.isArray(raw)
    ? raw
    : Object.entries(raw).map(([key, value]) => ({ key, ...(value ?? {}) }));

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const key = entry.key ?? entry.matchKey;
    if (!key) continue;

    const hasItemId = Object.prototype.hasOwnProperty.call(entry, 'itemId');
    let itemId;
    if (!hasItemId) itemId = undefined;
    else if (entry.itemId === null || entry.itemId === '') itemId = null;
    else {
      const parsed = Number(entry.itemId);
      itemId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }

    map.set(String(key), { itemId, skipParams: entry.skipParams === true });
  }
  return map;
}

/** 取料清单：按位置分组，方便一次走完所有柜子 */
function buildPickup(report) {
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

  return [...pickupMap.entries()]
    .map(([location, items]) => ({
      location,
      items: items.sort((a, b) => String(a.cell ?? '').localeCompare(String(b.cell ?? ''))),
    }))
    .sort((a, b) => a.location.localeCompare(b.location));
}

/**
 * 匹配阶段：groups 已经归一化（来自文件解析或前端回传）。
 * 优先级：本次人工指定 > 已记住的人工对应 > 自动匹配链。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof groupRows>} groups
 * @param {{ sets?: unknown, options?: unknown, overrides?: unknown, rowCount?: number }} input
 */
export function matchGroups(db, groups, input = {}) {
  const options = resolveOptions(input.options);
  const rawSets = input.sets;
  const sets =
    rawSets == null || rawSets === ''
      ? null
      : Math.max(1, Math.min(10000, Number.parseInt(rawSets, 10) || 1));

  const index = buildItemIndex(db, options);
  const locations = buildLocationMaps(db);
  const aliases = loadAliasMap(db);
  const overrides = normalizeOverrides(input.overrides);

  const report = [];
  let maxSets = Number.POSITIVE_INFINITY;
  let maxSetsLimited = false;

  for (const group of groups) {
    const keys = matchKeysOf(group);
    const perSet = group.perSet;
    const demand = sets == null ? perSet : perSet * sets;

    let item = null;
    let by = null;
    let aliasId = null;
    let skipParams = false;
    let forcedMissing = false;
    let ambiguous = null;
    let candidateRows = null;

    // 0 档：本次会话里人工指定
    let override;
    for (const key of keys) {
      if (overrides.has(key)) {
        override = overrides.get(key);
        break;
      }
    }

    // 1 档：已记住的人工对应
    let alias = null;
    if (!override) {
      for (const key of keys) {
        const hit = aliases.get(key);
        if (hit) {
          alias = hit;
          break;
        }
      }
    }

    if (override && override.itemId !== undefined) {
      if (override.itemId === null) {
        forcedMissing = true;
      } else {
        const found = index.byId.get(Number(override.itemId)) ?? null;
        if (found) {
          item = found;
          by = 'manual';
          skipParams = override.skipParams;
        }
      }
    } else if (alias) {
      const found = index.byId.get(Number(alias.item_id)) ?? null;
      if (found) {
        item = found;
        by = 'alias';
        aliasId = Number(alias.id);
        skipParams = Number(alias.skip_params) === 1;
      }
    }

    // 2 档：自动匹配
    if (!item && !forcedMissing) {
      const matched = matchItem(index, group, options);
      item = matched.item;
      by = matched.by;
      ambiguous = matched.ambiguous ?? null;
      candidateRows = matched.candidates ?? null;
    }

    const mismatches =
      item && !skipParams && !options.acceptParamMismatch
        ? compareParams(group, item, options)
        : [];

    let status = 'matched';
    if (!item) status = ambiguous ? 'ambiguous' : 'missing';
    else if (mismatches.length > 0) status = 'partial';

    const stock = item ? item.available : null;
    const shortage = item ? Math.max(0, demand - stock) : demand;
    const setsPossible = item && perSet > 0 ? Math.floor(item.available / perSet) : null;

    if (setsPossible != null) {
      if (setsPossible < maxSets) maxSets = setsPossible;
      if (setsPossible < 9999) maxSetsLimited = true;
    }

    const candidates = (
      candidateRows ?? (status === 'missing' ? nearMissesOf(index, group) : [])
    )
      .slice(0, MAX_CANDIDATES)
      .map((row) => candidateOf(row, locations));

    report.push({
      key: group.key,
      matchKey: keys[0],
      matchKeys: keys,
      line: group.line,
      name: group.name || item?.name || '',
      value: group.valueText || null,
      lcscCode: group.lcscCode || item?.lcsc_code || null,
      model: group.model || item?.model || null,
      package: group.package || item?.package || null,
      voltage: group.voltage || item?.voltage || null,
      manufacturer: group.manufacturer || null,
      bomStock: group.stock || null,
      perSet,
      demand,
      stock,
      shortage,
      setsPossible,
      status,
      mismatches,
      matchedBy: by,
      ambiguous,
      candidates,
      aliasId,
      skipParams,
      archived: item?.archived ?? false,
      itemId: item?.id ?? null,
      itemName: item?.name ?? null,
      itemPackage: item?.package ?? null,
      itemVoltage: item?.voltage ?? null,
      unit: item?.unit ?? '个',
      location: locations.pathOf(item?.location_id),
      cell: toCellLabel(item?.cell_row, item?.cell_col),
      designators: group.designators,
    });
  }

  const shortages = report.filter((row) => row.shortage > 0);
  const summary = {
    rows: input.rowCount ?? null,
    groups: report.length,
    matched: report.filter((row) => row.status === 'matched').length,
    partial: report.filter((row) => row.status === 'partial').length,
    missing: report.filter((row) => row.status === 'missing').length,
    ambiguous: report.filter((row) => row.status === 'ambiguous').length,
    manual: report.filter((row) => row.matchedBy === 'manual' || row.matchedBy === 'alias').length,
    shortageGroups: shortages.length,
    sets,
    maxSets:
      maxSets === Number.POSITIVE_INFINITY ? null : maxSetsLimited ? maxSets : Math.min(maxSets, 9999),
    options,
  };

  return { summary, groups: report, pickup: buildPickup(report), options };
}

/**
 * 生成 BOM 匹配报告。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ buffer?: Buffer, text?: string, filename?: string, sets?: unknown, options?: unknown, overrides?: unknown }} input
 */
export function matchBom(db, input = {}) {
  const rows = readBomRows(input);
  if (rows.length > MAX_ROWS) {
    throw ERROR.payloadTooLarge(`BOM 行数超过 ${MAX_ROWS}，请拆分后再导入`);
  }

  const groups = groupRows(rows);
  return matchGroups(db, groups, { ...input, rowCount: rows.length - 1 });
}

/**
 * 用回传的分组 + 人工覆盖重新计算（不重新解析文件）。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {unknown} groups
 * @param {{ sets?: unknown, options?: unknown, overrides?: unknown }} input
 */
export function rematchGroups(db, groups, input = {}) {
  if (!Array.isArray(groups)) throw ERROR.validation('缺少 BOM 分组数据');
  if (groups.length === 0) throw ERROR.validation('BOM 分组为空');
  if (groups.length > MAX_ROWS) {
    throw ERROR.payloadTooLarge(`BOM 分组超过 ${MAX_ROWS} 组，请拆分后再导入`);
  }

  const normalized = groups.map((group, index) => {
    if (!group || typeof group !== 'object') {
      throw ERROR.validation(`第 ${index + 1} 个分组格式不正确`);
    }
    const perSet = Number(group.perSet);
    if (!Number.isFinite(perSet) || perSet <= 0) {
      throw ERROR.validation(`第 ${index + 1} 个分组缺少有效的单板用量`);
    }

    const name = String(group.name ?? '').slice(0, 200);
    const pkg = String(group.package ?? '').slice(0, 200);
    return {
      key: String(group.key ?? `row:${index + 1}`).slice(0, 400),
      line: Number(group.line) || index + 2,
      name,
      // 回传分组时 Value 列可能被前端原样带回，保留以便覆盖重算时仍能按料号匹配
      valueText: String(group.value ?? group.valueText ?? '').slice(0, 200),
      lcscCode: String(group.lcscCode ?? '').slice(0, 40),
      model: String(group.model ?? '').slice(0, 200),
      package: pkg,
      voltage: String(group.voltage ?? '').slice(0, 60),
      manufacturer: String(group.manufacturer ?? '').slice(0, 120),
      spec: '',
      stock: '',
      perSet,
      designators: Array.isArray(group.designators)
        ? group.designators.slice(0, 20).map((value) => String(value).slice(0, 300))
        : [],
      valueKeys: valueKeysOf(name, pkg),
    };
  });

  return matchGroups(db, normalized, input);
}

// ---------------------------------------------------------------------------
// EDA 插件批量查料（只读）
// 复用上面的封装族归一与电气值归一，但一次请求只建一次索引。
// ---------------------------------------------------------------------------

const DEFAULT_LOOKUP_LIMIT = 5;

/** 各通道的可信度，仅用于 hits 排序与插件展示 */
const MATCH_SCORES = {
  lcsc: 1,
  model: 0.9,
  'value+package': 0.8,
  value: 0.6,
};

/** 把 EDA 传来的一条器件归一成与 BOM 分组同样的形状 */
function partGroupOf(part) {
  const value = String(part?.value ?? '').slice(0, 200).trim();
  const pkg = String(part?.package ?? '').slice(0, 200).trim();
  const mpn = String(part?.mpn ?? '').slice(0, 200).trim();
  const lcsc = String(part?.lcsc ?? '')
    .toUpperCase()
    .match(/C\d{4,10}/)?.[0] ?? '';

  return {
    name: value,
    lcscCode: lcsc,
    model: mpn,
    package: pkg,
    valueKeys: valueKeysOf(value, pkg),
    valueSuffixes: valueSuffixesOf(value, true),
  };
}

/** 电气值后缀 → 物料（不含封装族），用于「只知道值」时的兜底匹配 */
function buildValueSuffixIndex(pool) {
  const map = new Map();
  for (const row of pool) {
    for (const suffix of valueSuffixesOf(`${row.name ?? ''} ${row.model ?? ''}`, true)) {
      const list = map.get(suffix) ?? [];
      list.push(row);
      map.set(suffix, list);
    }
  }
  return map;
}

/**
 * 匹配链：料号 → 厂家型号 → 值+封装族 → 值。
 * 唯一命中直接返回；多个命中返回整组候选交给插件让用户挑。
 */
function matchPart(index, suffixIndex, group, options) {
  let fallback = null;

  const settle = (by, list) => {
    if (list.length === 1) return { rows: list, match: by };
    if (!fallback) fallback = { rows: list, match: by };
    return null;
  };

  const byKey = (map, key) => {
    const list = map.get(String(key).trim().toLowerCase());
    return list && list.length > 0 ? list : null;
  };

  if (group.lcscCode) {
    const list = byKey(index.byLcsc, group.lcscCode);
    const settled = list && settle('lcsc', list);
    if (settled) return settled;
  }

  if (options.useManufacturerPart && group.model) {
    const list = byKey(index.byModel, group.model);
    const settled = list && settle('model', list);
    if (settled) return settled;
  }

  // 型号宽松匹配：mpn 写短型号 W25Q128JV、库里是 W25Q128JVSIQ 时靠它兜底
  if (options.useManufacturerPart) {
    const looseRows = prefixModelRows(index, group.model || group.name);
    if (looseRows && looseRows.length > 0) {
      const settled = settle('model', looseRows);
      if (settled) return settled;
    }
  }

  if (options.valueMatch && group.valueKeys.length > 0) {
    const rows = new Map();
    for (const key of group.valueKeys) {
      for (const row of index.byValue.get(key) ?? []) rows.set(Number(row.id), row);
    }
    if (rows.size > 0) {
      const settled = settle('value+package', [...rows.values()]);
      if (settled) return settled;
    }
  }

  if (options.valueMatch) {
    // 名称精确匹配优先（IC 这类 value 本身就是型号名），再退回电气值归一
    if (group.name) {
      const list = byKey(index.byName, group.name);
      const settled = list && settle('value', list);
      if (settled) return settled;
    }

    if (group.valueSuffixes.length > 0) {
      const rows = new Map();
      for (const suffix of group.valueSuffixes) {
        for (const row of suffixIndex.get(suffix) ?? []) rows.set(Number(row.id), row);
      }
      if (rows.size > 0) {
        const settled = settle('value', [...rows.values()]);
        if (settled) return settled;
      }
    }
  }

  return fallback ?? { rows: [], match: null };
}

function lookupHitOf(row, locations, match) {
  return {
    id: Number(row.id),
    name: row.name,
    lcscCode: row.lcsc_code ?? null,
    model: row.model ?? null,
    package: row.package ?? null,
    quantity: Number(row.quantity),
    available: row.available,
    locationPath: locations.pathOf(row.location_id),
    cellRow: row.cell_row == null ? null : Number(row.cell_row),
    cellCol: row.cell_col == null ? null : Number(row.cell_col),
    match,
    score: MATCH_SCORES[match] ?? 0,
  };
}

/**
 * EDA 插件批量查料：items 每条形如 { ref, lcsc, mpn, value, package }。
 * 返回 [{ ref, hits }]，ref 原样回传；hits 为空表示未命中，多于 1 条表示多结果。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {unknown[]} parts
 * @param {{ options?: unknown, limit?: unknown }} [input]
 */
export function lookupParts(db, parts, input = {}) {
  if (!Array.isArray(parts)) throw ERROR.validation('items 必须是数组');

  const options = resolveOptions(input.options);
  const rawLimit = Number(input.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(MAX_CANDIDATES, Math.floor(rawLimit))
    : DEFAULT_LOOKUP_LIMIT;

  const index = buildItemIndex(db, options);
  const locations = buildLocationMaps(db);
  const suffixIndex = buildValueSuffixIndex(index.pool);

  return parts.map((part) => {
    const group = partGroupOf(part);
    const found = matchPart(index, suffixIndex, group, options);

    const hits = found.rows
      .slice()
      .sort(
        (a, b) => Number(b.available) - Number(a.available) || Number(a.id) - Number(b.id),
      )
      .slice(0, limit)
      .map((row) => lookupHitOf(row, locations, found.match));

    return {
      ref: part?.ref ?? null,
      hits: found.match ? hits : [],
    };
  });
}
