import { ERROR } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';

export const ACCOUNT_FAILURE_LIMIT = 5;
export const IP_FAILURE_LIMIT = 20;
export const WINDOW_MINUTES = 15;
export const LOCK_MINUTES = 15;

function windowStart() {
  return new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
}

export function recordLoginAttempt(db, { usernameNorm, ipHash, success }) {
  db.prepare(
    'INSERT INTO login_attempt (username_norm, ip_hash, success, created_at) VALUES (?, ?, ?, ?)',
  ).run(usernameNorm ?? null, ipHash, success ? 1 : 0, nowIso());
}

export function getFailureCounts(db, { usernameNorm, ipHash }) {
  const since = windowStart();
  const account = usernameNorm
    ? Number(
        db
          .prepare(
            'SELECT COUNT(*) AS c FROM login_attempt WHERE username_norm = ? AND success = 0 AND created_at >= ?',
          )
          .get(usernameNorm, since).c,
      )
    : 0;
  const ip = ipHash
    ? Number(
        db
          .prepare(
            'SELECT COUNT(*) AS c FROM login_attempt WHERE ip_hash = ? AND success = 0 AND created_at >= ?',
          )
          .get(ipHash, since).c,
      )
    : 0;
  return { account, ip };
}

export function lockAccount(db, userId, minutes = LOCK_MINUTES) {
  const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  db.prepare('UPDATE user SET locked_until = ?, updated_at = ? WHERE id = ?').run(
    until,
    nowIso(),
    userId,
  );
  return until;
}

export function clearAccountLock(db, userId) {
  db.prepare('UPDATE user SET locked_until = NULL, updated_at = ? WHERE id = ?').run(
    nowIso(),
    userId,
  );
}

/** 登录前的持久化锁定检查；返回剩余秒数或 0 */
export function remainingLockSeconds(user, counts = { account: 0, ip: 0 }) {
  if (user?.locked_until) {
    const remaining = Date.parse(user.locked_until) - Date.now();
    if (remaining > 0) return Math.ceil(remaining / 1000);
  }
  if (counts.ip >= IP_FAILURE_LIMIT) return LOCK_MINUTES * 60;
  if (counts.account >= ACCOUNT_FAILURE_LIMIT) return LOCK_MINUTES * 60;
  return 0;
}

export function throwLocked(retryAfter) {
  throw ERROR.rateLimited('登录尝试过多，请稍后再试', retryAfter);
}

/** 清理 30 天前的登录尝试记录 */
export function purgeOldLoginAttempts(db) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM login_attempt WHERE created_at < ?').run(cutoff);
}
