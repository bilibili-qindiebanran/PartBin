import { withTransaction } from '../db/connection.js';
import { ERROR } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import {
  optionalId,
  optionalString,
  requireEnum,
  requireId,
  requireInt,
  requireString,
} from '../lib/validate.js';
import { setInstanceStatusForLoan } from './instances.js';

const LOAN_SELECT = `
  SELECT l.*, i.name AS item_name, i.unit, u.username AS created_by_name, ii.asset_no AS instance_asset_no
  FROM loan l
  JOIN item i ON i.id = l.item_id
  JOIN user u ON u.id = l.created_by
  LEFT JOIN item_instance ii ON ii.id = l.instance_id
`;

function parsePage(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function normalizeDate(value, endOfDay = false) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw ERROR.validation('日期格式不正确');
  return date.toISOString();
}

function toPublicLoan(row) {
  const quantity = Number(row.quantity);
  const returnedQuantity = Number(row.returned_quantity);
  const remaining = quantity - returnedQuantity;
  const overdue =
    remaining > 0 && row.due_at != null && row.due_at < nowIso();

  return {
    id: Number(row.id),
    itemId: Number(row.item_id),
    itemName: row.item_name,
    unit: row.unit,
    instanceId: row.instance_id == null ? null : Number(row.instance_id),
    instanceAssetNo: row.instance_asset_no ?? null,
    quantity,
    returnedQuantity,
    remaining,
    borrower: row.borrower,
    contact: row.contact ?? null,
    note: row.note ?? null,
    borrowedAt: row.borrowed_at,
    dueAt: row.due_at ?? null,
    returnedAt: row.returned_at ?? null,
    overdue,
    createdByName: row.created_by_name,
  };
}

function getLoanRow(db, id) {
  return db.prepare(`${LOAN_SELECT} WHERE l.id = ?`).get(id);
}

function getLoan(db, id) {
  const row = getLoanRow(db, id);
  if (!row) throw ERROR.notFound('借出记录不存在');
  return toPublicLoan(row);
}

/** 某物料的未归还借出总量 */
export function outstandingQuantity(db, itemId) {
  return Number(
    db
      .prepare(
        'SELECT COALESCE(SUM(quantity - returned_quantity), 0) AS c FROM loan WHERE item_id = ? AND returned_quantity < quantity',
      )
      .get(itemId).c,
  );
}

export function listLoans(db, query = {}) {
  const where = [];
  const params = [];

  if (query.status) {
    const status = requireEnum(query.status, '状态', ['open', 'closed', 'overdue']);
    if (status === 'open') where.push('l.returned_quantity < l.quantity');
    if (status === 'closed') where.push('l.returned_quantity >= l.quantity');
    if (status === 'overdue') {
      where.push(
        'l.returned_quantity < l.quantity AND l.due_at IS NOT NULL AND l.due_at < ?',
      );
      params.push(nowIso());
    }
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const { page, pageSize, offset } = parsePage(query);

  const total = Number(
    db
      .prepare(`SELECT COUNT(*) AS c FROM loan l ${whereSql}`)
      .get(...params).c,
  );
  const rows = db
    .prepare(`${LOAN_SELECT} ${whereSql} ORDER BY l.borrowed_at DESC, l.id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset);

  return { data: rows.map(toPublicLoan), page, pageSize, total };
}

/** 借出：校验可用量；实例制必须指定一个在库实例 */
export function createLoan(db, input = {}, userId) {
  const itemId = requireId(input.itemId, '物料');
  const quantity = requireInt(input.quantity, '数量', { min: 1, max: 1000000 });
  const borrower = requireString(input.borrower, '借用人', { min: 1, max: 60 });
  const contact = optionalString(input.contact, '联系方式', { max: 100 });
  const note = optionalString(input.note, '备注', { max: 500 });
  const borrowedAt = normalizeDate(input.borrowedAt) ?? nowIso();
  const dueAt = normalizeDate(input.dueAt, true);
  if (dueAt && dueAt < borrowedAt) throw ERROR.validation('预计归还时间不能早于借出时间');

  return withTransaction(db, () => {
    const item = db.prepare('SELECT * FROM item WHERE id = ?').get(itemId);
    if (!item) throw ERROR.notFound('物料不存在');

    const available = Number(item.quantity) - outstandingQuantity(db, itemId);
    if (quantity > available) {
      throw ERROR.insufficientStock(
        `可用量不足：当前可用 ${Math.max(0, available)} ${item.unit}`,
        { available: Math.max(0, available) },
      );
    }

    let instanceId = optionalId(input.instanceId, '实例');
    if (item.tracking_mode === 'instance') {
      if (quantity !== 1) throw ERROR.validation('实例制物料一次只能借出 1 个实例');
      if (instanceId == null) throw ERROR.validation('请选择要借出的实例');
      const instance = db
        .prepare('SELECT * FROM item_instance WHERE id = ? AND item_id = ?')
        .get(instanceId, itemId);
      if (!instance) throw ERROR.validation('实例不存在');
      if (instance.status !== 'in_stock') throw ERROR.conflict('该实例当前不在库，不能借出');
    } else if (instanceId != null) {
      throw ERROR.validation('数量制物料不能指定实例');
    }

    const now = nowIso();
    const inserted = db
      .prepare(
        `INSERT INTO loan (
           item_id, instance_id, quantity, returned_quantity, borrower, contact, note,
           borrowed_at, due_at, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(itemId, instanceId, quantity, borrower, contact, note, borrowedAt, dueAt, userId, now, now);

    const loanId = Number(inserted.lastInsertRowid);
    if (instanceId != null) setInstanceStatusForLoan(db, instanceId, 'lent');

    db.prepare(
      `INSERT INTO movement (
         item_id, instance_id, loan_id, user_id, type, quantity, quantity_delta, balance_after, note, occurred_at, created_at
       ) VALUES (?, ?, ?, ?, 'borrow', ?, 0, ?, ?, ?, ?)`,
    ).run(
      itemId,
      instanceId,
      loanId,
      userId,
      quantity,
      Number(item.quantity),
      `借给 ${borrower}`,
      borrowedAt,
      now,
    );

    return { loan: getLoan(db, loanId), available: Math.max(0, available - quantity) };
  });
}

/** 部分/全部归还 */
export function returnLoan(db, loanId, input = {}, userId) {
  const loan = db.prepare('SELECT * FROM loan WHERE id = ?').get(loanId);
  if (!loan) throw ERROR.notFound('借出记录不存在');

  const remaining = Number(loan.quantity) - Number(loan.returned_quantity);
  if (remaining <= 0) throw ERROR.conflict('该借出已全部归还');

  const quantity = requireInt(input.quantity, '归还数量', { min: 1, max: remaining });
  if (loan.instance_id != null && quantity !== remaining) {
    throw ERROR.validation('实例必须一次性归还');
  }

  return withTransaction(db, () => {
    const now = nowIso();
    const returned = Number(loan.returned_quantity) + quantity;
    const full = returned >= Number(loan.quantity);

    db.prepare('UPDATE loan SET returned_quantity = ?, returned_at = ?, updated_at = ? WHERE id = ?').run(
      returned,
      full ? now : null,
      now,
      loanId,
    );

    if (full && loan.instance_id != null) {
      setInstanceStatusForLoan(db, loan.instance_id, 'in_stock');
    }

    const item = db.prepare('SELECT quantity FROM item WHERE id = ?').get(loan.item_id);
    db.prepare(
      `INSERT INTO movement (
         item_id, instance_id, loan_id, user_id, type, quantity, quantity_delta, balance_after, note, occurred_at, created_at
       ) VALUES (?, ?, ?, ?, 'return', ?, 0, ?, ?, ?, ?)`,
    ).run(
      loan.item_id,
      loan.instance_id,
      loanId,
      userId,
      quantity,
      Number(item.quantity),
      '归还',
      now,
      now,
    );

    return { loan: getLoan(db, loanId), remaining: Number(loan.quantity) - returned };
  });
}

/** 撤销借出：仅限尚未归还的记录 */
export function cancelLoan(db, loanId) {
  const loan = db.prepare('SELECT * FROM loan WHERE id = ?').get(loanId);
  if (!loan) throw ERROR.notFound('借出记录不存在');
  if (Number(loan.returned_quantity) > 0 || loan.returned_at != null) {
    throw ERROR.conflict('已有归还记录，不能撤销');
  }

  return withTransaction(db, () => {
    if (loan.instance_id != null) setInstanceStatusForLoan(db, loan.instance_id, 'in_stock');
    db.prepare('DELETE FROM movement WHERE loan_id = ?').run(loanId);
    db.prepare('DELETE FROM loan WHERE id = ?').run(loanId);
    return { ok: true };
  });
}
