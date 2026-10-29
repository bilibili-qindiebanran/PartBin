#!/usr/bin/env node
import { loadConfig } from '../src/env.js';
import { openDatabase } from '../src/db/connection.js';
import { checkDatabase } from '../src/services/maintenance.js';

const config = loadConfig();
const db = openDatabase(config);
try {
  const result = checkDatabase(db, { dataDir: config.dataDir });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  db.close();
}
