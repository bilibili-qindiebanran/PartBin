import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/env.js';

/**
 * 创建一套隔离的测试环境（临时数据目录 + 真实迁移）。
 * @param {Record<string, unknown>} [overrides]
 */
export async function createFixture(overrides = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hw-test-'));
  const config = loadConfig({
    dataDir: dir,
    logLevel: 'silent',
    webDist: path.join(dir, '__no_web_build__'),
    ...overrides,
  });
  const app = await buildApp(config);
  await app.ready();
  return { app, dir, config };
}

/** 关闭应用并删除临时目录 */
export async function destroyFixture(ctx) {
  await ctx.app.close();
  await rm(ctx.dir, { recursive: true, force: true });
}

/** 从响应头中提取会话 Cookie */
export function cookieFrom(res) {
  const header = res.headers['set-cookie'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const match = String(raw).match(/inv_sid=([^;]+)/);
  return match ? `inv_sid=${match[1]}` : null;
}

/** 简化 inject 调用 */
export function request(app, { method = 'GET', url, cookie, payload, headers } = {}) {
  const options = { method, url };
  if (payload !== undefined) options.payload = payload;

  const mergedHeaders = { ...(headers ?? {}) };
  if (cookie) mergedHeaders.cookie = cookie;
  if (Object.keys(mergedHeaders).length > 0) options.headers = mergedHeaders;

  return app.inject(options);
}

/** 注册并返回响应、Cookie、响应体 */
export async function registerUser(app, username, password = 'password123') {
  const res = await request(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password },
  });
  return { res, cookie: cookieFrom(res), body: res.json() };
}

/** 登录并返回响应、Cookie、响应体 */
export async function loginUser(app, username, password = 'password123') {
  const res = await request(app, {
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });
  return { res, cookie: cookieFrom(res), body: res.json() };
}
