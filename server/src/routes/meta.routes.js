import fs from 'node:fs';
import { pingDatabase } from '../db/connection.js';

const packageJson = JSON.parse(
  fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);

/**
 * 公开元信息：健康检查。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function metaRoutes(app) {
  app.get('/health', async () => ({
    status: 'ok',
    db: pingDatabase(app.db),
    version: packageJson.version,
  }));
}
