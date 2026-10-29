import { ERROR } from './errors.js';

/** 用户名允许的字符：中文、字母、数字、下划线、短横线 */
export const USERNAME_RE = /^[\p{L}\p{N}_-]{3,32}$/u;

/** 规范化用户名：全角转半角、去首尾空白、转小写 */
export function normalizeUsername(username) {
  return String(username ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
}

/**
 * 校验并返回去空白后的字符串
 */
export function requireString(value, field, { min = 1, max = 200 } = {}) {
  if (typeof value !== 'string') throw ERROR.validation(`${field}填写有误`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw ERROR.validation(`${field}长度需在 ${min}–${max} 个字符之间`);
  }
  return trimmed;
}

/** 校验用户名格式，返回原样大小写的用户名 */
export function requireUsername(value) {
  const username = requireString(value, '用户名', { min: 3, max: 32 });
  if (!USERNAME_RE.test(username)) {
    throw ERROR.validation('用户名只能包含中文、字母、数字、下划线或短横线');
  }
  return username;
}

/**
 * 校验密码规则（8–64 字符、非纯空格、不与用户名相同），返回原密码。
 */
export function requirePassword(value, { username } = {}) {
  if (typeof value !== 'string') throw ERROR.validation('密码填写有误');
  const length = Array.from(value).length;
  if (length < 8 || length > 64) throw ERROR.validation('密码长度需为 8–64 个字符');
  if (value.trim().length === 0) throw ERROR.validation('密码不能全为空格');
  if (username && value.toLowerCase() === String(username).toLowerCase()) {
    throw ERROR.validation('密码不能与用户名相同');
  }
  return value;
}

/** 校验布尔值 */
export function requireBoolean(value, field) {
  if (typeof value !== 'boolean') throw ERROR.validation(`${field}必须是布尔值`);
  return value;
}

/** 校验正整数 ID */
export function requireId(value, field = 'ID') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw ERROR.validation(`${field}无效`);
  return id;
}
