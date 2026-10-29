import { nowIso } from '../lib/time.js';

/** 仪表盘统计：物料、低库存、借出、本月出入库与分类分布 */
export function getStats(db) {
  const items = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN is_archived = 0 THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN is_archived = 0 AND (quantity = 0 OR (min_quantity > 0 AND quantity <= min_quantity)) THEN 1 ELSE 0 END) AS low_stock,
         SUM(CASE WHEN is_archived = 0 AND quantity = 0 THEN 1 ELSE 0 END) AS out_of_stock
       FROM item`,
    )
    .get();

  const loans = db
    .prepare(
      `SELECT
         SUM(CASE WHEN returned_quantity < quantity THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN returned_quantity < quantity AND due_at IS NOT NULL AND due_at < ? THEN 1 ELSE 0 END) AS overdue
       FROM loan`,
    )
    .get(nowIso());

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const month = db
    .prepare(
      `SELECT
         SUM(CASE WHEN type = 'in' THEN quantity ELSE 0 END) AS in_qty,
         SUM(CASE WHEN type = 'out' THEN quantity ELSE 0 END) AS out_qty
       FROM movement
       WHERE occurred_at >= ?`,
    )
    .get(monthStart.toISOString());

  const byCategory = db
    .prepare(
      `SELECT COALESCE(c.name, '未分类') AS name, COUNT(*) AS count
       FROM item i
       LEFT JOIN category c ON c.id = i.category_id
       WHERE i.is_archived = 0
       GROUP BY i.category_id
       ORDER BY count DESC, name ASC
       LIMIT 8`,
    )
    .all();

  return {
    items: {
      total: Number(items.total ?? 0),
      active: Number(items.active ?? 0),
      lowStock: Number(items.low_stock ?? 0),
      outOfStock: Number(items.out_of_stock ?? 0),
    },
    loans: {
      open: Number(loans.open ?? 0),
      overdue: Number(loans.overdue ?? 0),
    },
    movements: {
      inThisMonth: Number(month.in_qty ?? 0),
      outThisMonth: Number(month.out_qty ?? 0),
    },
    byCategory: byCategory.map((row) => ({ name: row.name, count: Number(row.count) })),
  };
}
