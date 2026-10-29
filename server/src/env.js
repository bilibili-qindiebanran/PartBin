import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录（server/src → ../../） */
export const ROOT_DIR = fileURLToPath(new URL('../../', import.meta.url));

function toInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

/**
 * 读取运行配置。测试与脚本可通过 overrides 覆盖任意字段。
 * @returns {{
 *   nodeEnv: string, host: string, port: number, dataDir: string,
 *   sessionDays: number, cookieSecure: boolean, trustProxy: boolean,
 *   appTz: string, logLevel: string, backupKeep: number, webDist: string
 * }}
 */
const DEV_SECRET = 'dev-only-secret-change-me-32-bytes-min';

export function loadConfig(overrides = {}) {
  const dataDir = overrides.dataDir ?? process.env.DATA_DIR ?? path.join(ROOT_DIR, 'data');
  const nodeEnv = overrides.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const providedSecret = overrides.appSecret ?? process.env.APP_SECRET;
  const publicOrigin = overrides.publicOrigin ?? process.env.PUBLIC_ORIGIN ?? '';
  if (nodeEnv === 'production' && !providedSecret) {
    throw new Error('生产环境必须设置 APP_SECRET（至少 32 字节随机值）');
  }
  if (nodeEnv === 'production' && !publicOrigin) {
    throw new Error('生产环境必须设置 PUBLIC_ORIGIN（例如 https://partbin.example.com）');
  }

  return {
    nodeEnv,
    host: overrides.host ?? process.env.HOST ?? '127.0.0.1',
    port: toInt(overrides.port ?? process.env.PORT, 8787),
    dataDir: path.resolve(dataDir),
    sessionDays: toInt(overrides.sessionDays ?? process.env.SESSION_DAYS, 7),
    sessionAbsoluteDays: toInt(overrides.sessionAbsoluteDays ?? process.env.SESSION_ABSOLUTE_DAYS, 30),
    cookieSecure: toBool(overrides.cookieSecure ?? process.env.COOKIE_SECURE, nodeEnv === 'production'),
    trustProxy: toBool(overrides.trustProxy ?? process.env.TRUST_PROXY, false),
    appSecret: providedSecret ?? DEV_SECRET,
    publicOrigin,
    hstsMaxAge: toInt(overrides.hstsMaxAge ?? process.env.HSTS_MAX_AGE, 86400),
    appTz: overrides.appTz ?? process.env.APP_TZ ?? 'Asia/Shanghai',
    logLevel: overrides.logLevel ?? process.env.LOG_LEVEL ?? 'info',
    backupKeep: toInt(overrides.backupKeep ?? process.env.BACKUP_KEEP, 14),
    webDist: overrides.webDist ?? path.join(ROOT_DIR, 'web', 'dist'),
  };
}
