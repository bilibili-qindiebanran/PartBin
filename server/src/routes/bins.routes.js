import { getBin, listBins } from '../services/bins.js';

/**
 * 元件盒接口：只读，登录即可访问。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function binRoutes(app) {
  const { db } = app;

  app.get('/api/bins', { preHandler: app.authenticate }, async (request) => ({
    data: listBins(db, request.query ?? {}),
  }));

  app.get('/api/bins/:id', { preHandler: app.authenticate }, async (request) =>
    getBin(db, request.params.id),
  );
}
