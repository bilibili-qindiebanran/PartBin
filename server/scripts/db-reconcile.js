#!/usr/bin/env node
import { loadConfig } from '../src/env.js';
import { openDatabase } from '../src/db/connection.js';
import { checkDatabase, reconcileQuantities } from '../src/services/maintenance.js';

const fix = process.argv.includes('--fix');
const config = loadConfig();
const db = openDatabase(config);
try {
  const before = checkDatabase(db, { dataDir: config.dataDir });
  console.log(`检查结果：${before.ok ? '通过' : `${before.issues.length} 个问题`}`);
  for (const issue of before.issues) console.log(`- [${issue.code}] ${issue.message}`);

  if (!fix) {
    console.log('默认只报告；传入 --fix 才会按流水重算数量。');
  } else {
    const result = reconcileQuantities(db);
    console.log(`已修正 ${result.fixed.length} 个物料。`);
    const after = checkDatabase(db, { dataDir: config.dataDir });
    console.log(`修正后：${after.ok ? '通过' : '仍有问题，请人工检查'}`);
    if (!after.ok) process.exitCode = 1;
  }
} finally {
  db.close();
}
