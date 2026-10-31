import { ERROR } from '../lib/errors.js';
import { assertNoCycle, buildPathMap, buildTree } from '../lib/tree.js';
import { nowIso } from '../lib/time.js';
import { optionalId, optionalInt, optionalString, requireString } from '../lib/validate.js';

const NAME = { min: 1, max: 60 };
const CODE = { max: 40 };
const NOTE = { max: 500 };
const GRID_LIMIT = 52;

function allRows(db) {
  return db.prepare('SELECT * FROM location').all();
}

function toNode(row, paths, children = []) {
  return {
    id: Number(row.id),
    name: row.name,
    parentId: row.parent_id == null ? null : Number(row.parent_id),
    path: paths.get(Number(row.id)) ?? row.name,
    code: row.code ?? null,
    note: row.note ?? null,
    sortOrder: Number(row.sort_order),
    gridRows: row.grid_rows == null ? null : Number(row.grid_rows),
    gridCols: row.grid_cols == null ? null : Number(row.grid_cols),
    isGrid: row.grid_rows != null && row.grid_cols != null,
    children,
  };
}

/**
 * 归一化网格尺寸：两个都为 null 表示普通位置/大盒；否则必须是 1–52 的整数对。
 * @returns {{ gridRows: number|null, gridCols: number|null }}
 */
function normalizeGrid(input, current = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  let gridRows = has('gridRows')
    ? optionalInt(input.gridRows, '网格行数', { min: 1, max: GRID_LIMIT })
    : current.gridRows ?? null;
  let gridCols = has('gridCols')
    ? optionalInt(input.gridCols, '网格列数', { min: 1, max: GRID_LIMIT })
    : current.gridCols ?? null;

  if (gridRows == null && gridCols == null) return { gridRows: null, gridCols: null };
  if (gridRows == null || gridCols == null) {
    throw ERROR.validation('分类盒需要同时设置网格行数与列数');
  }
  return { gridRows, gridCols };
}

/** 网格缩小或取消时，确保已有格位仍然合法 */
function ensureCellsFit(db, id, gridRows, gridCols) {
  if (gridRows == null || gridCols == null) {
    const used = Number(
      db
        .prepare('SELECT COUNT(*) AS c FROM item WHERE location_id = ? AND cell_row IS NOT NULL')
        .get(id).c,
    );
    if (used > 0) {
      throw ERROR.conflict('该位置已有物料格位，若要改为大盒请先清空格位');
    }
    return;
  }

  const outside = db
    .prepare(
      `SELECT COUNT(*) AS c FROM item
       WHERE location_id = ? AND cell_row IS NOT NULL
         AND (cell_row > ? OR cell_col > ?)`,
    )
    .get(id, gridRows, gridCols).c;
  if (Number(outside) > 0) {
    throw ERROR.conflict(`新网格容纳不下已有格位，请先调整 ${outside} 个物料的位置`);
  }
}

/** 位置树（柜/层/盒，含 path） */
export function listLocations(db) {
  const rows = allRows(db);
  const paths = buildPathMap(rows);
  const tree = buildTree(rows);
  const map = (node) => toNode(node, paths, node.children.map(map));
  return tree.map(map);
}

export function getLocation(db, id) {
  const row = db.prepare('SELECT * FROM location WHERE id = ?').get(id);
  if (!row) throw ERROR.notFound('位置不存在');
  return toNode(row, buildPathMap(allRows(db)));
}

function ensureParent(db, parentId) {
  if (parentId == null) return;
  const parent = db.prepare('SELECT id FROM location WHERE id = ?').get(parentId);
  if (!parent) throw ERROR.validation('父位置不存在');
}

export function createLocation(db, input = {}) {
  const name = requireString(input.name, '位置名称', NAME);
  const parentId = optionalId(input.parentId, '父位置');
  const code = optionalString(input.code, '位置编号', CODE);
  const note = optionalString(input.note, '备注', NOTE);
  const sortOrder = optionalInt(input.sortOrder, '排序', { min: -10000, max: 10000 }) ?? 0;
  const { gridRows, gridCols } = normalizeGrid(input);
  ensureParent(db, parentId);

  const now = nowIso();
  let inserted;
  try {
    inserted = db
      .prepare(
        `INSERT INTO location (parent_id, name, code, note, sort_order, grid_rows, grid_cols, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(parentId, name, code, note, sortOrder, gridRows, gridCols, now, now);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw ERROR.duplicate('同级下已有同名位置');
    throw error;
  }

  return getLocation(db, Number(inserted.lastInsertRowid));
}

export function updateLocation(db, id, input = {}) {
  const current = db.prepare('SELECT * FROM location WHERE id = ?').get(id);
  if (!current) throw ERROR.notFound('位置不存在');

  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const name = has('name') ? requireString(input.name, '位置名称', NAME) : current.name;
  const parentId = has('parentId')
    ? optionalId(input.parentId, '父位置')
    : current.parent_id == null
      ? null
      : Number(current.parent_id);
  const code = has('code') ? optionalString(input.code, '位置编号', CODE) : (current.code ?? null);
  const note = has('note') ? optionalString(input.note, '备注', NOTE) : (current.note ?? null);
  const sortOrder = has('sortOrder')
    ? (optionalInt(input.sortOrder, '排序', { min: -10000, max: 10000 }) ?? 0)
    : Number(current.sort_order);
  const { gridRows, gridCols } = normalizeGrid(input, {
    gridRows: current.grid_rows == null ? null : Number(current.grid_rows),
    gridCols: current.grid_cols == null ? null : Number(current.grid_cols),
  });

  if (parentId != null) {
    ensureParent(db, parentId);
    assertNoCycle(allRows(db), id, parentId);
  }
  ensureCellsFit(db, id, gridRows, gridCols);

  try {
    db.prepare(
      `UPDATE location SET parent_id = ?, name = ?, code = ?, note = ?, sort_order = ?,
         grid_rows = ?, grid_cols = ?, updated_at = ? WHERE id = ?`,
    ).run(parentId, name, code, note, sortOrder, gridRows, gridCols, nowIso(), id);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw ERROR.duplicate('同级下已有同名位置');
    throw error;
  }

  return getLocation(db, id);
}

/** 删除位置：引用它的物料与子位置会被置空 */
export function removeLocation(db, id) {
  const row = db.prepare('SELECT id FROM location WHERE id = ?').get(id);
  if (!row) throw ERROR.notFound('位置不存在');

  const detachedItems = Number(
    db.prepare('SELECT COUNT(*) AS c FROM item WHERE location_id = ?').get(id).c,
  );
  const orphanedChildren = Number(
    db.prepare('SELECT COUNT(*) AS c FROM location WHERE parent_id = ?').get(id).c,
  );

  db.prepare('DELETE FROM location WHERE id = ?').run(id);
  return { detachedItems, orphanedChildren };
}
