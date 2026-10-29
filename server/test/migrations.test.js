import { rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/env.js';
import { migrate } from '../src/db/migrate.js';
import { createFixture, destroyFixture } from './helpers.js';

describe('数据库迁移', () => {
  it('首次启动建表并记录版本', async () => {
    const ctx = await createFixture();
    try {
      const tables = ctx.app.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name);

      expect(tables).toEqual(
        expect.arrayContaining([
          'schema_migration',
          'setting',
          'user',
          'session',
          'category',
          'location',
          'photo',
          'item',
          'item_instance',
          'loan',
          'movement',
          'item_photo',
          'invite',
          'login_attempt',
          'recovery_code',
          'audit_log',
        ]),
      );

      const applied = Number(
        ctx.app.db.prepare('SELECT COUNT(*) AS c FROM schema_migration').get().c,
      );
      expect(applied).toBe(3);

      const settings = ctx.app.db.prepare('SELECT key, value FROM setting').all();
      expect(settings).toEqual(
        expect.arrayContaining([
          { key: 'allow_registration', value: '1' },
          { key: 'registration_mode', value: 'invite' },
          { key: 'site_name', value: 'PartBin' },
        ]),
      );
    } finally {
      await destroyFixture(ctx);
    }
  });

  it('重复打开同一数据目录不会重复执行迁移', async () => {
    const first = await createFixture();
    const dir = first.dir;
    await first.app.close();

    const second = await buildApp(
      loadConfig({
        dataDir: dir,
        logLevel: 'silent',
        webDist: path.join(dir, '__no_web_build__'),
      }),
    );
    await second.ready();

    try {
      const applied = Number(
        second.db.prepare('SELECT COUNT(*) AS c FROM schema_migration').get().c,
      );
      expect(applied).toBe(3);
    } finally {
      await second.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('002 迁移会把旧站点名更新为 PartBin', async () => {
    const ctx = await createFixture();
    try {
      ctx.app.db
        .prepare("UPDATE setting SET value = '硬件出入库' WHERE key = 'site_name'")
        .run();
      ctx.app.db.prepare('DELETE FROM schema_migration WHERE version = 2').run();

      migrate(ctx.app.db);

      const row = ctx.app.db
        .prepare("SELECT value FROM setting WHERE key = 'site_name'")
        .get();
      expect(row.value).toBe('PartBin');
      expect(
        Number(ctx.app.db.prepare('SELECT COUNT(*) AS c FROM schema_migration').get().c),
      ).toBe(3);
    } finally {
      await destroyFixture(ctx);
    }
  });

  it('约束生效：根分类重名、负库存、借出超额', async () => {
    const ctx = await createFixture();
    try {
      const insertCategory = ctx.app.db.prepare(
        'INSERT INTO category (name, created_at, updated_at) VALUES (?, ?, ?)',
      );

      insertCategory.run('开发板', 't', 't');
      expect(() => insertCategory.run('开发板', 't', 't')).toThrow(/UNIQUE/);

      expect(() =>
        ctx.app.db
          .prepare('INSERT INTO item (name, quantity, created_at, updated_at) VALUES (?, ?, ?, ?)')
          .run('负库存', -1, 't', 't'),
      ).toThrow(/CHECK/);

      ctx.app.db
        .prepare('INSERT INTO user (username, username_norm, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
        .run('tester', 'tester', 'x', 'admin', 't', 't');
      ctx.app.db
        .prepare('INSERT INTO item (name, created_at, updated_at) VALUES (?, ?, ?)')
        .run('测试板', 't', 't');

      expect(() =>
        ctx.app.db
          .prepare(
            'INSERT INTO loan (item_id, quantity, returned_quantity, borrower, borrowed_at, created_by, created_at, updated_at) VALUES (1, 1, 2, ?, ?, 1, ?, ?)',
          )
          .run('张三', 't', 't', 't'),
      ).toThrow(/CHECK/);
    } finally {
      await destroyFixture(ctx);
    }
  });
});
