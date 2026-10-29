import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createBackup,
  decryptBackup,
  listBackups,
  restoreBackup,
} from '../src/services/backup.js';
import { checkDatabase, reconcileQuantities } from '../src/services/maintenance.js';
import { createAdminAccount, createFixture, destroyFixture, request } from './helpers.js';

const PASSPHRASE = 'Backup-Test-Pass-2026';

describe('加密备份与数据库检查', () => {
  let ctx;

  beforeEach(async () => {
    ctx = await createFixture();
    const admin = await createAdminAccount(ctx);
    const item = await request(ctx.app, {
      method: 'POST',
      url: '/api/items',
      cookie: admin.cookie,
      payload: { name: '备份测试板', quantity: 3, unit: '块' },
    });
    expect(item.statusCode).toBe(201);
  });

  afterEach(async () => {
    await destroyFixture(ctx);
  });

  it('备份加密、可解密并可在新目录恢复', async () => {
    const backup = createBackup(ctx.app.db, {
      dataDir: ctx.dir,
      passphrase: PASSPHRASE,
      keep: 5,
    });
    expect(fs.existsSync(backup.path)).toBe(true);
    expect(fs.readFileSync(backup.path).subarray(0, 16).toString()).toContain('PARTBINBACKUP');
    expect(listBackups(ctx.dir)).toHaveLength(1);

    expect(() => decryptBackup(backup.path, 'wrong-passphrase-123')).toThrow(/解密失败/);

    const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'partbin-restore-'));
    try {
      const restored = restoreBackup({
        backupPath: backup.path,
        dataDir: restoreDir,
        passphrase: PASSPHRASE,
      });
      expect(restored.restored).toBe(true);

      const db = new DatabaseSync(restored.target);
      try {
        expect(Number(db.prepare('SELECT COUNT(*) AS c FROM item').get().c)).toBe(1);
        expect(Number(db.prepare('SELECT quantity FROM item').get().quantity)).toBe(3);
        expect(checkDatabase(db, { dataDir: restoreDir }).ok).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(restoreDir, { recursive: true, force: true });
    }
  });

  it('db:check 发现数量不一致，reconcile 按流水修复', async () => {
    ctx.app.db.prepare('UPDATE item SET quantity = 99 WHERE id = 1').run();

    const broken = checkDatabase(ctx.app.db, { dataDir: ctx.dir });
    expect(broken.ok).toBe(false);
    expect(broken.issues.some((issue) => issue.code === 'item.quantity')).toBe(true);

    const result = reconcileQuantities(ctx.app.db);
    expect(result.fixed).toHaveLength(1);

    const repaired = checkDatabase(ctx.app.db, { dataDir: ctx.dir });
    expect(repaired.ok).toBe(true);
    expect(Number(ctx.app.db.prepare('SELECT quantity FROM item WHERE id = 1').get().quantity)).toBe(3);
  });
});
