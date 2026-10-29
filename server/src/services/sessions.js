import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isExpired, isoAfterDays, nowIso } from '../lib/time.js';

export const COOKIE_NAME = 'inv_sid';

/** HTTPS 下使用 __Host- 前缀，开发环境保留旧名便于调试 */
export function sessionCookieName(config = {}) {
  return config.cookieSecure ? '__Host-partbin_sid' : COOKIE_NAME;
}

/** 会话 token 只以 SHA-256 形式落库 */
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 创建会话并返回明文 token（仅此一次出现在服务端）。
 * 同时写空闲过期与绝对过期；绝对过期不会被滑动续期延长。
 */
export function createSession(db, { userId, ip, ipHash, userAgent, days, absoluteDays = days }) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  db.prepare(`
    INSERT INTO session (
      id, user_id, token_hash, created_at, expires_at, absolute_expires_at, last_seen_at, ip, ip_hash, user_agent
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    userId,
    hashToken(token),
    now.toISOString(),
    isoAfterDays(days, now.getTime()),
    isoAfterDays(absoluteDays, now.getTime()),
    now.toISOString(),
    ip ?? null,
    ipHash ?? null,
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
           s.absolute_expires_at,
           s.reauth_at,
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
  if (row.absolute_expires_at && isExpired(row.absolute_expires_at)) return null;
  if (Number(row.is_active) !== 1) return null;

  return {
    sessionId: row.session_id,
    expiresAt: row.expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    reauthAt: row.reauth_at,
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

/** 记录最近一次敏感操作再验证时间 */
export function updateReauth(db, sessionId) {
  db.prepare('UPDATE session SET reauth_at = ? WHERE id = ?').run(nowIso(), sessionId);
}

/** 当前用户的登录设备列表 */
export function listSessionsForUser(db, userId) {
  return db
    .prepare(
      `SELECT id, created_at, last_seen_at, expires_at, absolute_expires_at, reauth_at, ip_hash, user_agent
       FROM session WHERE user_id = ? ORDER BY last_seen_at DESC`,
    )
    .all(userId)
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      absoluteExpiresAt: row.absolute_expires_at,
      reauthAt: row.reauth_at,
      ipHash: row.ip_hash ? String(row.ip_hash).slice(0, 8) : null,
      userAgent: row.user_agent ?? null,
    }));
}

/** 用户只能删除自己的会话 */
export function deleteOwnSession(db, sessionId, userId) {
  const result = db.prepare('DELETE FROM session WHERE id = ? AND user_id = ?').run(sessionId, userId);
  return Number(result.changes ?? 0) > 0;
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
  const now = nowIso();
  const result = db
    .prepare(
      'DELETE FROM session WHERE expires_at <= ? OR (absolute_expires_at IS NOT NULL AND absolute_expires_at <= ?)',
    )
    .run(now, now);
  return Number(result.changes ?? 0);
}

/** 下发会话 Cookie */
export function setSessionCookie(reply, token, config) {
  reply.setCookie(sessionCookieName(config), token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: config.sessionDays * 24 * 60 * 60,
  });
}

/** 清除会话 Cookie（兼容旧名与新名） */
export function clearSessionCookie(reply, config) {
  const names = new Set([COOKIE_NAME, '__Host-partbin_sid']);
  if (config) names.add(sessionCookieName(config));
  for (const name of names) reply.clearCookie(name, { path: '/' });
}
