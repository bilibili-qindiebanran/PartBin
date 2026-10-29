import { withTransaction } from '../db/connection.js';
import { ERROR } from '../lib/errors.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { verifyPassword } from '../lib/password.js';
import { nowIso } from '../lib/time.js';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from '../lib/totp.js';

function getUser(db, userId) {
  const row = db.prepare('SELECT * FROM user WHERE id = ?').get(userId);
  if (!row) throw ERROR.notFound('用户不存在');
  return row;
}

function storeRecoveryCodes(db, userId, codes) {
  db.prepare('DELETE FROM recovery_code WHERE user_id = ?').run(userId);
  const insert = db.prepare(
    'INSERT INTO recovery_code (user_id, code_hash, created_at) VALUES (?, ?, ?)',
  );
  const now = nowIso();
  for (const code of codes) insert.run(userId, hashRecoveryCode(code), now);
}

export function startTotpSetup(db, userId, appSecret) {
  const user = getUser(db, userId);
  if (Number(user.totp_enabled) === 1) throw ERROR.conflict('已启用动态验证码');

  const secret = generateTotpSecret();
  db.prepare('UPDATE user SET totp_secret = ?, totp_enabled = 0, updated_at = ? WHERE id = ?').run(
    encryptSecret(secret, appSecret),
    nowIso(),
    userId,
  );

  return {
    secret,
    otpauthUrl: otpauthUrl({ secret, username: user.username }),
  };
}

export function enableTotp(db, userId, code, appSecret) {
  const user = getUser(db, userId);
  if (Number(user.totp_enabled) === 1) throw ERROR.conflict('已启用动态验证码');
  if (!user.totp_secret) throw ERROR.validation('请先开始绑定');

  const secret = decryptSecret(user.totp_secret, appSecret);
  if (!secret) throw ERROR.internal('动态验证码配置损坏');

  const step = verifyTotp(secret, code, { lastStep: 0 });
  if (!step) throw ERROR.invalidTotp();

  const codes = generateRecoveryCodes(10);
  withTransaction(db, () => {
    db.prepare(
      'UPDATE user SET totp_enabled = 1, totp_last_step = ?, updated_at = ? WHERE id = ?',
    ).run(step, nowIso(), userId);
    storeRecoveryCodes(db, userId, codes);
  });

  return { recoveryCodes: codes };
}

export function disableTotp(db, userId, { password, code }, appSecret) {
  const user = getUser(db, userId);
  if (Number(user.totp_enabled) !== 1) throw ERROR.validation('尚未启用动态验证码');
  if (!verifyPassword(password, user.password_hash)) {
    throw ERROR.invalidCredentials();
  }

  const secret = decryptSecret(user.totp_secret, appSecret);
  if (!secret || !verifyTotp(secret, code, { lastStep: 0 })) {
    throw ERROR.invalidTotp();
  }

  db.prepare(
    'UPDATE user SET totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL, updated_at = ? WHERE id = ?',
  ).run(nowIso(), userId);
  db.prepare('DELETE FROM recovery_code WHERE user_id = ?').run(userId);
  return { ok: true };
}

export function rotateRecoveryCodes(db, userId) {
  const user = getUser(db, userId);
  if (Number(user.totp_enabled) !== 1) throw ERROR.validation('尚未启用动态验证码');
  const codes = generateRecoveryCodes(10);
  storeRecoveryCodes(db, userId, codes);
  return { recoveryCodes: codes };
}

/** 登录第二步校验：TOTP 或一次性恢复码；成功返回方式 */
export function verifySecondFactor(db, user, { code, recoveryCode }, appSecret) {
  if (recoveryCode) {
    const hash = hashRecoveryCode(normalizeRecoveryCode(recoveryCode));
    const row = db
      .prepare('SELECT * FROM recovery_code WHERE user_id = ? AND code_hash = ? AND used_at IS NULL')
      .get(user.id, hash);
    if (!row) throw ERROR.invalidTotp();
    db.prepare('UPDATE recovery_code SET used_at = ? WHERE id = ?').run(nowIso(), row.id);
    return 'recovery';
  }

  const secret = decryptSecret(user.totp_secret, appSecret);
  if (!secret) throw ERROR.invalidTotp();
  const step = verifyTotp(secret, code, {
    lastStep: user.totp_last_step == null ? 0 : Number(user.totp_last_step),
  });
  if (!step) throw ERROR.invalidTotp();

  db.prepare('UPDATE user SET totp_last_step = ? WHERE id = ?').run(step, user.id);
  return 'totp';
}
