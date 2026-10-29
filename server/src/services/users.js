import { withTransaction } from '../db/connection.js';
import { ERROR } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { normalizeUsername, requirePassword, requireUsername } from '../lib/validate.js';
import { nowIso } from '../lib/time.js';
import { consumeInvite } from './invites.js';

/** 数据库行 → 对外用户对象（不含密码哈希） */
export function toPublicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    role: row.role,
    isActive: Number(row.is_active) === 1,
    lastLoginAt: row.last_login_at ?? null,
    createdAt: row.created_at,
  };
}

/**
 * 创建普通用户（开放注册 / 管理员建号），不修改注册开关。
 */
export function createUser(db, { username, password, role = 'user' }) {
  const cleanName = requireUsername(username);
  requirePassword(password, { username: cleanName });
  if (role !== 'user' && role !== 'admin') throw ERROR.validation('角色不合法');
  const passwordHash = hashPassword(password);
  const usernameNorm = normalizeUsername(cleanName);
  const now = nowIso();

  if (db.prepare('SELECT id FROM user WHERE username_norm = ?').get(usernameNorm)) {
    throw ERROR.usernameTaken();
  }

  const inserted = db
    .prepare(
      `INSERT INTO user (username, username_norm, password_hash, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(cleanName, usernameNorm, passwordHash, role, now, now);

  return toPublicUser(db.prepare('SELECT * FROM user WHERE id = ?').get(inserted.lastInsertRowid));
}

/**
 * 凭邀请码注册；消费邀请与建号在同一事务内。
 */
export function registerWithInvite(db, { username, password, inviteCode }) {
  const cleanName = requireUsername(username);
  requirePassword(password, { username: cleanName });
  const passwordHash = hashPassword(password);
  const usernameNorm = normalizeUsername(cleanName);

  return withTransaction(db, () => {
    if (db.prepare('SELECT id FROM user WHERE username_norm = ?').get(usernameNorm)) {
      throw ERROR.usernameTaken();
    }
    const invite = consumeInvite(db, inviteCode);
    const now = nowIso();
    const inserted = db
      .prepare(
        `INSERT INTO user (username, username_norm, password_hash, role, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(cleanName, usernameNorm, passwordHash, invite.role, now, now);

    return {
      user: toPublicUser(db.prepare('SELECT * FROM user WHERE id = ?').get(inserted.lastInsertRowid)),
      inviteRole: invite.role,
    };
  });
}

/** 按规范化用户名查找（含密码哈希，仅服务端使用） */
export function findByUsernameNorm(db, usernameNorm) {
  return db.prepare('SELECT * FROM user WHERE username_norm = ?').get(usernameNorm);
}

/** 按 id 查找（含密码哈希） */
export function findById(db, id) {
  return db.prepare('SELECT * FROM user WHERE id = ?').get(id);
}

/** 用户列表（管理员用） */
export function listUsers(db) {
  return db.prepare('SELECT * FROM user ORDER BY id ASC').all().map(toPublicUser);
}

/** 记录最近登录时间 */
export function setLastLogin(db, userId) {
  db.prepare('UPDATE user SET last_login_at = ?, updated_at = ? WHERE id = ?').run(
    nowIso(),
    nowIso(),
    userId,
  );
}

/**
 * 修改角色或启用状态。
 * 规则：不能禁用自己；不能失去最后一个启用的管理员；禁用后立即吊销该用户会话。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ id: number, role?: 'admin'|'user', isActive?: boolean, actorId: number }} input
 */
export function updateUser(db, { id, role, isActive, actorId }) {
  return withTransaction(db, () => {
    const target = db.prepare('SELECT * FROM user WHERE id = ?').get(id);
    if (!target) throw ERROR.notFound('用户不存在');

    const nextRole = role ?? target.role;
    const nextActive = isActive === undefined ? Number(target.is_active) === 1 : isActive;

    if (Number(target.id) === Number(actorId) && nextActive === false) {
      throw ERROR.cannotDisableSelf();
    }

    const losesAdmin =
      target.role === 'admin' &&
      Number(target.is_active) === 1 &&
      (nextRole !== 'admin' || !nextActive);

    if (losesAdmin) {
      const activeAdmins = Number(
        db.prepare("SELECT COUNT(*) AS c FROM user WHERE role = 'admin' AND is_active = 1").get().c,
      );
      if (activeAdmins <= 1) throw ERROR.lastAdmin();
    }

    db.prepare('UPDATE user SET role = ?, is_active = ?, updated_at = ? WHERE id = ?').run(
      nextRole,
      nextActive ? 1 : 0,
      nowIso(),
      id,
    );

    if (!nextActive) db.prepare('DELETE FROM session WHERE user_id = ?').run(id);

    const updated = db.prepare('SELECT * FROM user WHERE id = ?').get(id);
    return toPublicUser(updated);
  });
}

/** 用户修改自己的密码（需验证当前密码） */
export function changePassword(db, { userId, currentPassword, newPassword }) {
  const row = findById(db, userId);
  if (!row) throw ERROR.notFound('用户不存在');
  if (!verifyPassword(currentPassword, row.password_hash)) {
    throw ERROR.validation('当前密码不正确');
  }
  requirePassword(newPassword, { username: row.username });

  db.prepare('UPDATE user SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(newPassword),
    nowIso(),
    userId,
  );
}

/** 管理员重置某用户密码；返回目标用户行（调用方负责吊销会话） */
export function resetPassword(db, { userId, newPassword }) {
  const row = findById(db, userId);
  if (!row) throw ERROR.notFound('用户不存在');
  requirePassword(newPassword, { username: row.username });

  db.prepare('UPDATE user SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(newPassword),
    nowIso(),
    userId,
  );
  return row;
}

/**
 * 直接创建管理员（CLI 初始化 / 测试使用），不依赖注册开关。
 */
export function createAdmin(db, { username, password }) {
  const cleanName = requireUsername(username);
  requirePassword(password, { username: cleanName });
  const usernameNorm = normalizeUsername(cleanName);
  const now = nowIso();

  if (db.prepare('SELECT id FROM user WHERE username_norm = ?').get(usernameNorm)) {
    throw ERROR.usernameTaken();
  }

  const inserted = db
    .prepare(
      `INSERT INTO user (username, username_norm, password_hash, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'admin', 1, ?, ?)`,
    )
    .run(cleanName, usernameNorm, hashPassword(password), now, now);

  return toPublicUser(db.prepare('SELECT * FROM user WHERE id = ?').get(inserted.lastInsertRowid));
}
