import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { withTransaction } from '../db/connection.js';
import { ERROR } from '../lib/errors.js';
import { detectImageType, MAX_PHOTO_BYTES } from '../lib/image.js';
import { nowIso } from '../lib/time.js';
import { requireId } from '../lib/validate.js';

function publicPhoto(row) {
  return {
    id: Number(row.id),
    mime: row.mime,
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    createdAt: row.created_at,
  };
}

/** 保存图片；按 sha256 去重，文件名由服务端生成 */
export function savePhoto(db, dataDir, buffer) {
  if (!buffer || buffer.length === 0) throw ERROR.validation('图片内容为空');
  if (buffer.length > MAX_PHOTO_BYTES) throw ERROR.payloadTooLarge('图片不能超过 8MB');

  const signature = detectImageType(buffer);
  if (!signature) throw ERROR.unsupportedMedia('只支持 JPEG / PNG / WebP');

  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const existing = db.prepare('SELECT * FROM photo WHERE sha256 = ? LIMIT 1').get(sha256);
  if (existing) return publicPhoto(existing);

  const month = new Date().toISOString().slice(0, 7).replace('-', '');
  const directory = path.join(dataDir, 'uploads', month);
  fs.mkdirSync(directory, { recursive: true });

  const filename = `${randomUUID()}${signature.ext}`;
  const relativePath = `${month}/${filename}`;
  fs.writeFileSync(path.join(directory, filename), buffer);

  const inserted = db
    .prepare(
      'INSERT INTO photo (rel_path, mime, byte_size, sha256, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(relativePath, signature.mime, buffer.length, sha256, nowIso());

  return publicPhoto(db.prepare('SELECT * FROM photo WHERE id = ?').get(inserted.lastInsertRowid));
}

export function getPhoto(db, dataDir, id) {
  const row = db.prepare('SELECT * FROM photo WHERE id = ?').get(id);
  if (!row) throw ERROR.notFound('照片不存在');
  const absolutePath = path.join(dataDir, 'uploads', row.rel_path);
  if (!fs.existsSync(absolutePath)) throw ERROR.notFound('照片文件不存在');
  return { photo: row, absolutePath };
}

export function listItemPhotos(db, itemId) {
  return db
    .prepare(
      `SELECT p.* FROM item_photo ip
       JOIN photo p ON p.id = ip.photo_id
       WHERE ip.item_id = ?
       ORDER BY ip.sort_order ASC, ip.photo_id ASC`,
    )
    .all(itemId)
    .map(publicPhoto);
}

function referenced(db, photoId) {
  const itemRef = Number(
    db.prepare('SELECT COUNT(*) AS c FROM item_photo WHERE photo_id = ?').get(photoId).c,
  );
  const instanceRef = Number(
    db.prepare('SELECT COUNT(*) AS c FROM item_instance WHERE photo_id = ?').get(photoId).c,
  );
  return itemRef + instanceRef > 0;
}

export function deletePhoto(db, dataDir, photoId) {
  const row = db.prepare('SELECT * FROM photo WHERE id = ?').get(photoId);
  if (!row) throw ERROR.notFound('照片不存在');
  if (referenced(db, photoId)) throw ERROR.conflict('照片仍被物料或实例引用');

  db.prepare('DELETE FROM photo WHERE id = ?').run(photoId);
  const absolutePath = path.join(dataDir, 'uploads', row.rel_path);
  try {
    fs.unlinkSync(absolutePath);
  } catch {
    // 文件已不存在时忽略
  }
  return { ok: true };
}

/** 全量替换物料相册顺序；被移出且无其他引用的照片会一并删除 */
export function setItemPhotos(db, itemId, photoIds, userId) {
  const item = db.prepare('SELECT id FROM item WHERE id = ?').get(itemId);
  if (!item) throw ERROR.notFound('物料不存在');
  if (!Array.isArray(photoIds)) throw ERROR.validation('photoIds 必须是数组');

  const ids = [...new Set(photoIds.map((id) => requireId(id, '照片')))];
  for (const id of ids) {
    const exists = db.prepare('SELECT id FROM photo WHERE id = ?').get(id);
    if (!exists) throw ERROR.validation(`照片 ${id} 不存在`);
  }

  const oldIds = db
    .prepare('SELECT photo_id FROM item_photo WHERE item_id = ?')
    .all(itemId)
    .map((row) => Number(row.photo_id));
  const removed = oldIds.filter((id) => !ids.includes(id));
  const filesToDelete = [];

  const photos = withTransaction(db, () => {
    db.prepare('DELETE FROM item_photo WHERE item_id = ?').run(itemId);
    const insert = db.prepare('INSERT INTO item_photo (item_id, photo_id, sort_order) VALUES (?, ?, ?)');
    ids.forEach((photoId, index) => insert.run(itemId, photoId, index));

    db.prepare('UPDATE item SET updated_by = ?, updated_at = ? WHERE id = ?').run(
      userId,
      nowIso(),
      itemId,
    );

    for (const photoId of removed) {
      if (referenced(db, photoId)) continue;
      const row = db.prepare('SELECT * FROM photo WHERE id = ?').get(photoId);
      if (!row) continue;
      db.prepare('DELETE FROM photo WHERE id = ?').run(photoId);
      filesToDelete.push(row.rel_path);
    }

    return listItemPhotos(db, itemId);
  });

  return { photos, removedFiles: filesToDelete };
}

/** 路由层在事务提交后删除磁盘文件 */
export function removePhotoFiles(dataDir, relativePaths) {
  for (const relativePath of relativePaths) {
    try {
      fs.unlinkSync(path.join(dataDir, 'uploads', relativePath));
    } catch {
      // 忽略缺失文件
    }
  }
}
