import { ERROR } from '../lib/errors.js';
import { requireBoolean, requireId, requirePassword } from '../lib/validate.js';
import { listUsers, resetPassword, toPublicUser, updateUser, findById } from '../services/users.js';
import { deleteSessionsForUser, clearSessionCookie } from '../services/sessions.js';

/**
 * 用户管理路由（仅管理员）。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function userRoutes(app) {
  const { db } = app;

  app.get('/api/users', { preHandler: app.requireAdmin }, async () => ({
    data: listUsers(db),
  }));

  app.patch('/api/users/:id', { preHandler: app.requireAdmin }, async (request) => {
    const id = requireId(request.params.id, '用户 ID');
    const body = request.body ?? {};

    const patch = { id, actorId: request.user.id };
    if (body.role !== undefined) {
      if (body.role !== 'admin' && body.role !== 'user') {
        throw ERROR.validation('角色只能是 admin 或 user');
      }
      patch.role = body.role;
    }
    if (body.isActive !== undefined) {
      patch.isActive = requireBoolean(body.isActive, '启用状态');
    }
    if (patch.role === undefined && patch.isActive === undefined) {
      throw ERROR.validation('没有需要更新的字段');
    }

    return { user: updateUser(db, patch) };
  });

  app.post('/api/users/:id/reset-password', { preHandler: app.requireAdmin }, async (request, reply) => {
    const id = requireId(request.params.id, '用户 ID');
    const newPassword = requirePassword(request.body?.newPassword, {
      username: findById(db, id)?.username,
    });

    resetPassword(db, { userId: id, newPassword });
    deleteSessionsForUser(db, id);

    const isSelf = id === request.user.id;
    if (isSelf) clearSessionCookie(reply);

    return { ok: true, mustRelogin: isSelf, user: toPublicUser(findById(db, id)) };
  });
}
