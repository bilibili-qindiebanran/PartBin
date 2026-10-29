import { ERROR } from '../lib/errors.js';
import { DUMMY_PASSWORD_HASH, verifyPassword } from '../lib/password.js';
import { normalizeUsername, requireBoolean } from '../lib/validate.js';
import {
  changePassword,
  findByUsernameNorm,
  findById,
  registerUser,
  setLastLogin,
  toPublicUser,
} from '../services/users.js';
import {
  allowRegistration,
  getSetting,
  hasUsers,
  setAllowRegistration,
} from '../services/settings.js';
import {
  clearSessionCookie,
  createSession,
  deleteOwnSession,
  deleteSession,
  deleteSessionsForUser,
  listSessionsForUser,
  setSessionCookie,
  updateReauth,
} from '../services/sessions.js';
import { nowIso } from '../lib/time.js';

/** 限速检查，超限抛 429 */
function enforce(limiter, key) {
  const result = limiter.hit(key);
  if (!result.ok) {
    throw ERROR.rateLimited('操作太频繁，请稍后再试', result.retryAfter);
  }
}

/**
 * 账号相关路由：注册、登录、退出、当前用户、改密、公开配置、注册开关。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function authRoutes(app) {
  const { db, config } = app;

  app.get('/api/auth/config', async () => ({
    allowRegistration: allowRegistration(db),
    hasUsers: hasUsers(db),
    firstUserBecomesAdmin: true,
    siteName: getSetting(db, 'site_name', 'PartBin'),
  }));

  app.post('/api/auth/register', async (request, reply) => {
    enforce(app.limiters.registerIp, `register:${request.ip}`);

    const { username, password } = request.body ?? {};
    const { user, firstUser } = registerUser(db, { username, password });

    const token = createSession(db, {
      userId: user.id,
      ip: request.ip,
      ipHash: request.ipHash,
      userAgent: request.headers['user-agent'],
      days: config.sessionDays,
      absoluteDays: config.sessionAbsoluteDays,
    });
    setSessionCookie(reply, token, config);

    return reply.code(201).send({ user, firstUser });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const rawUsername = request.body?.username;
    const password = request.body?.password;
    if (typeof rawUsername !== 'string' || typeof password !== 'string') {
      throw ERROR.validation('请输入用户名和密码');
    }

    const usernameNorm = normalizeUsername(rawUsername);
    enforce(app.limiters.loginIp, `login-ip:${request.ip}`);
    enforce(app.limiters.loginUser, `login-user:${usernameNorm || 'unknown'}`);

    const row = findByUsernameNorm(db, usernameNorm);
    // 账号不存在时也做一次等价成本的校验，避免时间侧信道
    const passwordOk = verifyPassword(password, row ? row.password_hash : DUMMY_PASSWORD_HASH);

    if (!row || !passwordOk || Number(row.is_active) !== 1) {
      throw ERROR.invalidCredentials();
    }

    app.limiters.loginUser.reset(`login-user:${usernameNorm}`);
    setLastLogin(db, row.id);

    const token = createSession(db, {
      userId: Number(row.id),
      ip: request.ip,
      ipHash: request.ipHash,
      userAgent: request.headers['user-agent'],
      days: config.sessionDays,
      absoluteDays: config.sessionAbsoluteDays,
    });
    setSessionCookie(reply, token, config);

    return { user: toPublicUser(findById(db, row.id)) };
  });

  app.get('/api/auth/me', { preHandler: app.authenticate }, async (request) => {
    const row = findById(db, request.user.id);
    if (!row || Number(row.is_active) !== 1) throw ERROR.authRequired();
    return {
      user: toPublicUser(row),
      allowRegistration: allowRegistration(db),
      hasUsers: hasUsers(db),
    };
  });

  app.post('/api/auth/logout', { preHandler: app.authenticate }, async (request, reply) => {
    deleteSession(db, request.sessionId);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.post('/api/auth/password', { preHandler: app.authenticate }, async (request) => {
    const { currentPassword, newPassword } = request.body ?? {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      throw ERROR.validation('请输入当前密码与新密码');
    }

    changePassword(db, {
      userId: request.user.id,
      currentPassword,
      newPassword,
    });
    // 改密后吊销其他设备会话，保留当前设备
    deleteSessionsForUser(db, request.user.id, { exceptSessionId: request.sessionId });

    return { ok: true };
  });

  app.post('/api/auth/reauth', { preHandler: app.authenticate }, async (request) => {
    const password = request.body?.password;
    if (typeof password !== 'string' || password.length === 0) {
      throw ERROR.validation('请输入当前密码');
    }
    const row = findById(db, request.user.id);
    if (!row) throw ERROR.authRequired();
    if (!verifyPassword(password, row.password_hash)) {
      throw ERROR.invalidCredentials();
    }
    updateReauth(db, request.sessionId);
    return { ok: true, reauthAt: nowIso() };
  });

  app.get('/api/auth/sessions', { preHandler: app.authenticate }, async (request) => ({
    data: listSessionsForUser(db, request.user.id).map((session) => ({
      ...session,
      current: session.id === request.sessionId,
    })),
  }));

  app.delete('/api/auth/sessions/:id', { preHandler: app.authenticate }, async (request) => {
    const removed = deleteOwnSession(db, String(request.params.id), request.user.id);
    if (!removed) throw ERROR.notFound('会话不存在');
    return { ok: true };
  });

  app.patch('/api/settings', { preHandler: app.requireAdmin }, async (request) => {
    const allow = requireBoolean(request.body?.allowRegistration, '注册开关');
    setAllowRegistration(db, allow);
    return { allowRegistration: allow };
  });
}
