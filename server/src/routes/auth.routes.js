import { ERROR } from '../lib/errors.js';
import { DUMMY_PASSWORD_HASH, verifyPassword } from '../lib/password.js';
import { normalizeUsername, requireBoolean } from '../lib/validate.js';
import { nowIso } from '../lib/time.js';
import {
  changePassword,
  createUser,
  findByUsernameNorm,
  findById,
  registerWithInvite,
  setLastLogin,
  toPublicUser,
} from '../services/users.js';
import {
  REGISTRATION_MODES,
  getRegistrationMode,
  getSetting,
  hasUsers,
  setAllowRegistration,
  setRegistrationMode,
} from '../services/settings.js';
import {
  ACCOUNT_FAILURE_LIMIT,
  IP_FAILURE_LIMIT,
  clearAccountLock,
  getFailureCounts,
  lockAccount,
  recordLoginAttempt,
  remainingLockSeconds,
  throwLocked,
} from '../services/login-attempts.js';
import { recordAudit } from '../services/audit-log.js';
import {
  disableTotp,
  enableTotp,
  rotateRecoveryCodes,
  startTotpSetup,
  verifySecondFactor,
} from '../services/totp.js';
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

/** 注册 IP 限速，超限抛 429 */
function enforce(limiter, key) {
  const result = limiter.hit(key);
  if (!result.ok) {
    throw ERROR.rateLimited('操作太频繁，请稍后再试', result.retryAfter);
  }
}

function startSession(db, reply, request, config, userId) {
  const token = createSession(db, {
    userId,
    ip: request.ip,
    ipHash: request.ipHash,
    userAgent: request.headers['user-agent'],
    days: config.sessionDays,
    absoluteDays: config.sessionAbsoluteDays,
  });
  setSessionCookie(reply, token, config);
}

/**
 * 账号相关路由：邀请码注册、登录、退出、当前用户、改密、再验证、会话管理。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function authRoutes(app) {
  const { db, config } = app;

  app.get('/api/auth/config', async () => {
    const mode = getRegistrationMode(db);
    return {
      registrationMode: mode,
      allowRegistration: mode !== 'closed',
      hasUsers: hasUsers(db),
      firstUserBecomesAdmin: false,
      siteName: getSetting(db, 'site_name', 'PartBin'),
    };
  });

  app.post('/api/auth/register', async (request, reply) => {
    enforce(app.limiters.registerIp, `register:${request.ip}`);

    const mode = getRegistrationMode(db);
    if (mode === 'closed') throw ERROR.registrationClosed();

    const { username, password, inviteCode } = request.body ?? {};
    let user;
    if (mode === 'invite') {
      const result = registerWithInvite(db, { username, password, inviteCode });
      user = result.user;
    } else {
      user = createUser(db, { username, password, role: 'user' });
    }

    recordAudit(db, {
      actorId: user.id,
      action: 'auth.register',
      targetType: 'user',
      targetId: user.id,
      detail: { mode },
      ipHash: request.ipHash,
    });

    startSession(db, reply, request, config, user.id);
    return reply.code(201).send({ user, firstUser: false });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const rawUsername = request.body?.username;
    const password = request.body?.password;
    if (typeof rawUsername !== 'string' || typeof password !== 'string') {
      throw ERROR.validation('请输入用户名和密码');
    }

    const usernameNorm = normalizeUsername(rawUsername);
    const row = findByUsernameNorm(db, usernameNorm);
    const counts = getFailureCounts(db, { usernameNorm, ipHash: request.ipHash });
    const retryAfter = remainingLockSeconds(row, counts);
    if (retryAfter > 0) throwLocked(retryAfter);

    // 账号不存在时也做一次等价成本的校验，避免时间侧信道
    const passwordOk = verifyPassword(password, row ? row.password_hash : DUMMY_PASSWORD_HASH);

    if (!row || !passwordOk || Number(row.is_active) !== 1) {
      recordLoginAttempt(db, {
        usernameNorm,
        ipHash: request.ipHash,
        success: false,
      });
      const next = getFailureCounts(db, { usernameNorm, ipHash: request.ipHash });
      if (row && next.account >= ACCOUNT_FAILURE_LIMIT) {
        lockAccount(db, row.id);
      }
      recordAudit(db, {
        actorId: row ? Number(row.id) : null,
        action: 'auth.login.failed',
        targetType: 'user',
        targetId: row ? Number(row.id) : null,
        detail: { username: rawUsername.slice(0, 60) },
        ipHash: request.ipHash,
      });
      if (next.account >= ACCOUNT_FAILURE_LIMIT || next.ip >= IP_FAILURE_LIMIT) {
        throwLocked(15 * 60);
      }
      throw ERROR.invalidCredentials();
    }

    if (Number(row.totp_enabled) === 1) {
      const totpCode = request.body?.totpCode;
      const recoveryCode = request.body?.recoveryCode;
      if (!totpCode && !recoveryCode) throw ERROR.totpRequired();

      try {
        const method = verifySecondFactor(
          db,
          row,
          { code: totpCode, recoveryCode },
          config.appSecret,
        );
        recordAudit(db, {
          actorId: Number(row.id),
          action: 'auth.login.totp',
          targetType: 'user',
          targetId: Number(row.id),
          detail: { method },
          ipHash: request.ipHash,
        });
      } catch (error) {
        recordLoginAttempt(db, { usernameNorm, ipHash: request.ipHash, success: false });
        const next = getFailureCounts(db, { usernameNorm, ipHash: request.ipHash });
        if (next.account >= ACCOUNT_FAILURE_LIMIT) lockAccount(db, row.id);
        recordAudit(db, {
          actorId: Number(row.id),
          action: 'auth.login.totp_failed',
          targetType: 'user',
          targetId: Number(row.id),
          ipHash: request.ipHash,
        });
        throw error;
      }
    }

    recordLoginAttempt(db, { usernameNorm, ipHash: request.ipHash, success: true });
    clearAccountLock(db, row.id);
    setLastLogin(db, row.id);
    recordAudit(db, {
      actorId: Number(row.id),
      action: 'auth.login',
      targetType: 'user',
      targetId: Number(row.id),
      ipHash: request.ipHash,
    });

    startSession(db, reply, request, config, Number(row.id));
    return {
      user: toPublicUser(findById(db, row.id)),
      totpEnabled: Number(row.totp_enabled) === 1,
    };
  });

  app.get('/api/auth/me', { preHandler: app.authenticate }, async (request) => {
    const row = findById(db, request.user.id);
    if (!row || Number(row.is_active) !== 1) throw ERROR.authRequired();
    return {
      user: toPublicUser(row),
      totpEnabled: Number(row.totp_enabled) === 1,
      registrationMode: getRegistrationMode(db),
      allowRegistration: getRegistrationMode(db) !== 'closed',
      hasUsers: hasUsers(db),
    };
  });

  app.post('/api/auth/logout', { preHandler: app.authenticate }, async (request, reply) => {
    recordAudit(db, {
      actorId: request.user.id,
      action: 'auth.logout',
      targetType: 'session',
      targetId: request.sessionId,
      ipHash: request.ipHash,
    });
    deleteSession(db, request.sessionId);
    clearSessionCookie(reply, config);
    return reply.code(204).send();
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

  app.post(
    '/api/auth/totp/setup',
    { preHandler: [app.authenticate, app.requireReauth] },
    async (request) => {
      const result = startTotpSetup(db, request.user.id, config.appSecret);
      recordAudit(db, {
        actorId: request.user.id,
        action: 'auth.totp.setup',
        targetType: 'user',
        targetId: request.user.id,
        ipHash: request.ipHash,
      });
      return result;
    },
  );

  app.post(
    '/api/auth/totp/enable',
    { preHandler: [app.authenticate, app.requireReauth] },
    async (request) => {
      const result = enableTotp(db, request.user.id, request.body?.code, config.appSecret);
      recordAudit(db, {
        actorId: request.user.id,
        action: 'auth.totp.enable',
        targetType: 'user',
        targetId: request.user.id,
        ipHash: request.ipHash,
      });
      return result;
    },
  );

  app.post(
    '/api/auth/totp/disable',
    { preHandler: [app.authenticate, app.requireReauth] },
    async (request) => {
      const result = disableTotp(
        db,
        request.user.id,
        { password: request.body?.password, code: request.body?.code },
        config.appSecret,
      );
      recordAudit(db, {
        actorId: request.user.id,
        action: 'auth.totp.disable',
        targetType: 'user',
        targetId: request.user.id,
        ipHash: request.ipHash,
      });
      return result;
    },
  );

  app.post(
    '/api/auth/totp/recovery',
    { preHandler: [app.authenticate, app.requireReauth] },
    async (request) => {
      const result = rotateRecoveryCodes(db, request.user.id);
      recordAudit(db, {
        actorId: request.user.id,
        action: 'auth.totp.recovery_rotate',
        targetType: 'user',
        targetId: request.user.id,
        ipHash: request.ipHash,
      });
      return result;
    },
  );

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
    deleteSessionsForUser(db, request.user.id, { exceptSessionId: request.sessionId });
    recordAudit(db, {
      actorId: request.user.id,
      action: 'auth.password.change',
      targetType: 'user',
      targetId: request.user.id,
      ipHash: request.ipHash,
    });

    return { ok: true };
  });

  app.patch('/api/settings', { preHandler: [app.requireAdmin, app.requireReauth] }, async (request) => {
    const body = request.body ?? {};

    if (body.registrationMode !== undefined) {
      if (!REGISTRATION_MODES.includes(body.registrationMode)) {
        throw ERROR.validation('注册策略只能是 closed / invite / open');
      }
      setRegistrationMode(db, body.registrationMode);
      recordAudit(db, {
        actorId: request.user.id,
        action: 'settings.registration',
        detail: { mode: body.registrationMode },
        ipHash: request.ipHash,
      });
      return {
        registrationMode: body.registrationMode,
        allowRegistration: body.registrationMode !== 'closed',
      };
    }

    const allow = requireBoolean(body.allowRegistration, '注册开关');
    setAllowRegistration(db, allow);
    recordAudit(db, {
      actorId: request.user.id,
      action: 'settings.registration',
      detail: { mode: allow ? 'open' : 'closed' },
      ipHash: request.ipHash,
    });
    return { registrationMode: allow ? 'open' : 'closed', allowRegistration: allow };
  });
}
