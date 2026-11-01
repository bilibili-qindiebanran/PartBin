import { ERROR } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';

/**
 * BOM 人工对应关系（bom_alias）读写。
 * 用户在 BOM 页面确认过的「BOM 行 → 物料」会存成一条记录，
 * 下次上传同一份 BOM 时按 match_key 直接命中，不再依赖名称写法。
 */

const MAX_KEY_LENGTH = 400;

/** 读取全部对应关系到 Map，供匹配时按 match_key 查询 */
export function loadAliasMap(db) {
  const rows = db
    .prepare('SELECT id, match_key, kind, item_id, skip_params FROM bom_alias')
    .all();

  const map = new Map();
  for (const row of rows) map.set(String(row.match_key), row);
  return map;
}

/** 列表：附带物料名称/封装/库存，便于前端展示与撤销 */
export function listAliases(db) {
  return db
    .prepare(
      `SELECT a.id, a.match_key, a.kind, a.item_id, a.skip_params, a.note,
              a.created_at, a.updated_at,
              i.name AS item_name, i.package AS item_package,
              i.quantity AS item_quantity, i.is_archived AS item_archived
       FROM bom_alias a
       LEFT JOIN item i ON i.id = a.item_id
       ORDER BY a.id DESC`,
    )
    .all()
    .map((row) => ({
      id: Number(row.id),
      matchKey: row.match_key,
      kind: row.kind,
      itemId: Number(row.item_id),
      skipParams: Number(row.skip_params) === 1,
      note: row.note ?? null,
      itemName: row.item_name ?? null,
      itemPackage: row.item_package ?? null,
      itemQuantity: row.item_quantity == null ? null : Number(row.item_quantity),
      itemArchived: Number(row.item_archived) === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
}

function normalizeKey(matchKey) {
  const key = String(matchKey ?? '').trim();
  if (!key) throw ERROR.validation('缺少 BOM 匹配键');
  if (key.length > MAX_KEY_LENGTH) throw ERROR.validation('BOM 匹配键过长');
  return key;
}

function assertItemExists(db, itemId) {
  const row = db.prepare('SELECT id FROM item WHERE id = ?').get(Number(itemId));
  if (!row) throw ERROR.validation('指定的物料不存在');
  return Number(row.id);
}

/**
 * 新增或更新一条对应关系。
 * @returns {{ id: number, matchKey: string, itemId: number, skipParams: boolean }}
 */
export function upsertAlias(db, { matchKey, kind, itemId, skipParams = false, note = null, actorId = null }) {
  const key = normalizeKey(matchKey);
  const targetId = assertItemExists(db, itemId);
  const now = nowIso();

  const existing = db.prepare('SELECT id FROM bom_alias WHERE match_key = ?').get(key);
  if (existing) {
    db.prepare(
      `UPDATE bom_alias
       SET item_id = ?, kind = ?, skip_params = ?, note = ?, created_by = COALESCE(?, created_by), updated_at = ?
       WHERE id = ?`,
    ).run(targetId, String(kind ?? 'manual'), skipParams ? 1 : 0, note, actorId, now, Number(existing.id));
    return { id: Number(existing.id), matchKey: key, itemId: targetId, skipParams: Boolean(skipParams) };
  }

  const info = db
    .prepare(
      `INSERT INTO bom_alias (match_key, kind, item_id, skip_params, note, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(key, String(kind ?? 'manual'), targetId, skipParams ? 1 : 0, note, actorId, now, now);

  return {
    id: Number(info.lastInsertRowid),
    matchKey: key,
    itemId: targetId,
    skipParams: Boolean(skipParams),
  };
}

/** 删除一条对应关系；返回被删除的记录（用于审计） */
export function deleteAlias(db, id) {
  const row = db.prepare('SELECT id, match_key, item_id FROM bom_alias WHERE id = ?').get(Number(id));
  if (!row) throw ERROR.notFound('对应关系不存在');

  db.prepare('DELETE FROM bom_alias WHERE id = ?').run(Number(id));
  return { id: Number(row.id), matchKey: row.match_key, itemId: Number(row.item_id) };
}

/** 按 match_key 删除（前端只知道键时使用） */
export function deleteAliasByKey(db, matchKey) {
  const key = normalizeKey(matchKey);
  const row = db.prepare('SELECT id, match_key, item_id FROM bom_alias WHERE match_key = ?').get(key);
  if (!row) return null;

  db.prepare('DELETE FROM bom_alias WHERE id = ?').run(Number(row.id));
  return { id: Number(row.id), matchKey: row.match_key, itemId: Number(row.item_id) };
}
