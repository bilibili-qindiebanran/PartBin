/** 当前 UTC 时间，ISO-8601 带毫秒 */
export function nowIso() {
  return new Date().toISOString();
}

/** 从当前时间起 n 天后的 ISO 时间 */
export function isoAfterDays(days, from = Date.now()) {
  return new Date(from + days * 24 * 60 * 60 * 1000).toISOString();
}

/** 判断 ISO 字符串是否已过期（或无法解析） */
export function isExpired(iso, now = Date.now()) {
  const ts = Date.parse(String(iso ?? ''));
  return !Number.isFinite(ts) || ts <= now;
}
