import fs from 'node:fs';
import { pingDatabase } from '../db/connection.js';

const packageJson = JSON.parse(
  fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);
const startedAt = Date.now();

/**
 * 公开元信息：健康检查。不返回配置、路径或账号数据。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function metaRoutes(app) {
  app.get('/health', async (request, reply) => {
    let db = 'ok';
    try {
      if (pingDatabase(app.db) !== 'ok') db = 'error';
      app.db.prepare('SELECT 1').get();
    } catch {
      db = 'error';
    }

    return reply.code(db === 'ok' ? 200 : 503).send({
      status: db === 'ok' ? 'ok' : 'error',
      db,
      version: packageJson.version,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  });
}
