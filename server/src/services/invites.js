import { createHash } from 'node:crypto';
import { ERROR } from '../lib/errors.js';
import { randomBase32 } from '../lib/crypto.js';
import { nowIso } from '../lib/time.js';
import { requireInt, optionalString } from '../lib/validate.js';

function hashInviteCode(code) {
  return createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
}

function normalizeCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

function generateCode() {
  const raw = randomBase32(12);
  return `PB-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function publicInvite(row) {
  const expired = row.expires_at <= nowIso();
  const exhausted = Number(row.used_count) >= Number(row.max_uses);
  return {
    id: Number(row.id),
    role: row.role,
    maxUses: Number(row.max_uses),
    usedCount: Number(row.used_count),
    note: row.note ?? null,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null,
    status: expired ? 'expired' : exhausted ? 'exhausted' : 'active',
  };
}

/** 生成邀请码；明文只返回这一次 */
export function createInvite(db, { maxUses = 1, expiresInHours = 168, note = null, role = 'user', createdBy }) {
  const uses = requireInt(maxUses, '可用次数', { min: 1, max: 100 });
  const hours = requireInt(expiresInHours, '有效期（小时）', { min: 1, max: 24 * 30 });
  if (role !== 'user' && role !== 'admin') throw ERROR.validation('邀请角色不合法');
  const cleanNote = optionalString(note, '备注', { max: 200 });

  const code = generateCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();

  const inserted = db
    .prepare(
      `INSERT INTO invite (code_hash, role, max_uses, used_count, note, created_by, expires_at, created_at)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(hashInviteCode(code), role, uses, cleanNote, createdBy, expiresAt, now.toISOString());

  const row = db
    .prepare(
      `SELECT i.*, u.username AS created_by_name FROM invite i JOIN user u ON u.id = i.created_by WHERE i.id = ?`,
    )
    .get(inserted.lastInsertRowid);

  return { invite: publicInvite(row), code };
}

export function listInvites(db) {
  return db
    .prepare(
      `SELECT i.*, u.username AS created_by_name FROM invite i JOIN user u ON u.id = i.created_by
       ORDER BY i.created_at DESC, i.id DESC LIMIT 200`,
    )
    .all()
    .map(publicInvite);
}

export function revokeInvite(db, id) {
  const row = db.prepare('SELECT * FROM invite WHERE id = ?').get(id);
  if (!row) throw ERROR.notFound('邀请码不存在');
  db.prepare('DELETE FROM invite WHERE id = ?').run(id);
  return { ok: true };
}

/** 校验并消费邀请码；在校验注册事务中调用，返回邀请行 */
export function consumeInvite(db, code) {
  const normalized = normalizeCode(code);
  if (!normalized) throw ERROR.validation('请输入邀请码');

  const row = db
    .prepare('SELECT * FROM invite WHERE code_hash = ?')
    .get(hashInviteCode(normalized));
  if (!row) throw ERROR.validation('邀请码无效');
  if (row.expires_at <= nowIso()) throw ERROR.validation('邀请码已过期');
  if (Number(row.used_count) >= Number(row.max_uses)) throw ERROR.validation('邀请码已用完');

  db.prepare('UPDATE invite SET used_count = used_count + 1 WHERE id = ?').run(row.id);
  return row;
}
