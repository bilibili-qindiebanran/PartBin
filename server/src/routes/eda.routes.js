import { timingSafeEqual } from 'node:crypto';
import { AppError, ERROR } from '../lib/errors.js';
import { lookupParts } from '../services/bom.js';

/**
 * EDA（立创专业版）插件只读查料接口。
 *
 * 唯一端点 POST /api/eda/lookup：
 * - 鉴权用固定 Header `X-Api-Key`（EDA 页面在别的 origin，拿不到同源 Cookie）
 * - 因此必须放行跨域，并在 app.js 的同源校验里豁免 /api/eda/
 * - 只读，不写库、不记流水，不受会话与角色影响
 */

const MAX_ITEMS = 500;
/** 单次查询上限之外的 body 大小保护 */
const MAX_BODY_BYTES = 512 * 1024;

const UNAUTHORIZED = 'UNAUTHORIZED';

function corsHeaders(config) {
  const origin = config.edaAllowedOrigin || '*';
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
    'Access-Control-Max-Age': '600',
    // 默认安全头是 same-origin，这里必须显式放开，否则浏览器侧仍会拦截
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
  if (origin !== '*') headers.Vary = 'Origin';
  return headers;
}

/** 定长比较，避免用 === 比较密钥 */
function safeEqual(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export default async function edaRoutes(app) {
  const { db, config } = app;
  const cors = corsHeaders(config);

  const applyCors = (reply) => {
    for (const [name, value] of Object.entries(cors)) reply.header(name, value);
  };

  // CORS 预检：不带任何业务逻辑，也不校验密钥
  app.options('/api/eda/lookup', async (request, reply) => {
    applyCors(reply);
    return reply.code(204).send();
  });

  app.post('/api/eda/lookup', async (request, reply) => {
    applyCors(reply);

    // 没配置密钥视为未启用，避免空字符串被当成有效密钥
    if (!config.edaApiKey) {
      throw new AppError('EDA_DISABLED', 503, 'EDA 查料接口未启用，请先设置 EDA_API_KEY');
    }

    const provided = request.headers['x-api-key'];
    if (typeof provided !== 'string' || !safeEqual(provided, config.edaApiKey)) {
      throw new AppError(UNAUTHORIZED, 401, 'API Key 不正确');
    }

    const limited = app.limiters.eda.hit(request.ipHash ?? String(request.ip));
    if (!limited.ok) {
      throw ERROR.rateLimited('查询太频繁，请稍后再试', limited.retryAfter);
    }

    const body = request.body;
    if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
      throw ERROR.validation('请求体需为 { "items": [...] }');
    }
    if (body.items.length > MAX_ITEMS) {
      throw ERROR.payloadTooLarge(`单次最多查询 ${MAX_ITEMS} 条，请分片后重试`);
    }
    if (request.headers['content-length'] && Number(request.headers['content-length']) > MAX_BODY_BYTES) {
      throw ERROR.payloadTooLarge('请求体过大');
    }

    return { items: lookupParts(db, body.items, { options: body.options, limit: body.limit }) };
  });
}
