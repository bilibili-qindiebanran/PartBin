import { withTransaction } from '../db/connection.js';
import { ERROR } from '../lib/errors.js';
import { buildPathMap } from '../lib/tree.js';
import { nowIso } from '../lib/time.js';
import { requireId } from '../lib/validate.js';

const ITEM_FIELDS = `
  i.id, i.name, i.code, i.model, i.package, i.voltage, i.spec, i.unit, i.quantity, i.min_quantity,
  i.cell_row, i.cell_col, i.is_archived,
  COALESCE((
    SELECT SUM(l.quantity - l.returned_quantity)
    FROM loan l
    WHERE l.item_id = i.id AND l.returned_quantity < l.quantity
  ), 0) AS lent_quantity
`;

function toPublicItem(row) {
  const quantity = Number(row.quantity);
  const lent = Number(row.lent_quantity ?? 0);
  const minQuantity = Number(row.min_quantity);
  return {
    id: Number(row.id),
    name: row.name,
    code: row.code ?? null,
    model: row.model ?? null,
    package: row.package ?? null,
    voltage: row.voltage ?? null,
    spec: row.spec ?? null,
    unit: row.unit,
    quantity,
    available: Math.max(0, quantity - lent),
    lentQuantity: lent,
    lowStock: quantity === 0 || (minQuantity > 0 && quantity <= minQuantity),
    cellRow: row.cell_row == null ? null : Number(row.cell_row),
    cellCol: row.cell_col == null ? null : Number(row.cell_col),
    isArchived: Number(row.is_archived) === 1,
  };
}

function loadPaths(db) {
  return buildPathMap(db.prepare('SELECT id, parent_id, name FROM location').all());
}

/**
 * 元件盒列表：分类盒（有网格）+ 直接装料的大盒/普通位置。
 * 空位置不返回，避免列表被无用节点淹没。
 */
export function listBins(db, query = {}) {
  const paths = loadPaths(db);
  const rows = db
    .prepare(
      `SELECT l.*,
         (SELECT COUNT(*) FROM item i WHERE i.location_id = l.id AND i.is_archived = 0) AS item_count,
         (SELECT COUNT(*) FROM item i
            WHERE i.location_id = l.id AND i.is_archived = 0 AND i.cell_row IS NOT NULL) AS cell_count
       FROM location l
       ORDER BY l.sort_order ASC, l.id ASC`,
    )
    .all();

  const keyword = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';

  const data = rows
    .filter((row) => Number(row.item_count) > 0 || (row.grid_rows != null && row.grid_cols != null))
    .map((row) => {
      const id = Number(row.id);
      const isGrid = row.grid_rows != null && row.grid_cols != null;
      const gridRows = isGrid ? Number(row.grid_rows) : null;
      const gridCols = isGrid ? Number(row.grid_cols) : null;
      const itemCount = Number(row.item_count);
      const cellCount = Number(row.cell_count);
      return {
        id,
        name: row.name,
        path: paths.get(id) ?? row.name,
        code: row.code ?? null,
        isGrid,
        gridRows,
        gridCols,
        itemCount,
        cellCount,
        emptyCells: isGrid ? gridRows * gridCols - cellCount : null,
        unassignedCount: isGrid ? itemCount - cellCount : itemCount,
      };
    })
    .filter((box) => {
      if (!keyword) return true;
      return box.path.toLowerCase().includes(keyword) || (box.code ?? '').toLowerCase().includes(keyword);
    });

  return data;
}

/** 单个盒子的内容：网格坐标或大盒内的元件袋清单 */
export function getBin(db, rawId) {
  const id = requireId(rawId, '位置');
  const row = db.prepare('SELECT * FROM location WHERE id = ?').get(id);
  if (!row) throw ERROR.notFound('位置不存在');

  const paths = loadPaths(db);
  const isGrid = row.grid_rows != null && row.grid_cols != null;
  const gridRows = isGrid ? Number(row.grid_rows) : null;
  const gridCols = isGrid ? Number(row.grid_cols) : null;

  const items = db
    .prepare(
      `SELECT ${ITEM_FIELDS}
       FROM item i
       WHERE i.location_id = ? AND i.is_archived = 0
       ORDER BY i.cell_row IS NULL, i.cell_row ASC, i.cell_col ASC, i.name COLLATE NOCASE ASC`,
    )
    .all(id)
    .map(toPublicItem);

  const cells = items.map((item) => ({
    row: item.cellRow,
    col: item.cellCol,
    item,
    quantity: item.quantity,
  }));

  // 子位置（柜/层/抽屉下的盒子）也一并返回，方便直接跳转
  const childRows = db
    .prepare(
      `SELECT l.*,
         (SELECT COUNT(*) FROM item i WHERE i.location_id = l.id AND i.is_archived = 0) AS item_count
       FROM location l WHERE l.parent_id = ? ORDER BY l.sort_order ASC, l.id ASC`,
    )
    .all(id);

  return {
    box: {
      id,
      name: row.name,
      path: paths.get(id) ?? row.name,
      code: row.code ?? null,
      note: row.note ?? null,
      parentId: row.parent_id == null ? null : Number(row.parent_id),
      isGrid,
      gridRows,
      gridCols,
      capacity: isGrid ? gridRows * gridCols : null,
    },
    cells: isGrid ? cells : [],
    items,
    unassigned: isGrid ? items.filter((item) => item.cellRow == null) : items,
    children: childRows.map((child) => ({
      id: Number(child.id),
      name: child.name,
      path: paths.get(Number(child.id)) ?? child.name,
      isGrid: child.grid_rows != null && child.grid_cols != null,
      itemCount: Number(child.item_count),
    })),
  };
}

/**
 * 库存「盒视图」用的平铺总览：一次返回所有盒子的缩略信息。
 * 分类盒带格位明细，大盒带混装清单（最多 12 种，其余用 kindCount 表示）。
 */
export function getBinsOverview(db) {
  const paths = loadPaths(db);
  const locations = db
    .prepare('SELECT * FROM location ORDER BY sort_order ASC, id ASC')
    .all();

  const itemRows = db
    .prepare(
      `SELECT ${ITEM_FIELDS}, i.location_id
       FROM item i
       WHERE i.is_archived = 0
       ORDER BY i.cell_row IS NULL, i.cell_row ASC, i.cell_col ASC, i.name COLLATE NOCASE ASC`,
    )
    .all();

  const byLocation = new Map();
  for (const row of itemRows) {
    if (row.location_id == null) continue;
    const key = Number(row.location_id);
    const list = byLocation.get(key) ?? [];
    list.push(toPublicItem(row));
    byLocation.set(key, list);
  }

  return locations
    .map((row) => {
      const id = Number(row.id);
      const items = byLocation.get(id) ?? [];
      const isGrid = row.grid_rows != null && row.grid_cols != null;
      const gridRows = isGrid ? Number(row.grid_rows) : null;
      const gridCols = isGrid ? Number(row.grid_cols) : null;

      return {
        id,
        name: row.name,
        path: paths.get(id) ?? row.name,
        code: row.code ?? null,
        sortOrder: Number(row.sort_order),
        isGrid,
        gridRows,
        gridCols,
        capacity: isGrid ? gridRows * gridCols : null,
        itemCount: items.length,
        kindCount: items.length,
        cells: isGrid
          ? items
              .filter((item) => item.cellRow != null)
              .map((item) => ({ row: item.cellRow, col: item.cellCol, item }))
          : [],
        items: isGrid ? [] : items.slice(0, 12),
      };
    })
    // 空的分组（柜/层）没有内容可展示，除非本身是分类盒
    .filter((box) => box.isGrid || box.itemCount > 0);
}

/**
 * 保存盒视图的拖拽顺序：ids 按展示顺序给出，依次写入 sort_order。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {unknown[]} ids
 */
export function reorderBins(db, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw ERROR.validation('缺少排序列表');
  }
  if (ids.length > 500) throw ERROR.validation('一次最多排序 500 个盒子');

  const normalized = ids.map((id) => requireId(id, '盒子'));
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) throw ERROR.validation('排序列表存在重复项');

  const existing = db.prepare('SELECT id FROM location WHERE id = ?');
  const missing = normalized.filter((id) => !existing.get(id));
  if (missing.length > 0) throw ERROR.notFound(`盒子不存在：${missing.join(', ')}`);

  return withTransaction(db, () => {
    const update = db.prepare('UPDATE location SET sort_order = ?, updated_at = ? WHERE id = ?');
    const now = nowIso();
    normalized.forEach((id, index) => update.run(index, now, id));
    return { updated: normalized.length };
  });
}

