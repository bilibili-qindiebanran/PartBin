-- 001 初始结构：账号、会话、分类、位置、物料、实例、流水、借出、照片、配置

-- 迁移版本由运行器创建；这里兼容重复执行
CREATE TABLE IF NOT EXISTS schema_migration (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- 键值配置（注册开关等）
CREATE TABLE setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 用户
CREATE TABLE user (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL,
  username_norm TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX idx_user_role ON user (role, is_active);

-- 会话（只存 token 的 SHA-256）
CREATE TABLE session (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX idx_session_user ON session (user_id);
CREATE INDEX idx_session_expires ON session (expires_at);

-- 分类（树）
CREATE TABLE category (
  id         INTEGER PRIMARY KEY,
  parent_id  INTEGER REFERENCES category (id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_category_root_name
  ON category (name COLLATE NOCASE) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX ux_category_child_name
  ON category (parent_id, name COLLATE NOCASE) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_category_parent ON category (parent_id, sort_order);

-- 位置（树：柜 → 层/抽屉 → 盒）
CREATE TABLE location (
  id         INTEGER PRIMARY KEY,
  parent_id  INTEGER REFERENCES location (id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  code       TEXT,
  note       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_location_root_name
  ON location (name COLLATE NOCASE) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX ux_location_child_name
  ON location (parent_id, name COLLATE NOCASE) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_location_parent ON location (parent_id, sort_order);

-- 照片（文件落在 DATA_DIR/uploads/YYYYMM/）
CREATE TABLE photo (
  id         INTEGER PRIMARY KEY,
  rel_path   TEXT NOT NULL UNIQUE,
  mime       TEXT NOT NULL,
  byte_size  INTEGER NOT NULL CHECK (byte_size > 0),
  sha256     TEXT NOT NULL,
  width      INTEGER,
  height     INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_photo_sha256 ON photo (sha256);

-- 物料（SKU）
CREATE TABLE item (
  id            INTEGER PRIMARY KEY,
  code          TEXT,
  name          TEXT NOT NULL,
  category_id   INTEGER REFERENCES category (id) ON DELETE SET NULL,
  location_id   INTEGER REFERENCES location (id) ON DELETE SET NULL,
  manufacturer  TEXT,
  model         TEXT,
  spec          TEXT,
  unit          TEXT NOT NULL DEFAULT '个',
  tracking_mode TEXT NOT NULL DEFAULT 'quantity'
                 CHECK (tracking_mode IN ('quantity', 'instance')),
  quantity      INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  min_quantity  INTEGER NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  price_cents   INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  purchase_date TEXT,
  note          TEXT,
  is_archived   INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_by    INTEGER REFERENCES user (id) ON DELETE SET NULL,
  updated_by    INTEGER REFERENCES user (id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_item_code ON item (code) WHERE code IS NOT NULL;
CREATE INDEX idx_item_name ON item (name);
CREATE INDEX idx_item_model ON item (model);
CREATE INDEX idx_item_category ON item (category_id);
CREATE INDEX idx_item_location ON item (location_id);
CREATE INDEX idx_item_archived ON item (is_archived);

-- 实例（可选的单件管理）
CREATE TABLE item_instance (
  id          INTEGER PRIMARY KEY,
  item_id     INTEGER NOT NULL REFERENCES item (id) ON DELETE CASCADE,
  asset_no    TEXT,
  serial      TEXT,
  status      TEXT NOT NULL DEFAULT 'in_stock'
              CHECK (status IN ('in_stock', 'lent', 'broken', 'lost', 'retired')),
  location_id INTEGER REFERENCES location (id) ON DELETE SET NULL,
  photo_id    INTEGER REFERENCES photo (id) ON DELETE SET NULL,
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  note        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_instance_asset_no
  ON item_instance (asset_no) WHERE asset_no IS NOT NULL;
CREATE INDEX idx_instance_item ON item_instance (item_id, status);

-- 借出
CREATE TABLE loan (
  id                INTEGER PRIMARY KEY,
  item_id           INTEGER NOT NULL REFERENCES item (id) ON DELETE CASCADE,
  instance_id       INTEGER REFERENCES item_instance (id) ON DELETE SET NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  returned_quantity INTEGER NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  borrower          TEXT NOT NULL,
  contact           TEXT,
  note              TEXT,
  borrowed_at       TEXT NOT NULL,
  due_at            TEXT,
  returned_at       TEXT,
  created_by        INTEGER NOT NULL REFERENCES user (id) ON DELETE RESTRICT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  CHECK (returned_quantity <= quantity)
);
CREATE INDEX idx_loan_item ON loan (item_id, returned_at);
CREATE INDEX idx_loan_due ON loan (returned_at, due_at);

-- 出入库流水（不可变；borrow/return 的 delta 为 0）
CREATE TABLE movement (
  id             INTEGER PRIMARY KEY,
  item_id        INTEGER NOT NULL REFERENCES item (id) ON DELETE CASCADE,
  instance_id    INTEGER REFERENCES item_instance (id) ON DELETE SET NULL,
  loan_id        INTEGER REFERENCES loan (id) ON DELETE SET NULL,
  user_id        INTEGER NOT NULL REFERENCES user (id) ON DELETE RESTRICT,
  type           TEXT NOT NULL
                 CHECK (type IN ('in', 'out', 'adjust', 'discard', 'lost', 'borrow', 'return')),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  quantity_delta INTEGER NOT NULL,
  balance_after  INTEGER NOT NULL CHECK (balance_after >= 0),
  note           TEXT,
  occurred_at    TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  CHECK (
    (type = 'in'     AND quantity_delta = quantity) OR
    (type IN ('out', 'discard', 'lost') AND quantity_delta = -quantity) OR
    (type = 'adjust' AND quantity_delta <> 0 AND abs(quantity_delta) = quantity) OR
    (type IN ('borrow', 'return') AND quantity_delta = 0)
  )
);
CREATE INDEX idx_movement_item ON movement (item_id, occurred_at DESC, id DESC);
CREATE INDEX idx_movement_time ON movement (occurred_at DESC, id DESC);
CREATE INDEX idx_movement_type ON movement (type, occurred_at DESC);
CREATE INDEX idx_movement_loan ON movement (loan_id);
CREATE INDEX idx_movement_instance ON movement (instance_id);

-- 物料相册
CREATE TABLE item_photo (
  item_id    INTEGER NOT NULL REFERENCES item (id) ON DELETE CASCADE,
  photo_id   INTEGER NOT NULL REFERENCES photo (id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, photo_id)
);
CREATE INDEX idx_item_photo_order ON item_photo (item_id, sort_order);

-- 初始配置
INSERT INTO setting (key, value, updated_at)
VALUES ('allow_registration', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
       ('site_name', 'PartBin', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
