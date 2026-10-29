import fs from 'node:fs';
import path from 'node:path';
import { nowIso } from '../lib/time.js';
import { recordAudit } from './audit-log.js';

function addIssue(issues, code, message, detail = null) {
  issues.push({ code, message, detail });
}

/** 数据库不变量检查；只读，不修改数据 */
export function checkDatabase(db, { dataDir } = {}) {
  const issues = [];

  const integrity = db.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
    addIssue(issues, 'sqlite.integrity', 'SQLite 完整性检查失败', integrity);
  }
  const foreign = db.prepare('PRAGMA foreign_key_check').all();
  if (foreign.length > 0) addIssue(issues, 'sqlite.foreign_key', '外键检查失败', foreign);

  const mismatched = db
    .prepare(
      `SELECT i.id, i.name, i.quantity, COALESCE(SUM(m.quantity_delta), 0) AS ledger
       FROM item i LEFT JOIN movement m ON m.item_id = i.id
       GROUP BY i.id
       HAVING i.quantity <> ledger`,
    )
    .all();
  for (const row of mismatched) {
    addIssue(
      issues,
      'item.quantity',
      `物料「${row.name}」数量 ${row.quantity} 与流水合计 ${row.ledger} 不一致`,
      { itemId: Number(row.id), quantity: Number(row.quantity), ledger: Number(row.ledger) },
    );
  }

  const loans = db
    .prepare('SELECT id, returned_quantity, quantity FROM loan WHERE returned_quantity < 0 OR returned_quantity > quantity')
    .all();
  for (const row of loans) {
    addIssue(issues, 'loan.quantity', `借出 ${row.id} 归还数量非法`, row);
  }

  if (dataDir) {
    const photos = db.prepare('SELECT id, rel_path FROM photo').all();
    for (const photo of photos) {
      const filePath = path.join(dataDir, 'uploads', photo.rel_path);
      if (!fs.existsSync(filePath)) {
        addIssue(issues, 'photo.missing', `照片 ${photo.id} 文件缺失`, { relPath: photo.rel_path });
      }
    }
  }

  return {
    ok: issues.length === 0,
    checkedAt: nowIso(),
    issues,
    counts: {
      items: Number(db.prepare('SELECT COUNT(*) AS c FROM item').get().c),
      movements: Number(db.prepare('SELECT COUNT(*) AS c FROM movement').get().c),
      users: Number(db.prepare('SELECT COUNT(*) AS c FROM user').get().c),
      loans: Number(db.prepare('SELECT COUNT(*) AS c FROM loan').get().c),
    },
  };
}

/** 按流水重算 item.quantity；每处修正写一条 adjust 流水 */
export function reconcileQuantities(db) {
  const mismatched = db
    .prepare(
      `SELECT i.id, i.name, i.quantity, COALESCE(SUM(m.quantity_delta), 0) AS ledger
       FROM item i LEFT JOIN movement m ON m.item_id = i.id
       GROUP BY i.id
       HAVING i.quantity <> ledger`,
    )
    .all();

  const admin = db.prepare("SELECT id FROM user WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1").get();
  if (!admin) throw new Error('没有可用的管理员账号，无法写入修正流水');

  const fixed = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    const now = nowIso();
    for (const row of mismatched) {
      const ledger = Number(row.ledger);
      // 这是缓存修正，不是新的业务动作：只改 item.quantity，不写 movement
      db.prepare('UPDATE item SET quantity = ?, updated_at = ? WHERE id = ?').run(ledger, now, row.id);
      fixed.push({ itemId: Number(row.id), name: row.name, before: Number(row.quantity), after: ledger });
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  if (fixed.length > 0) {
    recordAudit(db, {
      actorId: Number(admin.id),
      action: 'maintenance.reconcile',
      targetType: 'database',
      detail: { fixed },
    });
  }
  return { fixed };
}
