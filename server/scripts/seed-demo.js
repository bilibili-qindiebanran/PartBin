#!/usr/bin/env node
/**
 * 演示数据：需要已有管理员；仅写入 DEMO- 前缀物料。
 * 用法：pnpm seed:demo -- --yes
 */
import { loadConfig } from '../src/env.js';
import { openDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createCategory } from '../src/services/categories.js';
import { createLocation } from '../src/services/locations.js';
import { createItem } from '../src/services/items.js';
import { createInstancesBatch } from '../src/services/instances.js';

if (!process.argv.includes('--yes')) {
  console.log('这会写入演示库存。确认请加 --yes。');
  process.exit(0);
}

const config = loadConfig();
const db = openDatabase(config);
try {
  migrate(db);
  const admin = db
    .prepare("SELECT id FROM user WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1")
    .get();
  if (!admin) {
    console.error('没有管理员账号，请先运行 pnpm admin:create');
    process.exit(1);
  }

  const existing = Number(
    db.prepare("SELECT COUNT(*) AS c FROM item WHERE code LIKE 'DEMO-%'").get().c,
  );
  if (existing > 0) {
    console.log(`已存在 ${existing} 条演示物料，跳过。`);
    process.exit(0);
  }

  const boards = createCategory(db, { name: '开发板' });
  const mcu = createCategory(db, { name: '单片机', parentId: boards.id });
  const sensors = createCategory(db, { name: '传感器' });
  const cabinet = createLocation(db, { name: '元件柜' });
  const drawer = createLocation(db, { name: 'A 抽屉', parentId: cabinet.id });
  const box = createLocation(db, { name: '盒 01', parentId: drawer.id });

  createItem(
    db,
    {
      code: 'DEMO-STM32',
      name: 'STM32F103 最小系统板',
      categoryId: mcu.id,
      locationId: box.id,
      manufacturer: '正点原子',
      model: 'STM32F103C8T6',
      spec: '72MHz / 64KB Flash',
      unit: '块',
      quantity: 5,
      minQuantity: 2,
      price: 12.5,
      note: '演示数据，可直接归档。',
    },
    admin.id,
  );

  createItem(
    db,
    {
      code: 'DEMO-BME280',
      name: 'BME280 温湿度气压模块',
      categoryId: sensors.id,
      locationId: drawer.id,
      unit: '个',
      quantity: 8,
      minQuantity: 3,
      price: 6,
    },
    admin.id,
  );

  const pi = createItem(
    db,
    {
      code: 'DEMO-RPI',
      name: '树莓派 4B',
      categoryId: boards.id,
      locationId: drawer.id,
      unit: '台',
      trackingMode: 'instance',
      price: 420,
    },
    admin.id,
  );
  createInstancesBatch(db, pi.id, { count: 2, prefix: 'DEMO-RPI' }, admin.id);

  console.log('演示数据已写入：3 个分类、3 个位置、3 个物料（其中 2 个实例）。');
} catch (error) {
  console.error(`写入失败：${error.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
