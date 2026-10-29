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
export function loadConfig(overrides = {}) {
  const dataDir = overrides.dataDir ?? process.env.DATA_DIR ?? path.join(ROOT_DIR, 'data');
  return {
    nodeEnv: overrides.nodeEnv ?? process.env.NODE_ENV ?? 'development',
    host: overrides.host ?? process.env.HOST ?? '127.0.0.1',
    port: toInt(overrides.port ?? process.env.PORT, 8787),
    dataDir: path.resolve(dataDir),
    sessionDays: toInt(overrides.sessionDays ?? process.env.SESSION_DAYS, 30),
    cookieSecure: toBool(overrides.cookieSecure ?? process.env.COOKIE_SECURE, false),
    trustProxy: toBool(overrides.trustProxy ?? process.env.TRUST_PROXY, false),
    appTz: overrides.appTz ?? process.env.APP_TZ ?? 'Asia/Shanghai',
    logLevel: overrides.logLevel ?? process.env.LOG_LEVEL ?? 'info',
    backupKeep: toInt(overrides.backupKeep ?? process.env.BACKUP_KEEP, 14),
    webDist: overrides.webDist ?? path.join(ROOT_DIR, 'web', 'dist'),
  };
}
