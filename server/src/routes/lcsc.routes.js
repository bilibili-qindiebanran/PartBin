import { ERROR } from '../lib/errors.js';
import { requireId } from '../lib/validate.js';
import { lookupLcsc } from '../services/lcsc.js';
import { matchItemLcsc } from '../services/items.js';
import { commitQuickIn, previewQuickIn } from '../services/quick-in.js';
import { linkItemLcsc, previewReconcile } from '../services/reconcile.js';

/**
 * 立创料号匹配：查询上游并把结果补进物料。
 * 查询失败不写入任何数据，前端可继续手工填写。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function lcscRoutes(app) {
  const { db, config } = app;

  function guard(request) {
    const key = request.ipHash ?? request.ip;
    const result = app.limiters.lcsc.hit(key);
    if (!result.ok) {
      throw ERROR.rateLimited('查询太频繁，请稍后再试', result.retryAfter);
    }
  }

  function options(request) {
    return {
      fetchImpl: app.lcscFetch,
      apiBase: config.lcscApiBase,
      timeoutMs: config.lcscTimeoutMs,
      cacheDays: config.lcscCacheDays,
      refresh: request.body?.refresh === true,
    };
  }

  app.post('/api/lcsc/lookup', { preHandler: app.requireAdmin }, async (request) => {
    guard(request);
    return lookupLcsc(db, request.body?.code, options(request));
  });

  app.post('/api/items/:id/lcsc', { preHandler: app.requireAdmin }, async (request) => {
    guard(request);
    return matchItemLcsc(db, requireId(request.params.id, '物料'), {
      ...options(request),
      code: request.body?.code,
      userId: request.user.id,
    });
  });

  /** 快速入库预览：扫码后查立创信息 + 判断库存里是否已有同料号物料 */
  app.post('/api/lcsc/quick-in/preview', { preHandler: app.requireAdmin }, async (request) =>
    previewQuickIn(db, request.body?.code, options(request)),
  );

  /** 快速入库提交：mode=add 累加到已有物料，mode=create 新建物料 */
  app.post('/api/lcsc/quick-in', { preHandler: app.requireAdmin }, async (request, reply) => {
    const result = commitQuickIn(db, request.body ?? {}, request.user.id);
    return reply.code(result.created ? 201 : 200).send(result);
  });

  /** 快速对料预览：扫码后查库内对应物料，没有就给可能的候选 */
  app.post('/api/lcsc/reconcile/preview', { preHandler: app.requireAdmin }, async (request) => {
    guard(request);
    return previewReconcile(db, request.body?.code, options(request));
  });

  /** 手动匹配：把料号绑定到已有物料（已有别的料号则拒绝） */
  app.post('/api/lcsc/reconcile/link', { preHandler: app.requireAdmin }, async (request) =>
    linkItemLcsc(
      db,
      { code: request.body?.code, itemId: request.body?.itemId },
      request.user.id,
    ),
  );
}
