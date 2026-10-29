import { requireId } from '../lib/validate.js';
import {
  createItem,
  getItem,
  listItems,
  setItemArchived,
  updateItem,
} from '../services/items.js';

/**
 * 物料接口：读取需登录，写操作需管理员。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function itemRoutes(app) {
  const { db } = app;

  app.get('/api/items', { preHandler: app.authenticate }, async (request) =>
    listItems(db, request.query),
  );

  app.post('/api/items', { preHandler: app.requireAdmin }, async (request, reply) => {
    const item = createItem(db, request.body ?? {}, request.user.id);
    return reply.code(201).send({ item });
  });

  app.get('/api/items/:id', { preHandler: app.authenticate }, async (request) => ({
    item: getItem(db, requireId(request.params.id, '物料')),
  }));

  app.patch('/api/items/:id', { preHandler: app.requireAdmin }, async (request) => ({
    item: updateItem(db, requireId(request.params.id, '物料'), request.body ?? {}, request.user.id),
  }));

  app.delete('/api/items/:id', { preHandler: app.requireAdmin }, async (request) => ({
    item: setItemArchived(db, requireId(request.params.id, '物料'), true, request.user.id),
  }));

  app.post('/api/items/:id/restore', { preHandler: app.requireAdmin }, async (request) => ({
    item: setItemArchived(db, requireId(request.params.id, '物料'), false, request.user.id),
  }));
}
