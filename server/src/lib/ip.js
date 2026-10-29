import { hmacHex } from './crypto.js';

/** 去掉 IPv6 映射前缀，限制长度 */
export function normalizeIp(ip) {
  if (!ip) return 'unknown';
  const value = String(ip).trim();
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

/** 只保存 HMAC 哈希，不落原始 IP */
export function hashIp(ip, secret) {
  return hmacHex(normalizeIp(ip), secret, 16);
}
