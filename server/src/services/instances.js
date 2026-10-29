import { withTransaction } from '../db/connection.js';
import { ERROR } from '../lib/errors.js';
import { buildPathMap } from '../lib/tree.js';
import { nowIso } from '../lib/time.js';
import {
  optionalId,
  optionalInt,
  optionalNumber,
  optionalString,
  requireEnum,
  requireId,
  requireInt,
  requireString,
} from '../lib/validate.js';

const ITEM_SELECT = 'SELECT id, name, unit, quantity, tracking_mode, location_id FROM item WHERE id = ?';

function locationPaths(db) {
  return buildPathMap(db.prepare('SELECT id, parent_id, name FROM location').all());
}

function toPublicInstance(row, paths) {
  return {
    id: Number(row.id),
    itemId: Number(row.item_id),
    assetNo: row.asset_no ?? null,
    serial: row.serial ?? null,
    status: row.status,
    locationId: row.location_id == null ? null : Number(row.location_id),
    locationPath:
      row.location_id == null ? null : (paths.get(Number(row.location_id)) ?? null),
    photoId: row.photo_id == null ? null : Number(row.photo_id),
    price: row.price_cents == null ? null : Number(row.price_cents) / 100,
    note: row.note ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getInstanceRow(db, id) {
  return db.prepare('SELECT * FROM item_instance WHERE id = ?').get(id);
}

function ensureInstanceItem(db, itemId) {
  const item = db.prepare(ITEM_SELECT).get(itemId);
  if (!item) throw ERROR.notFound('物料不存在');
  if (item.tracking_mode !== 'instance') {
    throw ERROR.validation('只有实例制物料才能登记单个实例');
  }
  return item;
}

function ensureLocation(db, locationId) {
  if (locationId == null) return null;
  const row = db.prepare('SELECT id FROM location WHERE id = ?').get(locationId);
  if (!row) throw ERROR.validation('位置不存在');
  return locationId;
}

function writeInstanceMovement(db, itemId, instanceId, userId, type, quantity, delta, note, now) {
  const item = db.prepare('SELECT quantity FROM item WHERE id = ?').get(itemId);
  db.prepare(
    `INSERT INTO movement (
       item_id, instance_id, user_id, type, quantity, quantity_delta, balance_after, note, occurred_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(itemId, instanceId, userId, type, quantity, delta, Number(item.quantity), note, now, now);
}

export function listInstances(db, itemId) {
  ensureInstanceItem(db, itemId);
  const paths = locationPaths(db);
  const rows = db
    .prepare('SELECT * FROM item_instance WHERE item_id = ? ORDER BY id ASC')
    .all(itemId);
  return rows.map((row) => toPublicInstance(row, paths));
}

export function createInstance(db, itemId, input = {}, userId) {
  const item = ensureInstanceItem(db, itemId);
  const assetNo = optionalString(input.assetNo, '资产编号', { max: 64 });
  const serial = optionalString(input.serial, '序列号', { max: 120 });
  const locationId = ensureLocation(
    db,
    optionalId(input.locationId, '位置') ?? (item.location_id == null ? null : Number(item.location_id)),
  );
  const note = optionalString(input.note, '备注', { max: 500 });
  const price = optionalNumber(input.price, '价格', { min: 0, max: 1e9 });

  return withTransaction(db, () => {
    const now = nowIso();
    let inserted;
    try {
      inserted = db
        .prepare(
          `INSERT INTO item_instance (item_id, asset_no, serial, status, location_id, note, price_cents, created_at, updated_at)
           VALUES (?, ?, ?, 'in_stock', ?, ?, ?, ?, ?)`,
        )
        .run(
          itemId,
          assetNo,
          serial,
          locationId,
          note,
          price == null ? null : Math.round(price * 100),
          now,
          now,
        );
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw ERROR.duplicate('资产编号已存在');
      throw error;
    }

    db.prepare('UPDATE item SET quantity = quantity + 1, updated_by = ?, updated_at = ? WHERE id = ?').run(
      userId,
      now,
      itemId,
    );
    writeInstanceMovement(db, itemId, Number(inserted.lastInsertRowid), userId, 'in', 1, 1, '登记实例', now);

    return toPublicInstance(getInstanceRow(db, Number(inserted.lastInsertRowid)), locationPaths(db));
  });
}

export function createInstancesBatch(db, itemId, input = {}, userId) {
  const item = ensureInstanceItem(db, itemId);
  const count = requireInt(input.count, '数量', { min: 1, max: 100 });
  const prefix = requireString(input.prefix, '编号前缀', { min: 1, max: 40 });
  const startAt = optionalInt(input.startAt, '起始序号', { min: 1, max: 9999 }) ?? 1;
  const locationId = ensureLocation(
    db,
    optionalId(input.locationId, '位置') ?? (item.location_id == null ? null : Number(item.location_id)),
  );

  return withTransaction(db, () => {
    const now = nowIso();
    const assetNos = Array.from({ length: count }, (_, index) =>
      `${prefix}-${String(startAt + index).padStart(3, '0')}`,
    );

    const existing = db
      .prepare(
        `SELECT asset_no FROM item_instance WHERE asset_no IN (${assetNos.map(() => '?').join(', ')})`,
      )
      .all(...assetNos);
    if (existing.length > 0) {
      throw ERROR.duplicate(`资产编号已存在：${existing[0].asset_no}`);
    }

    const insert = db.prepare(
      `INSERT INTO item_instance (item_id, asset_no, status, location_id, created_at, updated_at)
       VALUES (?, ?, 'in_stock', ?, ?, ?)`,
    );
    for (const assetNo of assetNos) insert.run(itemId, assetNo, locationId, now, now);

    db.prepare('UPDATE item SET quantity = quantity + ?, updated_by = ?, updated_at = ? WHERE id = ?').run(
      count,
      userId,
      now,
      itemId,
    );
    writeInstanceMovement(db, itemId, null, userId, 'in', count, count, `批量登记 ${count} 个实例`, now);

    return listInstances(db, itemId);
  });
}

const PATCHABLE_STATUS = ['in_stock', 'broken', 'lost', 'retired'];

export function updateInstance(db, id, input = {}, userId) {
  const current = getInstanceRow(db, id);
  if (!current) throw ERROR.notFound('实例不存在');
  const item = db.prepare(ITEM_SELECT).get(current.item_id);
  if (!item) throw ERROR.notFound('物料不存在');

  if (input.status !== undefined && input.status === 'lent') {
    throw ERROR.validation('借出状态只能通过借出接口产生');
  }
  if (current.status === 'lent') {
    throw ERROR.conflict('实例已借出，请先归还');
  }

  const targetStatus =
    input.status === undefined
      ? current.status
      : requireEnum(input.status, '实例状态', PATCHABLE_STATUS);

  if ((current.status === 'lost' || current.status === 'retired') && targetStatus !== current.status) {
    throw ERROR.conflict('已丢失或退役的实例不能恢复');
  }

  const assetNo =
    input.assetNo === undefined
      ? (current.asset_no ?? null)
      : optionalString(input.assetNo, '资产编号', { max: 64 });
  const serial =
    input.serial === undefined
      ? (current.serial ?? null)
      : optionalString(input.serial, '序列号', { max: 120 });
  const note =
    input.note === undefined ? (current.note ?? null) : optionalString(input.note, '备注', { max: 500 });
  const locationId =
    input.locationId === undefined
      ? (current.location_id == null ? null : Number(current.location_id))
      : ensureLocation(db, optionalId(input.locationId, '位置'));

  const removed = (targetStatus === 'lost' || targetStatus === 'retired') && current.status !== targetStatus;

  return withTransaction(db, () => {
    const now = nowIso();
    try {
      db.prepare(
        `UPDATE item_instance
         SET asset_no = ?, serial = ?, status = ?, location_id = ?, note = ?, updated_at = ?
         WHERE id = ?`,
      ).run(assetNo, serial, targetStatus, locationId, note, now, id);
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw ERROR.duplicate('资产编号已存在');
      throw error;
    }

    if (removed) {
      db.prepare(
        'UPDATE item SET quantity = MAX(0, quantity - 1), updated_by = ?, updated_at = ? WHERE id = ?',
      ).run(userId, now, current.item_id);
      writeInstanceMovement(
        db,
        current.item_id,
        id,
        userId,
        targetStatus === 'lost' ? 'lost' : 'discard',
        1,
        -1,
        targetStatus === 'lost' ? '实例丢失' : '实例退役',
        now,
      );
    }

    return toPublicInstance(getInstanceRow(db, id), locationPaths(db));
  });
}

/** 删除等同于退役 */
export function removeInstance(db, id, userId) {
  const current = getInstanceRow(db, id);
  if (!current) throw ERROR.notFound('实例不存在');
  if (current.status === 'lent') throw ERROR.conflict('实例已借出，不能删除');
  if (current.status === 'retired') {
    return toPublicInstance(current, locationPaths(db));
  }
  return updateInstance(db, id, { status: 'retired' }, userId);
}

/** 供借还服务调用：标记实例借出/归还，不单独写流水（由借还写 borrow/return） */
export function setInstanceStatusForLoan(db, instanceId, status) {
  db.prepare('UPDATE item_instance SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    nowIso(),
    instanceId,
  );
}
