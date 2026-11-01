import { AppError, ERROR } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';

/** JLCPCB 元件库接口（与立创商城共用 C 料号），无需鉴权 */
const JLCPCB_ENDPOINT =
  'https://jlcpcb.com/api/overseas-pcb-order/v1/shoppingCart/smtGood/selectSmtComponentList';

const CODE_RE = /C\d{4,10}/;

/**
 * 归一化料号：接受 C2286 / c2286 / 「C2286」/ 含 C2286 的商品链接。
 */
export function normalizeLcscCode(value) {
  if (value == null) throw ERROR.validation('请输入立创料号');
  const text = String(value).trim().toUpperCase();
  if (text === '') throw ERROR.validation('请输入立创料号');
  const direct = text.match(/^C\d{4,10}$/);
  if (direct) return direct[0];
  const embedded = text.match(CODE_RE);
  if (embedded) return embedded[0];
  throw ERROR.validation('立创料号格式应为 C 加数字，例如 C2286');
}

function firstPrice(prices) {
  if (!Array.isArray(prices) || prices.length === 0) return null;
  const value = Number(prices[0].productPrice);
  return Number.isFinite(value) ? value : null;
}

/** JLCPCB 商品字段 → PartBin 统一字段 */
function mapJlcpcbPart(row, code) {
  return {
    code,
    name: row.erpComponentName || row.componentName || row.componentModelEn || code,
    model: row.componentModelEn || null,
    manufacturer: row.componentBrandEn || null,
    package: row.componentSpecificationEn || null,
    description: row.describe || null,
    category: row.secondSortName || row.firstSortName || null,
    stock: row.stockCount == null ? null : Number(row.stockCount),
    priceUsd: firstPrice(row.componentPrices),
    datasheetUrl: row.dataManualUrl || null,
    imageUrl: row.minImage || row.componentImageUrl || null,
    sourceUrl: row.lcscGoodsUrl || null,
    source: 'jlcpcb',
  };
}

function mapCustomPart(row, code) {
  return {
    code,
    name: row.name || row.title || code,
    model: row.model || row.partNumber || null,
    manufacturer: row.manufacturer || row.brand || null,
    package: row.package || null,
    description: row.description || row.spec || null,
    category: row.category || null,
    stock: row.stock == null ? null : Number(row.stock),
    priceUsd: row.price == null ? null : Number(row.price),
    datasheetUrl: row.datasheetUrl || null,
    imageUrl: row.imageUrl || null,
    sourceUrl: row.sourceUrl || null,
    source: row.source || 'custom',
  };
}

async function fetchJson(fetchImpl, url, { method = 'GET', body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`上游返回 HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 默认数据源：JLCPCB 元件搜索接口 */
async function fetchFromJlcpcb(code, { fetchImpl, timeoutMs }) {
  const json = await fetchJson(fetchImpl, JLCPCB_ENDPOINT, {
    method: 'POST',
    body: { currentPage: 1, pageSize: 20, keyword: code },
    timeoutMs,
  });

  const list = json?.data?.componentPageInfo?.list;
  if (!Array.isArray(list)) throw new Error('上游返回格式异常');

  const hit = list.find((row) => String(row.componentCode ?? '').toUpperCase() === code);
  if (!hit) throw ERROR.notFound(`立创商城没有找到料号 ${code}`);
  return mapJlcpcbPart(hit, code);
}

/** 可选数据源：LCSC_API_BASE 指向的自建代理，POST { code } 返回商品 JSON */
async function fetchFromCustomBase(base, code, { fetchImpl, timeoutMs }) {
  const json = await fetchJson(fetchImpl, base, {
    method: 'POST',
    body: { code },
    timeoutMs,
  });
  if (json && json.ok === false) {
    throw ERROR.upstream(json.message || '上游代理返回失败', { code });
  }
  const row = json?.part ?? json?.data ?? json?.result ?? null;
  if (!row || typeof row !== 'object') throw new Error('上游返回格式异常');
  return mapCustomPart(row, code);
}

function readCache(db, code) {
  const row = db.prepare('SELECT * FROM lcsc_cache WHERE code = ?').get(code);
  if (!row) return null;
  if (row.expires_at <= nowIso()) return null;
  try {
    return { part: JSON.parse(row.payload), source: row.source };
  } catch {
    return null;
  }
}

function writeCache(db, code, part, { source, cacheDays }) {
  const fetchedAt = nowIso();
  const expiresAt = new Date(Date.now() + cacheDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO lcsc_cache (code, payload, source, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       payload = excluded.payload,
       source = excluded.source,
       fetched_at = excluded.fetched_at,
       expires_at = excluded.expires_at`,
  ).run(code, JSON.stringify(part), source ?? null, fetchedAt, expiresAt);
}

/**
 * 查询立创料号信息：优先读缓存，未命中再请求上游。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} rawCode
 * @param {{
 *   fetchImpl?: typeof fetch, apiBase?: string, timeoutMs?: number,
 *   cacheDays?: number, refresh?: boolean
 * }} [options]
 */
export async function lookupLcsc(db, rawCode, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    apiBase = '',
    timeoutMs = 8000,
    cacheDays = 7,
    refresh = false,
  } = options;

  const code = normalizeLcscCode(rawCode);

  if (!refresh) {
    const cached = readCache(db, code);
    if (cached) return { part: cached.part, cached: true, source: cached.source };
  }

  let part;
  try {
    part = apiBase
      ? await fetchFromCustomBase(apiBase, code, { fetchImpl, timeoutMs })
      : await fetchFromJlcpcb(code, { fetchImpl, timeoutMs });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw ERROR.upstream('无法连接立创商城，请稍后重试或手动填写元件信息', {
      code,
      reason: error?.name === 'AbortError' ? 'timeout' : 'network',
    });
  }

  writeCache(db, code, part, { source: part.source, cacheDays });
  return { part, cached: false, source: part.source };
}

/** 把匹配结果转成物料字段（只补空字段，不覆盖已有内容） */
export function lcscToItemFields(part, current = {}) {
  const pick = (existing, incoming) => {
    const value = existing == null ? '' : String(existing).trim();
    return value === '' ? (incoming ?? null) : existing;
  };

  return {
    model: pick(current.model, part.model),
    manufacturer: pick(current.manufacturer, part.manufacturer),
    package: pick(current.package, part.package),
    spec: pick(current.spec, part.description ? part.description.slice(0, 2000) : null),
  };
}
