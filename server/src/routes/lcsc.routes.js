import { ERROR } from '../lib/errors.js';
import { requireId } from '../lib/validate.js';
import { lookupLcsc } from '../services/lcsc.js';
import { matchItemLcsc } from '../services/items.js';

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
}
