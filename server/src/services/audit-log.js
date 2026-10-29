import { nowIso } from '../lib/time.js';

/** 写审计；不修改、不删除。detail 会被序列化为 JSON */
export function recordAudit(db, { actorId = null, action, targetType = null, targetId = null, detail = null, ipHash = null }) {
  db.prepare(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    actorId,
    action,
    targetType,
    targetId == null ? null : String(targetId),
    detail == null ? null : JSON.stringify(detail),
    ipHash,
    nowIso(),
  );
}
