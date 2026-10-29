import { createHash, createHmac, randomBytes } from 'node:crypto';
import { randomBase32 } from './crypto.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD = 30;
const DIGITS = 6;

export function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(input) {
  const text = String(input).toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of text) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('无效的 Base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret() {
  return encodeBase32(randomBytes(20));
}

export function currentStep(at = Date.now()) {
  return Math.floor(at / 1000 / PERIOD);
}

export function totpAt(secret, step) {
  const key = decodeBase32(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** 返回匹配且大于 lastStep 的时间步，失败返回 null */
export function verifyTotp(secret, token, { window = 1, lastStep = 0 } = {}) {
  const normalized = String(token ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const step = currentStep();
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = step + offset;
    if (candidate <= lastStep) continue;
    if (totpAt(secret, candidate) === normalized) return candidate;
  }
  return null;
}

export function otpauthUrl({ secret, username, issuer = 'PartBin' }) {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function normalizeRecoveryCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '');
}

export function hashRecoveryCode(code) {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = randomBase32(8);
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  });
}
