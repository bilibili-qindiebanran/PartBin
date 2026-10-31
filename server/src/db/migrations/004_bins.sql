-- 004 元件盒网格布局与物料格位
--
-- location.grid_rows / grid_cols 同时有值表示「分类盒」（格位编址）：
--   行 1..grid_rows，列 1..grid_cols，一个格位最多放一种物料。
-- 两者都为 NULL 表示普通位置 / 「大盒」：可以混装多种物料，各自独立计数。
--
-- item.cell_row / cell_col 表示物料在所属分类盒中的格位；为 NULL 时
-- 表示尚未归位（仍计入该位置）。
ALTER TABLE location ADD COLUMN grid_rows INTEGER;
ALTER TABLE location ADD COLUMN grid_cols INTEGER;

ALTER TABLE item ADD COLUMN cell_row INTEGER;
ALTER TABLE item ADD COLUMN cell_col INTEGER;

-- 同一盒内一个格位只能放一种物料
CREATE UNIQUE INDEX ux_item_cell
  ON item (location_id, cell_row, cell_col)
  WHERE location_id IS NOT NULL AND cell_row IS NOT NULL AND cell_col IS NOT NULL;
