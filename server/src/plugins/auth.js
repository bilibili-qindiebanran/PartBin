import { ERROR } from '../lib/errors.js';
import { clearSessionCookie, COOKIE_NAME, findSession, touchSession } from '../services/sessions.js';

/**
 * 在根实例上安装鉴权：解析 Cookie 会话、挂 request.user、提供 authenticate / requireAdmin。
 * 不使用 fastify-plugin 封装，保证装饰器对后续注册的路由可见。
 * @param {import('fastify').FastifyInstance} app
 */
export function installAuth(app) {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;

    const token = request.cookies?.[COOKIE_NAME];
    if (!token) return;

    const session = findSession(app.db, token);
    if (!session) {
      clearSessionCookie(reply);
      return;
    }

    request.user = session.user;
    request.sessionId = session.sessionId;
    touchSession(app.db, session, app.config.sessionDays);
  });

  app.decorate('authenticate', async (request) => {
    if (!request.user) throw ERROR.authRequired();
  });

  app.decorate('requireAdmin', async (request) => {
    if (!request.user) throw ERROR.authRequired();
    if (request.user.role !== 'admin') throw ERROR.forbidden('只读账号，请联系管理员');
  });
}
