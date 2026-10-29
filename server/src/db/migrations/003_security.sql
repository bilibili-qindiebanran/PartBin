-- 003 公网安全加固：邀请码、登录尝试、恢复码、审计、会话加固

ALTER TABLE user ADD COLUMN totp_secret TEXT;
ALTER TABLE user ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user ADD COLUMN totp_last_step INTEGER;
ALTER TABLE user ADD COLUMN password_changed_at TEXT;
ALTER TABLE user ADD COLUMN locked_until TEXT;

ALTER TABLE session ADD COLUMN ip_hash TEXT;
ALTER TABLE session ADD COLUMN absolute_expires_at TEXT;
ALTER TABLE session ADD COLUMN reauth_at TEXT;

CREATE TABLE invite (
  id          INTEGER PRIMARY KEY,
  code_hash   TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  max_uses    INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count  INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= max_uses),
  note        TEXT,
  created_by  INTEGER NOT NULL REFERENCES user (id) ON DELETE RESTRICT,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_invite_expires ON invite (expires_at);

CREATE TABLE login_attempt (
  id            INTEGER PRIMARY KEY,
  username_norm TEXT,
  ip_hash       TEXT NOT NULL,
  success       INTEGER NOT NULL CHECK (success IN (0, 1)),
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_login_attempt_user ON login_attempt (username_norm, created_at DESC);
CREATE INDEX idx_login_attempt_ip ON login_attempt (ip_hash, created_at DESC);

CREATE TABLE recovery_code (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL UNIQUE,
  used_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_recovery_user ON recovery_code (user_id, used_at);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER REFERENCES user (id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  detail      TEXT,
  ip_hash     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_audit_time ON audit_log (created_at DESC);
CREATE INDEX idx_audit_action ON audit_log (action, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_log (actor_id, created_at DESC);

INSERT INTO setting (key, value, updated_at)
SELECT 'registration_mode', 'invite', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM setting WHERE key = 'registration_mode');
