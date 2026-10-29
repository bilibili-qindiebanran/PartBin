#!/usr/bin/env node
import path from 'node:path';
import { loadConfig } from '../src/env.js';
import { restoreBackup } from '../src/services/backup.js';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const file = arg('file');
const passphrase = process.env.BACKUP_PASSPHRASE;
if (!file || !passphrase) {
  console.error('用法：BACKUP_PASSPHRASE=... pnpm restore -- --file /path/to/partbin-xxx.db.pbk');
  process.exit(1);
}

const config = loadConfig();
try {
  const result = restoreBackup({
    backupPath: path.resolve(file),
    dataDir: config.dataDir,
    passphrase,
  });
  console.log(`已恢复：${result.target}`);
  if (result.previousPath) console.log(`恢复前数据库已保留：${result.previousPath}`);
  console.log('请运行 pnpm db:check，然后启动服务。');
} catch (error) {
  console.error(`恢复失败：${error.message}`);
  process.exitCode = 1;
}
