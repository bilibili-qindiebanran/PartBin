import { requireId } from '../lib/validate.js';
import {
  createLocation,
  listLocations,
  removeLocation,
  updateLocation,
} from '../services/locations.js';

/**
 * 位置树接口：读取需登录，写操作需管理员。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function locationRoutes(app) {
  const { db } = app;

  app.get('/api/locations', { preHandler: app.authenticate }, async () => ({
    data: listLocations(db),
  }));

  app.post('/api/locations', { preHandler: app.requireAdmin }, async (request, reply) => {
    const location = createLocation(db, request.body ?? {});
    return reply.code(201).send({ location });
  });

  app.patch('/api/locations/:id', { preHandler: app.requireAdmin }, async (request) => ({
    location: updateLocation(db, requireId(request.params.id, '位置'), request.body ?? {}),
  }));

  app.delete('/api/locations/:id', { preHandler: app.requireAdmin }, async (request) =>
    removeLocation(db, requireId(request.params.id, '位置')),
  );
}
