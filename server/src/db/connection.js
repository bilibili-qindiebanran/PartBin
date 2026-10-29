import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * 打开 SQLite 数据库并设置连接级 PRAGMA。
 * 数据目录、照片目录、备份目录都会在这里按需创建。
 * @param {{ dataDir: string }} config
 */
export function openDatabase(config) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, 'backups'), { recursive: true });

  const dbPath = path.join(config.dataDir, 'inventory.db');
  const db = new DatabaseSync(dbPath);

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  return db;
}

/**
 * 在一个 BEGIN IMMEDIATE 事务里执行同步回调。
 * 回调内不要 await 非数据库异步操作；异常会回滚并原样抛出。
 * @template T
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
export function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 回滚失败时保留原始错误
    }
    throw error;
  }
}

/** 探活查询 */
export function pingDatabase(db) {
  try {
    db.prepare('SELECT 1 AS ok').get();
    return 'ok';
  } catch {
    return 'error';
  }
}
