import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

const MAGIC = Buffer.from('PARTBINBACKUP001\n');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES;

function deriveKey(passphrase, salt) {
  return scryptSync(String(passphrase), salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
}

function requirePassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12) {
    throw new Error('BACKUP_PASSPHRASE 至少 12 个字符');
  }
}

/** 备份目录内的 .pbk 文件，按时间倒序 */
export function listBackups(dataDir) {
  const dir = path.join(dataDir, 'backups');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^partbin-.*\.db\.pbk$/.test(name))
    .sort()
    .reverse()
    .map((name) => {
      const filePath = path.join(dir, name);
      const stat = fs.statSync(filePath);
      return { path: filePath, name, bytes: stat.size, mtime: stat.mtime.toISOString() };
    });
}

/** 一致性快照 + gzip + AES-256-GCM；文件名含 UTC 时间 */
export function createBackup(db, { dataDir, passphrase, keep = 14 } = {}) {
  requirePassphrase(passphrase);
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const snapshotPath = path.join(dir, `.snapshot-${randomUUID()}.db`);
  try {
    const escaped = snapshotPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escaped}'`);
    const plain = fs.readFileSync(snapshotPath);
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const key = deriveKey(passphrase, salt);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
    const payload = Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);

    const name = `partbin-${timestamp()}.db.pbk`;
    const outputPath = path.join(dir, name);
    const tempPath = `${outputPath}.tmp`;
    fs.writeFileSync(tempPath, payload, { mode: 0o600 });
    fs.renameSync(tempPath, outputPath);

    const backups = fs
      .readdirSync(dir)
      .filter((entry) => /^partbin-.*\.db\.pbk$/.test(entry))
      .sort();
    while (backups.length > keep) {
      const removed = backups.shift();
      fs.rmSync(path.join(dir, removed), { force: true });
    }

    return { path: outputPath, name, bytes: payload.length, createdAt: new Date().toISOString() };
  } finally {
    fs.rmSync(snapshotPath, { force: true });
  }
}

/** 解密并返回 SQLite 字节 */
export function decryptBackup(backupPath, passphrase) {
  requirePassphrase(passphrase);
  const payload = fs.readFileSync(backupPath);
  if (payload.length <= HEADER_BYTES || !payload.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('不是有效的 PartBin 备份文件');
  }

  let offset = MAGIC.length;
  const salt = payload.subarray(offset, offset + SALT_BYTES);
  offset += SALT_BYTES;
  const iv = payload.subarray(offset, offset + IV_BYTES);
  offset += IV_BYTES;
  const tag = payload.subarray(offset, offset + TAG_BYTES);
  offset += TAG_BYTES;

  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(payload.subarray(offset)), decipher.final()]);
    return gunzipSync(compressed);
  } catch {
    throw new Error('备份解密失败：密码错误或文件已损坏');
  }
}

function verifySqlite(buffer) {
  const tempDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'partbin-verify-'));
  const filePath = path.join(tempDir, 'verify.db');
  try {
    fs.writeFileSync(filePath, buffer, { mode: 0o600 });
    const db = new DatabaseSync(filePath);
    try {
      const integrity = db.prepare('PRAGMA integrity_check').get();
      if (!integrity || integrity.integrity_check !== 'ok') {
        throw new Error('备份完整性检查失败');
      }
      const foreign = db.prepare('PRAGMA foreign_key_check').all();
      if (foreign.length > 0) throw new Error('备份外键检查失败');
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/** 离线恢复：会先保留当前 inventory.db 为 .before-restore-* */
export function restoreBackup({ backupPath, dataDir, passphrase }) {
  const plain = decryptBackup(backupPath, passphrase);
  verifySqlite(plain);

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const target = path.join(dataDir, 'inventory.db');
  const tempPath = path.join(dataDir, `.restore-${randomUUID()}.db`);
  fs.writeFileSync(tempPath, plain, { mode: 0o600 });

  let previousPath = null;
  if (fs.existsSync(target)) {
    previousPath = path.join(dataDir, `inventory.db.before-restore-${timestamp()}`);
    fs.copyFileSync(target, previousPath);
  }
  for (const suffix of ['-wal', '-shm']) {
    fs.rmSync(`${target}${suffix}`, { force: true });
  }
  fs.renameSync(tempPath, target);
  fs.chmodSync(target, 0o600);

  return { restored: true, target, previousPath, bytes: plain.length };
}
