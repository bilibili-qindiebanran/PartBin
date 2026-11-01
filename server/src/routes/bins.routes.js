import { getBin, getBinsOverview, listBins, reorderBins } from '../services/bins.js';

/**
 * 元件盒接口：查询需登录，排序需管理员。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function binRoutes(app) {
  const { db } = app;

  app.get('/api/bins', { preHandler: app.authenticate }, async (request) => ({
    data: listBins(db, request.query ?? {}),
  }));

  app.get('/api/bins/overview', { preHandler: app.authenticate }, async () => ({
    data: getBinsOverview(db),
  }));

  app.get('/api/bins/:id', { preHandler: app.authenticate }, async (request) =>
    getBin(db, request.params.id),
  );

  app.post('/api/bins/reorder', { preHandler: app.requireAdmin }, async (request) =>
    reorderBins(db, request.body?.ids),
  );
}
