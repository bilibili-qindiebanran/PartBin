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

/** 可空 ID：undefined / null / 空字符串返回 null */
export function optionalId(value, field = 'ID') {
  if (value === undefined || value === null || value === '') return null;
  return requireId(value, field);
}

/** 可空字符串：空值返回 null，否则去空白并校验长度 */
export function optionalString(value, field, { min = 1, max = 200 } = {}) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw ERROR.validation(`${field}填写有误`);
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length < min || trimmed.length > max) {
    throw ERROR.validation(`${field}长度需在 ${min}–${max} 个字符之间`);
  }
  return trimmed;
}

/** 整数校验 */
export function requireInt(value, field, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw ERROR.validation(`${field}需为 ${min}–${max} 之间的整数`);
  }
  return number;
}

/** 可空整数 */
export function optionalInt(value, field, options = {}) {
  if (value === undefined || value === null || value === '') return null;
  return requireInt(value, field, options);
}

/** 数字（可空） */
export function optionalNumber(value, field, { min = 0, max = 1e9 } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw ERROR.validation(`${field}需为 ${min}–${max} 之间的数字`);
  }
  return number;
}

/** 枚举校验 */
export function requireEnum(value, field, values) {
  if (!values.includes(value)) {
    throw ERROR.validation(`${field}只能是 ${values.join(' / ')}`);
  }
  return value;
}

/** 可空日期：YYYY-MM-DD，且必须是真实存在的日期 */
export function optionalDate(value, field = '日期') {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw ERROR.validation(`${field}格式应为 YYYY-MM-DD`);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw ERROR.validation(`${field}不是有效日期`);
  }
  return text;
}
