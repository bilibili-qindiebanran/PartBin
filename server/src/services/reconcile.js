import { ERROR } from '../lib/errors.js';
import { findItemByLcscCode, getItem, updateItem } from './items.js';
import { lookupLcsc, normalizeLcscCode } from './lcsc.js';

/**
 * 快速对料：扫到一个立创料号后，确认库存里对应的究竟是哪条物料。
 * 与快速入库的区别是它不改数量，只负责“这个料号在库里是哪一条”，顺便让现场把信息修正。
 */

const MAX_CANDIDATES = 6;

/**
 * 上游料名 / 型号 → 带权重的关键词。
 * 型号最可靠；带单位的值（100nF / 50V）次之；纯数字片段权重最低。
 */
function searchTokens(part) {
  const entries = new Map();
  const add = (value, weight) => {
    const text = String(value ?? '').trim().toLowerCase().slice(0, 40);
    // 太短的词（如 "1A"）会命中一大片，直接丢弃
    if (text.length < 3) return;
    entries.set(text, Math.max(entries.get(text) ?? 0, weight));
  };

  add(part?.model, 5);

  const words = String(part?.name ?? '')
    .split(/[\s,，、/()（）【】[\]]+/)
    .filter(Boolean);
  for (const word of words) {
    const hasUnit = /(f|h|r|hz|v|a|w)$/i.test(word);
    add(word, hasUnit ? 3 : 1);
  }
  if (words.length === 1) add(words[0], 3);

  return [...entries.entries()]
    .map(([token, weight]) => ({ token, weight }))
    .slice(0, 8);
}

/** 上游封装与库内封装是否同族（0603 / SOT-23 这类） */
function samePackage(part, row) {
  const a = String(part?.package ?? '').trim().toUpperCase();
  const b = String(row.package ?? '').trim().toUpperCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * 未匹配时给出库内可能是同一个料的条目：
 * 只看还没绑定立创料号的物料，按关键词加权打分，封装相同的额外加分。
 */
function suggestCandidates(db, part, code) {
  const tokens = searchTokens(part);
  if (tokens.length === 0) return [];

  const loose = db
    .prepare(
      `SELECT id, name, model, package, quantity, unit, lcsc_code
       FROM item
       WHERE is_archived = 0 AND lcsc_code IS NULL
       ORDER BY updated_at DESC
       LIMIT 500`,
    )
    .all();

  const scored = [];
  for (const row of loose) {
    if (String(row.lcsc_code ?? '') === code) continue;
    const haystack = `${row.name ?? ''} ${row.model ?? ''}`.toLowerCase();

    let score = 0;
    for (const { token, weight } of tokens) {
      if (haystack.includes(token)) score += weight;
    }
    if (score === 0) continue;
    if (samePackage(part, row)) score += 2;

    // 只有弱命中（例如只对上了 50V）的条目不值得推荐
    if (score < 3) continue;
    scored.push({ row, score });
  }

  scored.sort((a, b) => b.score - a.score || Number(b.row.id) - Number(a.row.id));
  return scored.slice(0, MAX_CANDIDATES).map(({ row, score }) => ({
    itemId: Number(row.id),
    name: row.name,
    model: row.model ?? null,
    package: row.package ?? null,
    quantity: Number(row.quantity),
    unit: row.unit ?? '个',
    lcscCode: row.lcsc_code ?? null,
    score,
  }));
}

/**
 * 快速对料预览：料号 + 上游信息 + 库存里对应的物料（可能有/没有）。
 * 上游查不到不算失败，返回 part=null 与 warning，前端仍可手动物料匹配。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} rawCode
 * @param {Parameters<typeof lookupLcsc>[2]} [options]
 */
export async function previewReconcile(db, rawCode, options = {}) {
  const code = normalizeLcscCode(rawCode);
  const matched = findItemByLcscCode(db, code);

  let part = null;
  let warning = null;
  try {
    const result = await lookupLcsc(db, code, options);
    part = result.part;
  } catch (error) {
    const degradable = error?.code === 'UPSTREAM_UNAVAILABLE' || error?.code === 'NOT_FOUND';
    if (!degradable) throw error;
    warning = error.message;
  }

  const archived =
    matched == null
      ? db
          .prepare(
            `SELECT id, name FROM item
             WHERE lcsc_code = ? AND is_archived = 1
             ORDER BY id DESC LIMIT 1`,
          )
          .get(code)
      : null;

  return {
    code,
    matched,
    part,
    candidates: matched ? [] : suggestCandidates(db, part, code),
    archivedItem: archived
      ? { itemId: Number(archived.id), name: archived.name }
      : null,
    warning,
  };
}

/**
 * 手动匹配：把扫到的料号写到已有物料上。
 * 该物料已有别的料号时拒绝，避免静默覆盖。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ code: string, itemId: number }} input
 * @param {number} userId
 */
export function linkItemLcsc(db, input = {}, userId) {
  const code = normalizeLcscCode(input.code);
  const itemId = Number(input.itemId);
  if (!Number.isInteger(itemId) || itemId <= 0) throw ERROR.validation('请选择要匹配的物料');

  const item = getItem(db, itemId);
  if (item.isArchived) throw ERROR.conflict('该物料已归档，请先恢复后再匹配');

  const current = String(item.lcscCode ?? '').toUpperCase();
  if (current && current !== code) {
    throw ERROR.conflict(`该物料已绑定料号 ${current}，请先清除后再绑定 ${code}`);
  }

  const updated = updateItem(db, itemId, { lcscCode: code, lcscMatched: true }, userId);
  return { item: updated, linked: current !== code };
}
