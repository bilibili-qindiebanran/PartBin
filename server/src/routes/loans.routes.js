import { requireId } from '../lib/validate.js';
import { cancelLoan, createLoan, listLoans, returnLoan } from '../services/loans.js';

/**
 * 借还接口：读取需登录，写操作需管理员。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function loanRoutes(app) {
  const { db } = app;

  app.get('/api/loans', { preHandler: app.authenticate }, async (request) =>
    listLoans(db, request.query),
  );

  app.post('/api/loans', { preHandler: app.requireAdmin }, async (request, reply) => {
    const result = createLoan(db, request.body ?? {}, request.user.id);
    return reply.code(201).send(result);
  });

  app.post('/api/loans/:id/return', { preHandler: app.requireAdmin }, async (request) => {
    const result = returnLoan(db, requireId(request.params.id, '借出'), request.body ?? {}, request.user.id);
    return { loan: result.loan, remaining: result.remaining };
  });

  app.delete('/api/loans/:id', { preHandler: app.requireAdmin }, async (request) =>
    cancelLoan(db, requireId(request.params.id, '借出')),
  );
}
