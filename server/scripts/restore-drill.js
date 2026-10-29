#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { restoreBackup } from '../src/services/backup.js';
import { checkDatabase } from '../src/services/maintenance.js';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const file = arg('file') ?? process.argv[2];
const passphrase = process.env.BACKUP_PASSPHRASE;
if (!file || !passphrase) {
  console.error('用法：BACKUP_PASSPHRASE=... pnpm backup:verify -- --file /path/to/backup.pbk');
  process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'partbin-drill-'));
try {
  const result = restoreBackup({ backupPath: path.resolve(file), dataDir: dir, passphrase });
  const db = new DatabaseSync(result.target);
  try {
    const check = checkDatabase(db, { dataDir: dir });
    console.log(JSON.stringify({ ok: check.ok, counts: check.counts, issues: check.issues }, null, 2));
    if (!check.ok) process.exitCode = 1;
  } finally {
    db.close();
  }
} catch (error) {
  console.error(`演练失败：${error.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
