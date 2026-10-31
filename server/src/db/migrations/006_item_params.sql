-- 006 物料电气参数：封装与耐压
--
-- 两者都是自由文本，用于与 BOM 对照：
--   package 例如 0603 / SOP-8 / LQFP-48
--   voltage 例如 16V / 50V / 600V
ALTER TABLE item ADD COLUMN package TEXT;
ALTER TABLE item ADD COLUMN voltage TEXT;
