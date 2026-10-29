import { withTransaction } from '../db/connection.js';
import { ERROR } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import {
  optionalId,
  optionalString,
  requireEnum,
  requireId,
  requireInt,
} from '../lib/validate.js';

/** 允许通过出入库接口直接写入的类型；borrow/return 由借还服务负责 */
const DIRECT_TYPES = ['in', 'out', 'adjust', 'discard', 'lost'];

function normalizeOccurredAt(value) {
  if (value == null || value === '') return nowIso();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw ERROR.validation('发生时间格式不正确');
  return date.toISOString();
}

function normalizeRange(value, endOfDay = false) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw ERROR.validation('时间范围格式不正确');
  return date.toISOString();
}

function parsePage(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function toPublicMovement(row) {
  return {
    id: Number(row.id),
    itemId: Number(row.item_id),
    itemName: row.item_name ?? null,
    type: row.type,
    quantity: Number(row.quantity),
    quantityDelta: Number(row.quantity_delta),
    balanceAfter: Number(row.balance_after),
    note: row.note ?? null,
    occurredAt: row.occurred_at,
    userName: row.username ?? null,
  };
}

/**
 * 唯一入库/出库/盘点入口。
 * 事务内更新 item.quantity 并写入 balance_after；负库存直接拒绝。
 */
export function recordMovement(db, input = {}) {
  const itemId = requireId(input.itemId, '物料');
  const type = requireEnum(input.type, '类型', DIRECT_TYPES);
  const quantity = requireInt(input.quantity, '数量', { min: 1, max: 1000000 });
  const note = optionalString(input.note, '备注', { max: 500 });
  const occurredAt = normalizeOccurredAt(input.occurredAt);

  let direction = null;
  if (type === 'adjust') {
    direction = requireEnum(input.direction, '调整方向', ['up', 'down']);
    if (!note) throw ERROR.validation('盘点调整必须填写原因');
  }

  return withTransaction(db, () => {
    const current = db
      .prepare('SELECT id, quantity, min_quantity, unit, tracking_mode FROM item WHERE id = ?')
      .get(itemId);
    if (!current) throw ERROR.notFound('物料不存在');
    if (current.tracking_mode === 'instance') {
      throw ERROR.conflict('实例制物料请通过实例操作调整数量');
    }

    const signed =
      type === 'adjust'
        ? direction === 'up'
          ? quantity
          : -quantity
        : type === 'in'
          ? quantity
          : -quantity;

    const balance = Number(current.quantity) + signed;
    if (balance < 0) {
      throw ERROR.insufficientStock(
        `库存不足：当前 ${current.quantity} ${current.unit}，本次需要 ${quantity}`,
        { current: Number(current.quantity), requested: quantity },
      );
    }

    const now = nowIso();
    db.prepare('UPDATE item SET quantity = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(
      balance,
      input.userId,
      now,
      itemId,
    );

    const inserted = db
      .prepare(
        `INSERT INTO movement (
           item_id, user_id, type, quantity, quantity_delta, balance_after, note, occurred_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(itemId, input.userId, type, quantity, signed, balance, note, occurredAt, now);

    const movement = db.prepare('SELECT * FROM movement WHERE id = ?').get(inserted.lastInsertRowid);
    const lent = Number(
      db
        .prepare(
          'SELECT COALESCE(SUM(quantity - returned_quantity), 0) AS c FROM loan WHERE item_id = ? AND returned_quantity < quantity',
        )
        .get(itemId).c,
    );
    const minQuantity = Number(current.min_quantity);

    return {
      movement: toPublicMovement(movement),
      item: {
        id: itemId,
        quantity: balance,
        available: Math.max(0, balance - lent),
        lowStock: balance === 0 || (minQuantity > 0 && balance <= minQuantity),
        unit: current.unit,
      },
    };
  });
}

/** 单个物料的流水（分页） */
export function listItemMovements(db, itemId, query = {}) {
  const item = db.prepare('SELECT id FROM item WHERE id = ?').get(itemId);
  if (!item) throw ERROR.notFound('物料不存在');

  const { page, pageSize, offset } = parsePage(query);
  const total = Number(
    db.prepare('SELECT COUNT(*) AS c FROM movement WHERE item_id = ?').get(itemId).c,
  );
  const rows = db
    .prepare(
      `SELECT m.*, u.username, i.name AS item_name
       FROM movement m
       JOIN user u ON u.id = m.user_id
       JOIN item i ON i.id = m.item_id
       WHERE m.item_id = ?
       ORDER BY m.occurred_at DESC, m.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(itemId, pageSize, offset);

  return { data: rows.map(toPublicMovement), page, pageSize, total };
}

/** 全局流水台账 */
export function listMovements(db, query = {}) {
  const where = [];
  const params = [];

  if (query.type) {
    where.push('m.type = ?');
    params.push(requireEnum(query.type, '类型', [...DIRECT_TYPES, 'borrow', 'return']));
  }
  if (query.itemId) {
    where.push('m.item_id = ?');
    params.push(optionalId(query.itemId, '物料'));
  }

  const from = normalizeRange(query.from, false);
  const to = normalizeRange(query.to, true);
  if (from) {
    where.push('m.occurred_at >= ?');
    params.push(from);
  }
  if (to) {
    where.push('m.occurred_at <= ?');
    params.push(to);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const { page, pageSize, offset } = parsePage(query);

  const total = Number(
    db
      .prepare(`SELECT COUNT(*) AS c FROM movement m ${whereSql}`)
      .get(...params).c,
  );
  const rows = db
    .prepare(
      `SELECT m.*, u.username, i.name AS item_name
       FROM movement m
       JOIN user u ON u.id = m.user_id
       JOIN item i ON i.id = m.item_id
       ${whereSql}
       ORDER BY m.occurred_at DESC, m.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset);

  return { data: rows.map(toPublicMovement), page, pageSize, total };
}
