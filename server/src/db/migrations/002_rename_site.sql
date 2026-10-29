-- 002 项目更名为 PartBin：同步默认站点名
-- 仅当站点名仍是旧默认值时更新，避免覆盖用户自定义名称。
UPDATE setting
SET value = 'PartBin',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'site_name'
  AND value IN ('硬件出入库', '硬件出入库系统');
