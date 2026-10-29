import { nowIso } from '../lib/time.js';

/** 读取配置项，不存在时返回 fallback */
export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

/** 写入配置项（upsert） */
export function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO setting (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value), nowIso());
}

/** 是否允许新用户注册 */
export function allowRegistration(db) {
  return getSetting(db, 'allow_registration', '1') !== '0';
}

/** 设置注册开关 */
export function setAllowRegistration(db, allowed) {
  setSetting(db, 'allow_registration', allowed ? '1' : '0');
}

/** 是否已经存在用户（决定首个注册者是否为管理员） */
export function hasUsers(db) {
  return Number(db.prepare('SELECT COUNT(*) AS c FROM user').get().c) > 0;
}
