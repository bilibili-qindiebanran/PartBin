import { requireId } from '../lib/validate.js';
import {
  createInstance,
  createInstancesBatch,
  listInstances,
  removeInstance,
  updateInstance,
} from '../services/instances.js';

/**
 * 实例接口：读取需登录，写操作需管理员。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function instanceRoutes(app) {
  const { db } = app;

  app.get('/api/items/:id/instances', { preHandler: app.authenticate }, async (request) => ({
    data: listInstances(db, requireId(request.params.id, '物料')),
  }));

  app.post('/api/items/:id/instances', { preHandler: app.requireAdmin }, async (request, reply) => {
    const instance = createInstance(db, requireId(request.params.id, '物料'), request.body ?? {}, request.user.id);
    return reply.code(201).send({ instance });
  });

  app.post('/api/items/:id/instances/batch', { preHandler: app.requireAdmin }, async (request, reply) => {
    const instances = createInstancesBatch(
      db,
      requireId(request.params.id, '物料'),
      request.body ?? {},
      request.user.id,
    );
    return reply.code(201).send({ instances });
  });

  app.patch('/api/instances/:id', { preHandler: app.requireAdmin }, async (request) => ({
    instance: updateInstance(db, requireId(request.params.id, '实例'), request.body ?? {}, request.user.id),
  }));

  app.delete('/api/instances/:id', { preHandler: app.requireAdmin }, async (request) => ({
    instance: removeInstance(db, requireId(request.params.id, '实例'), request.user.id),
  }));
}
