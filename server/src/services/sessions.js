import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isExpired, isoAfterDays, nowIso } from '../lib/time.js';

export const COOKIE_NAME = 'inv_sid';

/** 会话 token 只以 SHA-256 形式落库 */
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 创建会话并返回明文 token（仅此一次出现在服务端）。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ userId: number, ip?: string, userAgent?: string, days: number }} input
 */
export function createSession(db, { userId, ip, userAgent, days }) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  db.prepare(`
    INSERT INTO session (id, user_id, token_hash, created_at, expires_at, last_seen_at, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    userId,
    hashToken(token),
    now.toISOString(),
    isoAfterDays(days, now.getTime()),
    now.toISOString(),
    ip ?? null,
    userAgent ?? null,
  );
  return token;
}

/**
 * 根据 token 找到有效会话与用户。
 * 过期、禁用账号、token 不存在都返回 null。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string | undefined} token
 */
export function findSession(db, token) {
  if (!token || typeof token !== 'string') return null;

  const row = db.prepare(`
    SELECT s.id AS session_id,
           s.expires_at,
           s.last_seen_at,
           u.id AS user_id,
           u.username,
           u.role,
           u.is_active
    FROM session s
    JOIN user u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(hashToken(token));

  if (!row) return null;
  if (isExpired(row.expires_at)) return null;
  if (Number(row.is_active) !== 1) return null;

  return {
    sessionId: row.session_id,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    user: {
      id: Number(row.user_id),
      username: row.username,
      role: row.role,
    },
  };
}

/**
 * 滑动续期：超过 1 小时没有活动才写库，避免每个请求都 UPDATE。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ sessionId: string, lastSeenAt: string }} session
 * @param {number} days
 */
export function touchSession(db, session, days) {
  const lastSeen = Date.parse(session.lastSeenAt);
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen < 60 * 60 * 1000) return false;

  const now = new Date();
  db.prepare('UPDATE session SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(
    now.toISOString(),
    isoAfterDays(days, now.getTime()),
    session.sessionId,
  );
  return true;
}

/** 删除单个会话（退出登录） */
export function deleteSession(db, sessionId) {
  db.prepare('DELETE FROM session WHERE id = ?').run(sessionId);
}

/**
 * 删除某个用户的会话；可通过 exceptSessionId 保留当前设备。
 */
export function deleteSessionsForUser(db, userId, { exceptSessionId } = {}) {
  if (exceptSessionId) {
    db.prepare('DELETE FROM session WHERE user_id = ? AND id <> ?').run(userId, exceptSessionId);
  } else {
    db.prepare('DELETE FROM session WHERE user_id = ?').run(userId);
  }
}

/** 清理过期会话（启动时调用） */
export function purgeExpiredSessions(db) {
  const result = db.prepare('DELETE FROM session WHERE expires_at <= ?').run(nowIso());
  return Number(result.changes ?? 0);
}

/** 下发会话 Cookie */
export function setSessionCookie(reply, token, config) {
  reply.setCookie(COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: config.sessionDays * 24 * 60 * 60,
  });
}

/** 清除会话 Cookie */
export function clearSessionCookie(reply) {
  reply.clearCookie(COOKIE_NAME, { path: '/' });
}
