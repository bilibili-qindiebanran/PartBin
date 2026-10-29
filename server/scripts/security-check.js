#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/env.js';
import { openDatabase } from '../src/db/connection.js';
import { getRegistrationMode } from '../src/services/settings.js';
import { listBackups } from '../src/services/backup.js';

const config = loadConfig();
const db = openDatabase(config);
const issues = [];
const warnings = [];

try {
  if (config.appSecret.length < 32) warnings.push('APP_SECRET 长度不足 32 字节');
  if (config.nodeEnv === 'production' && !config.publicOrigin.startsWith('https://')) {
    issues.push('PUBLIC_ORIGIN 必须是 https:// 地址');
  }
  if (!config.cookieSecure) warnings.push('COOKIE_SECURE 未开启；仅应在本地 HTTP 调试时如此');

  const mode = getRegistrationMode(db);
  if (mode === 'open') warnings.push('registration_mode=open：任何人都能注册只读账号');

  const admins = db
    .prepare("SELECT username, totp_enabled FROM user WHERE role = 'admin' AND is_active = 1")
    .all();
  if (admins.length === 0) issues.push('没有启用状态的管理员');
  for (const admin of admins) {
    if (Number(admin.totp_enabled) !== 1) warnings.push(`管理员 ${admin.username} 未启用 TOTP`);
  }

  const stat = fs.statSync(config.dataDir);
  if ((stat.mode & 0o077) !== 0) warnings.push(`${config.dataDir} 权限过宽，建议 chmod 700`);

  const backups = listBackups(config.dataDir);
  if (backups.length === 0) {
    warnings.push('没有本地备份');
  } else {
    const ageHours = (Date.now() - Date.parse(backups[0].mtime)) / 3600000;
    if (ageHours > 24) warnings.push(`最近备份已 ${ageHours.toFixed(1)} 小时未更新`);
  }
} finally {
  db.close();
}

console.log(`数据目录：${path.resolve(config.dataDir)}`);
for (const issue of issues) console.log(`✗ ${issue}`);
for (const warning of warnings) console.log(`! ${warning}`);
console.log(issues.length === 0 ? '安全检查通过（警告需人工确认）' : '存在必须修复的问题');
if (issues.length > 0) process.exitCode = 1;
