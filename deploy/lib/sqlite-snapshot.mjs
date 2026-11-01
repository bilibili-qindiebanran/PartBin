#!/usr/bin/env node
// 用 SQLite 的 VACUUM INTO 生成一致性快照（合并 WAL，不需要停服务）
// 用法：node deploy/lib/sqlite-snapshot.mjs <源库> <目标文件>
import { DatabaseSync } from 'node:sqlite';

const [source, target] = process.argv.slice(2);
if (!source || !target) {
  console.error('用法：node deploy/lib/sqlite-snapshot.mjs <源库> <目标文件>');
  process.exit(2);
}

const literal = `'${target.replace(/'/g, "''")}'`;
const db = new DatabaseSync(source, { readOnly: true });
try {
  db.exec(`VACUUM INTO ${literal}`);
} finally {
  db.close();
}
console.log(`快照完成：${target}`);
