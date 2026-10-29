import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'node:crypto';

const keyCache = new Map();

function deriveKey(secret) {
  if (!keyCache.has(secret)) {
    keyCache.set(secret, scryptSync(secret, 'partbin-secret-v1', 32));
  }
  return keyCache.get(secret);
}

/** AES-256-GCM 加密，输出 v1.iv.tag.cipher（base64） */
export function encryptSecret(plainText, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptSecret(payload, secret) {
  try {
    const [version, ivB64, tagB64, dataB64] = String(payload).split('.');
    if (version !== 'v1') return null;
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** 带密钥的 HMAC，用于 IP 哈希与一次性码 */
export function hmacHex(value, secret, bytes = 32) {
  return createHmac('sha256', secret).update(String(value)).digest('hex').slice(0, bytes * 2);
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function randomBase32(length) {
  const bytes = randomBytes(length);
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output += BASE32_ALPHABET[bytes[index] % 32];
  }
  return output;
}
