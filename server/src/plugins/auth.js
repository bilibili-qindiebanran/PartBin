import { ERROR } from '../lib/errors.js';
import { hashIp } from '../lib/ip.js';
import {
  clearSessionCookie,
  findSession,
  sessionCookieName,
  touchSession,
} from '../services/sessions.js';

/**
 * 在根实例上安装鉴权：解析 Cookie 会话、挂 request.user、提供 authenticate / requireAdmin。
 * 不使用 fastify-plugin 封装，保证装饰器对后续注册的路由可见。
 * @param {import('fastify').FastifyInstance} app
 */
export function installAuth(app) {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);
  app.decorateRequest('sessionReauthAt', null);
  app.decorateRequest('ipHash', null);

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;

    request.ipHash = hashIp(request.ip, app.config.appSecret);
    const token = request.cookies?.[sessionCookieName(app.config)];
    if (!token) return;

    const session = findSession(app.db, token);
    if (!session) {
      clearSessionCookie(reply, app.config);
      return;
    }

    request.user = session.user;
    request.sessionId = session.sessionId;
    request.sessionReauthAt = session.reauthAt;
    touchSession(app.db, session, app.config.sessionDays);
  });

  app.decorate('authenticate', async (request) => {
    if (!request.user) throw ERROR.authRequired();
  });

  app.decorate('requireAdmin', async (request) => {
    if (!request.user) throw ERROR.authRequired();
    if (request.user.role !== 'admin') throw ERROR.forbidden('只读账号，请联系管理员');
  });

  app.decorate('requireReauth', async (request) => {
    if (!request.user) throw ERROR.authRequired();
    const at = request.sessionReauthAt ? Date.parse(request.sessionReauthAt) : 0;
    if (!at || Date.now() - at > 10 * 60 * 1000) throw ERROR.reauthRequired();
  });
}
