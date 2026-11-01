import { ERROR } from '../lib/errors.js';
import { matchBom } from '../services/bom.js';

const MAX_BOM_BYTES = 4 * 1024 * 1024;

/**
 * BOM 匹配接口：只读，登录用户即可使用。
 * 支持 multipart 上传（.csv / .xlsx）与 JSON（{ csvText }）。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function bomRoutes(app) {
  const { db } = app;

  app.post('/api/bom/preview', { preHandler: app.authenticate }, async (request) => {
    const sets = request.query?.sets ?? request.body?.sets;

    if (request.isMultipart()) {
      let part;
      try {
        part = await request.file();
      } catch {
        throw ERROR.validation('没有收到 BOM 文件');
      }
      if (!part) throw ERROR.validation('没有收到 BOM 文件');

      let buffer;
      try {
        buffer = await part.toBuffer();
      } catch (error) {
        if (String(error.code).includes('FILE_TOO_LARGE') || String(error.message).includes('too large')) {
          throw ERROR.payloadTooLarge('BOM 文件不能超过 4MB');
        }
        throw error;
      }
      if (buffer.length > MAX_BOM_BYTES) throw ERROR.payloadTooLarge('BOM 文件不能超过 4MB');

      // fastify-multipart 会把普通字段放进 part.fields
      const fieldSets = part.fields?.sets?.value;
      return matchBom(db, {
        buffer,
        filename: part.filename,
        sets: fieldSets ?? sets,
      });
    }

    const text = typeof request.body?.csvText === 'string' ? request.body.csvText : null;
    if (!text) throw ERROR.validation('请上传 BOM 文件，或在 csvText 中提供内容');
    if (Buffer.byteLength(text) > MAX_BOM_BYTES) throw ERROR.payloadTooLarge('BOM 文件不能超过 4MB');

    return matchBom(db, { text, sets });
  });
}
