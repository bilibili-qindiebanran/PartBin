-- 007 BOM 人工对应关系
--
-- 记录用户确认过的「BOM 行 → 本地物料」对应，作为匹配的最高优先级通道。
-- match_key 由服务端按 lcsc / mpn / val / name 分层生成，优先级从高到低；
-- skip_params = 1 表示用户已确认封装/耐压差异可以接受（不完全匹配升级为完全匹配）。
CREATE TABLE bom_alias (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  match_key   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  item_id     INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  skip_params INTEGER NOT NULL DEFAULT 0 CHECK (skip_params IN (0, 1)),
  note        TEXT,
  created_by  INTEGER REFERENCES user(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_bom_alias_key ON bom_alias(match_key);
CREATE INDEX ix_bom_alias_item ON bom_alias(item_id);
