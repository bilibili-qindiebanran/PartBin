import { ERROR } from '../lib/errors.js';
import { buildPathMap, buildTree, assertNoCycle } from '../lib/tree.js';
import { nowIso } from '../lib/time.js';
import { optionalId, optionalInt, requireString } from '../lib/validate.js';

const NAME = { min: 1, max: 60 };

function allRows(db) {
  return db.prepare('SELECT * FROM category').all();
}

function toNode(row, paths, children = []) {
  return {
    id: Number(row.id),
    name: row.name,
    parentId: row.parent_id == null ? null : Number(row.parent_id),
    path: paths.get(Number(row.id)) ?? row.name,
    sortOrder: Number(row.sort_order),
    children,
  };
}

/** 分类树（含 path） */
export function listCategories(db) {
  const rows = allRows(db);
  const paths = buildPathMap(rows);
  const tree = buildTree(rows);
  const map = (node) => toNode(node, paths, node.children.map(map));
  return tree.map(map);
}

/** 单个分类（含 path） */
export function getCategory(db, id) {
  const row = db.prepare('SELECT * FROM category WHERE id = ?').get(id);
  if (!row) throw ERROR.notFound('分类不存在');
  return toNode(row, buildPathMap(allRows(db)));
}

function ensureParent(db, parentId) {
  if (parentId == null) return;
  const parent = db.prepare('SELECT id FROM category WHERE id = ?').get(parentId);
  if (!parent) throw ERROR.validation('父分类不存在');
}

export function createCategory(db, input = {}) {
  const name = requireString(input.name, '分类名称', NAME);
  const parentId = optionalId(input.parentId, '父分类');
  const sortOrder = optionalInt(input.sortOrder, '排序', { min: -10000, max: 10000 }) ?? 0;
  ensureParent(db, parentId);

  const now = nowIso();
  let inserted;
  try {
    inserted = db
      .prepare(
        'INSERT INTO category (parent_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(parentId, name, sortOrder, now, now);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw ERROR.duplicate('同级下已有同名分类');
    throw error;
  }

  return getCategory(db, Number(inserted.lastInsertRowid));
}

export function updateCategory(db, id, input = {}) {
  const current = db.prepare('SELECT * FROM category WHERE id = ?').get(id);
  if (!current) throw ERROR.notFound('分类不存在');

  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const name = has('name') ? requireString(input.name, '分类名称', NAME) : current.name;
  const parentId = has('parentId')
    ? optionalId(input.parentId, '父分类')
    : current.parent_id == null
      ? null
      : Number(current.parent_id);
  const sortOrder = has('sortOrder')
    ? (optionalInt(input.sortOrder, '排序', { min: -10000, max: 10000 }) ?? 0)
    : Number(current.sort_order);

  if (parentId != null) {
    ensureParent(db, parentId);
    assertNoCycle(allRows(db), id, parentId);
  }

  try {
    db.prepare('UPDATE category SET parent_id = ?, name = ?, sort_order = ?, updated_at = ? WHERE id = ?').run(
      parentId,
      name,
      sortOrder,
      nowIso(),
      id,
    );
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw ERROR.duplicate('同级下已有同名分类');
    throw error;
  }

  return getCategory(db, id);
}

/** 删除分类：引用它的物料与子分类会被置空（成为根） */
export function removeCategory(db, id) {
  const row = db.prepare('SELECT id FROM category WHERE id = ?').get(id);
  if (!row) throw ERROR.notFound('分类不存在');

  const detachedItems = Number(
    db.prepare('SELECT COUNT(*) AS c FROM item WHERE category_id = ?').get(id).c,
  );
  const orphanedChildren = Number(
    db.prepare('SELECT COUNT(*) AS c FROM category WHERE parent_id = ?').get(id).c,
  );

  db.prepare('DELETE FROM category WHERE id = ?').run(id);
  return { detachedItems, orphanedChildren };
}
