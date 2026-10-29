import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';

import { loadConfig } from './env.js';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { AppError } from './lib/errors.js';
import { securityHeaders } from './lib/headers.js';
import { createRateLimiter } from './lib/rate-limit.js';
import { installAuth } from './plugins/auth.js';
import { purgeExpiredSessions } from './services/sessions.js';

import metaRoutes from './routes/meta.routes.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/users.routes.js';
import categoryRoutes from './routes/categories.routes.js';
import locationRoutes from './routes/locations.routes.js';
import itemRoutes from './routes/items.routes.js';
import movementRoutes from './routes/movements.routes.js';
import instanceRoutes from './routes/instances.routes.js';
import loanRoutes from './routes/loans.routes.js';
import photoRoutes from './routes/photos.routes.js';
import transferRoutes from './routes/transfer.routes.js';
import inviteRoutes from './routes/invites.routes.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function buildLogger(config) {
  if (config.logLevel === 'silent') return false;
  return {
    level: config.logLevel,
    redact: ['req.headers.cookie', 'req.headers.authorization'],
  };
}

/**
 * 创建 Fastify 实例（不监听端口），供 index.js 与测试共用。
 * @param {Partial<ReturnType<typeof loadConfig>>} overrides
 */
export async function buildApp(overrides = {}) {
  const config = loadConfig(overrides);
  const db = openDatabase(config);

  try {
    migrate(db);
    purgeExpiredSessions(db);
  } catch (error) {
    db.close();
    throw error;
  }

  const app = Fastify({
    logger: buildLogger(config),
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  app.decorate('db', db);
  app.decorate('config', config);
  app.decorate('limiters', {
    // 登录：同 IP 10 次/分钟，同账号 5 次/分钟；注册：同 IP 5 次/小时
    loginIp: createRateLimiter({ limit: 10, windowMs: 60 * 1000 }),
    loginUser: createRateLimiter({ limit: 5, windowMs: 60 * 1000 }),
    registerIp: createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 }),
  });

  // 统一安全响应头（CSP、HSTS、COOP/CORP 等）
  app.addHook('onSend', async (request, reply, payload) => {
    for (const [name, value] of Object.entries(securityHeaders(config))) {
      if (!reply.hasHeader(name)) reply.header(name, value);
    }
    return payload;
  });

  // 同源校验：带 Origin 的状态变更请求必须与当前 Host 一致（防御 CSRF）
  app.addHook('onRequest', async (request) => {
    if (!MUTATING_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (!origin) return;

    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new AppError('FORBIDDEN', 403, '请求来源不合法');
    }
    if (originHost !== request.host) {
      throw new AppError('FORBIDDEN', 403, '请求来源不合法');
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.status === 429 && error.details?.retryAfter) {
        reply.header('Retry-After', String(error.details.retryAfter));
      }
      return reply.code(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
      });
    }

    // Fastify 自身的 4xx（请求体解析失败、媒体类型错误等）
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        error: {
          code: 'VALIDATION',
          message: error.message || '请求格式有误',
          details: null,
        },
      });
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({
      error: { code: 'INTERNAL', message: '服务器内部错误', details: null },
    });
  });

  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 10 },
  });
  app.addContentTypeParser(
    'text/csv',
    { parseAs: 'string', bodyLimit: 3 * 1024 * 1024 },
    (request, body, done) => done(null, body),
  );
  installAuth(app);

  await app.register(metaRoutes);
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(categoryRoutes);
  await app.register(locationRoutes);
  await app.register(itemRoutes);
  await app.register(movementRoutes);
  await app.register(instanceRoutes);
  await app.register(loanRoutes);
  await app.register(photoRoutes);
  await app.register(transferRoutes);
  await app.register(inviteRoutes);

  // 生产模式：托管 web/dist；开发模式由 Vite 提供前端
  const indexHtml = path.join(config.webDist, 'index.html');
  const hasWebBuild = fs.existsSync(indexHtml);
  if (hasWebBuild) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: '/' });
  }

  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0];

    if (pathname.startsWith('/api/') || pathname === '/health') {
      return reply
        .code(404)
        .send({ error: { code: 'NOT_FOUND', message: '接口不存在', details: null } });
    }

    if (hasWebBuild && (request.method === 'GET' || request.method === 'HEAD')) {
      return reply.type('text/html').sendFile('index.html');
    }

    return reply
      .code(404)
      .send({ error: { code: 'NOT_FOUND', message: '页面不存在', details: null } });
  });

  let databaseClosed = false;
  app.addHook('onClose', async () => {
    if (databaseClosed) return;
    databaseClosed = true;
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // 关闭时 checkpoint 失败不阻塞退出
    }
    db.close();
  });

  return app;
}
