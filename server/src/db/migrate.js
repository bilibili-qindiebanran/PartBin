import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowIso } from '../lib/time.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * 执行尚未应用的迁移。每个文件单独一个事务，版本记录在 schema_migration。
 * 已应用版本会被跳过，因此可重复调用。
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {number} 本次应用的迁移数量
 */
export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migration').all().map((row) => Number(row.version)),
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort((a, b) => Number(a.split('_')[0]) - Number(b.split('_')[0]));

  let count = 0;
  for (const file of files) {
    const version = Number(file.split('_')[0]);
    if (applied.has(version)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)').run(version, nowIso());
      db.exec('COMMIT');
      count += 1;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback failure
      }
      throw new Error(`数据库迁移失败（${file}）：${error.message}`, { cause: error });
    }
  }

  return count;
}
