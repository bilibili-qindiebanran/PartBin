import { requireId } from '../lib/validate.js';
import {
  listItemMovements,
  listMovements,
  recordMovement,
} from '../services/movements.js';
import { getStats } from '../services/stats.js';

/**
 * 出入库流水接口：读取需登录，写入需管理员。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function movementRoutes(app) {
  const { db } = app;

  app.get('/api/movements', { preHandler: app.authenticate }, async (request) =>
    listMovements(db, request.query),
  );

  app.get('/api/items/:id/movements', { preHandler: app.authenticate }, async (request) =>
    listItemMovements(db, requireId(request.params.id, '物料'), request.query),
  );

  app.post('/api/items/:id/movements', { preHandler: app.requireAdmin }, async (request, reply) => {
    const itemId = requireId(request.params.id, '物料');
    const result = recordMovement(db, {
      ...(request.body ?? {}),
      itemId,
      userId: request.user.id,
    });
    return reply.code(201).send(result);
  });

  app.get('/api/stats', { preHandler: app.authenticate }, async () => getStats(db));
}
