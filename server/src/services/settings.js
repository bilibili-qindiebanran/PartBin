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

export const REGISTRATION_MODES = ['closed', 'invite', 'open'];

/** 注册策略：closed 关闭、invite 邀请码、open 开放 */
export function getRegistrationMode(db) {
  const value = getSetting(db, 'registration_mode', 'invite');
  return REGISTRATION_MODES.includes(value) ? value : 'invite';
}

export function setRegistrationMode(db, mode) {
  if (!REGISTRATION_MODES.includes(mode)) throw new Error('注册策略不合法');
  setSetting(db, 'registration_mode', mode);
  setSetting(db, 'allow_registration', mode === 'closed' ? '0' : '1');
}

/** 是否允许新用户注册（兼容旧前端字段） */
export function allowRegistration(db) {
  return getRegistrationMode(db) !== 'closed';
}

/** 旧接口：布尔开关映射为 open / closed */
export function setAllowRegistration(db, allowed) {
  setRegistrationMode(db, allowed ? 'open' : 'closed');
}

/** 是否已经存在用户（决定首个注册者是否为管理员） */
export function hasUsers(db) {
  return Number(db.prepare('SELECT COUNT(*) AS c FROM user').get().c) > 0;
}
