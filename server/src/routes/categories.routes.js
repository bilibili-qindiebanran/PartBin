import { requireId } from '../lib/validate.js';
import {
  createCategory,
  listCategories,
  removeCategory,
  updateCategory,
} from '../services/categories.js';

/**
 * 分类树接口：读取需登录，写操作需管理员。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function categoryRoutes(app) {
  const { db } = app;

  app.get('/api/categories', { preHandler: app.authenticate }, async () => ({
    data: listCategories(db),
  }));

  app.post('/api/categories', { preHandler: app.requireAdmin }, async (request, reply) => {
    const category = createCategory(db, request.body ?? {});
    return reply.code(201).send({ category });
  });

  app.patch('/api/categories/:id', { preHandler: app.requireAdmin }, async (request) => ({
    category: updateCategory(db, requireId(request.params.id, '分类'), request.body ?? {}),
  }));

  app.delete('/api/categories/:id', { preHandler: app.requireAdmin }, async (request) =>
    removeCategory(db, requireId(request.params.id, '分类')),
  );
}
