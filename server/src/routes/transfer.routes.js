import { ERROR } from '../lib/errors.js';
import {
  commitImport,
  exportItemsCsv,
  exportLoansCsv,
  exportMovementsCsv,
  previewImport,
} from '../services/transfer.js';

function sendCsv(reply, filename, content) {
  reply.header('Content-Type', 'text/csv; charset=utf-8');
  reply.header('Content-Disposition', `attachment; filename="${filename}"`);
  reply.header('Cache-Control', 'no-store');
  return reply.send(content);
}

async function readCsv(request) {
  if (request.isMultipart()) {
    let part;
    try {
      part = await request.file();
    } catch {
      throw ERROR.validation('没有收到 CSV 文件');
    }
    if (!part) throw ERROR.validation('没有收到 CSV 文件');
    const buffer = await part.toBuffer();
    if (buffer.length > 2 * 1024 * 1024) throw ERROR.payloadTooLarge('CSV 不能超过 2MB');
    return buffer.toString('utf8');
  }

  if (typeof request.body === 'string') return request.body;
  if (typeof request.body?.csvText === 'string') return request.body.csvText;

  throw ERROR.validation('请上传 CSV 文件');
}

/**
 * CSV 导入导出。导入仅管理员，导出所有登录用户可用。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function transferRoutes(app) {
  const { db } = app;

  app.post('/api/import/preview', { preHandler: app.requireAdmin }, async (request) =>
    previewImport(db, await readCsv(request)),
  );

  app.post('/api/import/commit', { preHandler: app.requireAdmin }, async (request) => {
    const summary = commitImport(db, await readCsv(request), request.user.id);
    return { summary };
  });

  app.get('/api/export/items.csv', { preHandler: app.authenticate }, async (request, reply) =>
    sendCsv(reply, 'partbin-items.csv', exportItemsCsv(db)),
  );

  app.get('/api/export/movements.csv', { preHandler: app.authenticate }, async (request, reply) =>
    sendCsv(reply, 'partbin-movements.csv', exportMovementsCsv(db)),
  );

  app.get('/api/export/loans.csv', { preHandler: app.authenticate }, async (request, reply) =>
    sendCsv(reply, 'partbin-loans.csv', exportLoansCsv(db)),
  );
}
