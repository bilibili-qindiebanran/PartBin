import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/**
 * 生成 scrypt 密码哈希，格式：scrypt$N$r$p$saltB64$hashB64
 * @param {string} password
 */
export function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * 校验密码。格式非法或参数异常时返回 false，不抛错。
 * @param {string} password
 * @param {string} stored
 */
export function verifyPassword(password, stored) {
  try {
    const parts = String(stored ?? '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const [, n, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    if (salt.length === 0 || expected.length === 0) return false;

    const actual = scryptSync(String(password ?? ''), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * 固定 dummy 哈希：账号不存在时也执行一次同等成本的校验，避免时间侧信道。
 */
export const DUMMY_PASSWORD_HASH = hashPassword('dummy-password-for-timing-equalization');
