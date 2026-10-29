#!/usr/bin/env node
/**
 * CLI 初始化管理员：
 *   pnpm admin:create -- --username CyanButterfly --password '...'
 * 或设置 ADMIN_PASSWORD 环境变量。
 */
import path from 'node:path';
import { loadConfig } from '../src/env.js';
import { openDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createAdmin } from '../src/services/users.js';
import { recordAudit } from '../src/services/audit-log.js';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const username = arg('username') ?? process.env.ADMIN_USERNAME;
const password = arg('password') ?? process.env.ADMIN_PASSWORD;

if (!username || !password) {
  console.error('用法：pnpm admin:create -- --username <用户名> --password <密码>（或设置 ADMIN_PASSWORD）');
  process.exit(1);
}

const config = loadConfig();
const db = openDatabase(config);
try {
  migrate(db);
  const user = createAdmin(db, { username, password });
  recordAudit(db, {
    actorId: user.id,
    action: 'admin.bootstrap',
    targetType: 'user',
    targetId: user.id,
  });
  console.log(`已创建管理员：${user.username}（id=${user.id}）`);
  console.log(`数据目录：${path.resolve(config.dataDir)}`);
} catch (error) {
  console.error(`创建失败：${error.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
