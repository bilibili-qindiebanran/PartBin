import { requireId } from '../lib/validate.js';
import { createInvite, listInvites, revokeInvite } from '../services/invites.js';
import { recordAudit } from '../services/audit-log.js';

/**
 * 邀请码管理：仅管理员，创建/撤销需要 10 分钟内重新验证密码。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function inviteRoutes(app) {
  const { db } = app;

  app.get('/api/invites', { preHandler: app.requireAdmin }, async () => ({
    data: listInvites(db),
  }));

  app.post(
    '/api/invites',
    { preHandler: [app.requireAdmin, app.requireReauth] },
    async (request, reply) => {
      const result = createInvite(db, {
        ...(request.body ?? {}),
        createdBy: request.user.id,
      });
      recordAudit(db, {
        actorId: request.user.id,
        action: 'invite.create',
        targetType: 'invite',
        targetId: result.invite.id,
        detail: {
          role: result.invite.role,
          maxUses: result.invite.maxUses,
          expiresAt: result.invite.expiresAt,
        },
        ipHash: request.ipHash,
      });
      return reply.code(201).send(result);
    },
  );

  app.delete(
    '/api/invites/:id',
    { preHandler: [app.requireAdmin, app.requireReauth] },
    async (request) => {
      const id = requireId(request.params.id, '邀请码');
      const result = revokeInvite(db, id);
      recordAudit(db, {
        actorId: request.user.id,
        action: 'invite.revoke',
        targetType: 'invite',
        targetId: id,
        ipHash: request.ipHash,
      });
      return result;
    },
  );
}
