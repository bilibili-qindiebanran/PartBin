#!/usr/bin/env node
import { loadConfig } from '../src/env.js';
import { openDatabase } from '../src/db/connection.js';
import { createBackup } from '../src/services/backup.js';

const passphrase = process.env.BACKUP_PASSPHRASE;
if (!passphrase) {
  console.error('缺少 BACKUP_PASSPHRASE（至少 12 个字符）；备份必须加密');
  process.exit(1);
}

const config = loadConfig();
const db = openDatabase(config);
try {
  const quick = db.prepare('PRAGMA quick_check').get();
  if (!quick || quick.quick_check !== 'ok') throw new Error('数据库完整性检查失败，拒绝备份');
  const result = createBackup(db, {
    dataDir: config.dataDir,
    passphrase,
    keep: config.backupKeep,
  });
  console.log(`备份完成：${result.path}`);
  console.log(`大小：${(result.bytes / 1024).toFixed(1)} KB`);
} catch (error) {
  console.error(`备份失败：${error.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
