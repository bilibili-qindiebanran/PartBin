import fs from 'node:fs';
import { ERROR } from '../lib/errors.js';
import { requireId } from '../lib/validate.js';
import {
  deletePhoto,
  getPhoto,
  removePhotoFiles,
  savePhoto,
  setItemPhotos,
} from '../services/photos.js';

/**
 * 照片接口：上传/删除/排序需管理员，读取需登录。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function photoRoutes(app) {
  const { db, config } = app;

  app.post('/api/photos', { preHandler: app.requireAdmin }, async (request, reply) => {
    if (!request.isMultipart()) throw ERROR.validation('请使用 multipart/form-data 上传图片');

    let part;
    try {
      part = await request.file();
    } catch {
      throw ERROR.validation('没有收到图片文件');
    }
    if (!part) throw ERROR.validation('没有收到图片文件');

    let buffer;
    try {
      buffer = await part.toBuffer();
    } catch (error) {
      if (String(error.code).includes('FILE_TOO_LARGE') || String(error.message).includes('too large')) {
        throw ERROR.payloadTooLarge('图片不能超过 8MB');
      }
      throw error;
    }
    if (part.file.truncated) throw ERROR.payloadTooLarge('图片不能超过 8MB');

    const photo = savePhoto(db, config.dataDir, buffer);
    return reply.code(201).send({ photo });
  });

  app.get('/api/photos/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { photo, absolutePath } = getPhoto(db, config.dataDir, requireId(request.params.id, '照片'));
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.type(photo.mime).send(fs.createReadStream(absolutePath));
  });

  app.delete('/api/photos/:id', { preHandler: app.requireAdmin }, async (request) =>
    deletePhoto(db, config.dataDir, requireId(request.params.id, '照片')),
  );

  app.put('/api/items/:id/photos', { preHandler: app.requireAdmin }, async (request) => {
    const itemId = requireId(request.params.id, '物料');
    const result = setItemPhotos(db, itemId, request.body?.photoIds ?? [], request.user.id);
    removePhotoFiles(config.dataDir, result.removedFiles);
    return { photos: result.photos };
  });
}
