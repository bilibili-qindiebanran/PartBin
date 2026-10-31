-- 005 嘉立创（LCSC / JLCPCB）料号与匹配缓存

-- item.lcsc_code：形如 C2286 的立创商品编号
ALTER TABLE item ADD COLUMN lcsc_code TEXT;
-- 最近一次自动匹配成功的时间；手工填写时为空
ALTER TABLE item ADD COLUMN lcsc_matched_at TEXT;

CREATE INDEX idx_item_lcsc ON item (lcsc_code);

-- 元件信息缓存：避免每次入库都抓取上游，也让离线时仍能看到上次结果
CREATE TABLE lcsc_cache (
  code       TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  source     TEXT,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
