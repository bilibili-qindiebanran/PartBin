import { withTransaction } from '../db/connection.js';
import { ERROR } from '../lib/errors.js';
import { buildPathMap, descendantIds } from '../lib/tree.js';
import { nowIso } from '../lib/time.js';
import {
  optionalDate,
  optionalId,
  optionalInt,
  optionalNumber,
  optionalString,
  requireEnum,
  requireId,
  requireInt,
  requireString,
} from '../lib/validate.js';

const ITEM_SELECT = `
  SELECT i.*,
    COALESCE((
      SELECT SUM(l.quantity - l.returned_quantity)
      FROM loan l
      WHERE l.item_id = i.id AND l.returned_quantity < l.quantity
    ), 0) AS lent_quantity,
    (
      SELECT COUNT(*) FROM item_instance ii
      WHERE ii.item_id = i.id AND ii.status <> 'retired'
    ) AS instance_count,
    (
      SELECT ip.photo_id FROM item_photo ip
      WHERE ip.item_id = i.id
      ORDER BY ip.sort_order ASC, ip.photo_id ASC
      LIMIT 1
    ) AS cover_photo_id
  FROM item i
`;

const SORT_COLUMNS = {
  name: 'i.name COLLATE NOCASE',
  quantity: 'i.quantity',
  updated_at: 'i.updated_at',
  created_at: 'i.created_at',
  code: 'i.code COLLATE NOCASE',
};

function has(input, key) {
  return Object.prototype.hasOwnProperty.call(input ?? {}, key);
}

function loadTaxonomies(db) {
  const categoryRows = db.prepare('SELECT id, parent_id, name FROM category').all();
  const locationRows = db.prepare('SELECT id, parent_id, name FROM location').all();
  return {
    categoryRows,
    locationRows,
    categoryPaths: buildPathMap(categoryRows),
    locationPaths: buildPathMap(locationRows),
  };
}

function ensureRef(db, table, id, label) {
  if (id == null) return null;
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw ERROR.validation(`${label}不存在`);
  return id;
}

function toCents(value) {
  const price = optionalNumber(value, '价格', { min: 0, max: 1e9 });
  return price == null ? null : Math.round(price * 100);
}

function toPublicItem(row, taxonomies) {
  const quantity = Number(row.quantity);
  const lent = Number(row.lent_quantity ?? 0);
  const minQuantity = Number(row.min_quantity);
  const categoryId = row.category_id == null ? null : Number(row.category_id);
  const locationId = row.location_id == null ? null : Number(row.location_id);

  return {
    id: Number(row.id),
    code: row.code ?? null,
    name: row.name,
    categoryId,
    categoryPath: categoryId ? (taxonomies.categoryPaths.get(categoryId) ?? null) : null,
    locationId,
    locationPath: locationId ? (taxonomies.locationPaths.get(locationId) ?? null) : null,
    manufacturer: row.manufacturer ?? null,
    model: row.model ?? null,
    spec: row.spec ?? null,
    unit: row.unit,
    trackingMode: row.tracking_mode,
    quantity,
    lentQuantity: lent,
    available: Math.max(0, quantity - lent),
    minQuantity,
    lowStock: quantity === 0 || (minQuantity > 0 && quantity <= minQuantity),
    price: row.price_cents == null ? null : Number(row.price_cents) / 100,
    purchaseDate: row.purchase_date ?? null,
    note: row.note ?? null,
    coverPhotoId: row.cover_photo_id == null ? null : Number(row.cover_photo_id),
    instanceCount: Number(row.instance_count ?? 0),
    isArchived: Number(row.is_archived) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getRow(db, id) {
  return db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id);
}

/** 列表查询：关键字、分类/位置（含子孙）、低库存、归档、分页、排序 */
export function listItems(db, query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 20));

  const where = [];
  const params = [];
  if (query.archived !== '1') where.push('i.is_archived = 0');

  const taxonomies = loadTaxonomies(db);

  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
  if (q) {
    const tokens = q.split(/\s+/).filter(Boolean).slice(0, 8);
    for (const token of tokens) {
      const like = `%${token.replace(/[\\%_]/g, '\\$&')}%`;
      where.push(
        `(i.name LIKE ? ESCAPE '\\' OR i.model LIKE ? ESCAPE '\\' OR i.spec LIKE ? ESCAPE '\\' OR i.code LIKE ? ESCAPE '\\')`,
      );
      params.push(like, like, like, like);
    }
  }

  if (query.categoryId !== undefined && query.categoryId !== '') {
    const categoryId = requireId(query.categoryId, '分类');
    const ids = [...descendantIds(taxonomies.categoryRows, categoryId)];
    where.push(`i.category_id IN (${ids.map(() => '?').join(', ')})`);
    params.push(...ids);
  }

  if (query.locationId !== undefined && query.locationId !== '') {
    const locationId = requireId(query.locationId, '位置');
    const ids = [...descendantIds(taxonomies.locationRows, locationId)];
    where.push(`i.location_id IN (${ids.map(() => '?').join(', ')})`);
    params.push(...ids);
  }

  if (query.lowStock === '1') {
    where.push('(i.quantity = 0 OR (i.min_quantity > 0 AND i.quantity <= i.min_quantity))');
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  let sort = typeof query.sort === 'string' && query.sort !== '' ? query.sort : '-updated_at';
  let descending = sort.startsWith('-');
  if (descending) sort = sort.slice(1);
  if (!SORT_COLUMNS[sort]) {
    sort = 'updated_at';
    descending = true;
  }
  const orderSql = `${SORT_COLUMNS[sort]} ${descending ? 'DESC' : 'ASC'}, i.id ${
    descending ? 'DESC' : 'ASC'
  }`;

  const total = Number(
    db
      .prepare(`SELECT COUNT(*) AS c FROM item i ${whereSql}`)
      .get(...params).c,
  );

  const rows = db
    .prepare(`${ITEM_SELECT} ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);

  return {
    data: rows.map((row) => toPublicItem(row, taxonomies)),
    page,
    pageSize,
    total,
  };
}

/** 详情（含照片列表） */
export function getItem(db, id) {
  const row = getRow(db, id);
  if (!row) throw ERROR.notFound('物料不存在');

  const taxonomies = loadTaxonomies(db);
  const photos = db
    .prepare(
      `SELECT p.id, p.mime, p.width, p.height
       FROM item_photo ip
       JOIN photo p ON p.id = ip.photo_id
       WHERE ip.item_id = ?
       ORDER BY ip.sort_order ASC, ip.photo_id ASC`,
    )
    .all(id);

  return { ...toPublicItem(row, taxonomies), photos };
}

/** 新建物料；数量制会同时写一条初始入库流水 */
export function createItem(db, input = {}, userId) {
  return withTransaction(db, () => {
    const name = requireString(input.name, '物料名称', { min: 1, max: 200 });
    const code = optionalString(input.code, '编号', { max: 64 });
    const categoryId = ensureRef(
      db,
      'category',
      optionalId(input.categoryId, '分类'),
      '分类',
    );
    const locationId = ensureRef(
      db,
      'location',
      optionalId(input.locationId, '位置'),
      '位置',
    );
    const manufacturer = optionalString(input.manufacturer, '厂商', { max: 120 });
    const model = optionalString(input.model, '型号', { max: 120 });
    const spec = optionalString(input.spec, '规格', { max: 2000 });
    const unit = optionalString(input.unit, '单位', { max: 10 }) ?? '个';
    const trackingMode =
      input.trackingMode == null
        ? 'quantity'
        : requireEnum(input.trackingMode, '追踪模式', ['quantity', 'instance']);
    const minQuantity = optionalInt(input.minQuantity, '低库存阈值', { min: 0, max: 1000000 }) ?? 0;
    const priceCents = toCents(input.price);
    const purchaseDate = optionalDate(input.purchaseDate, '购买日期');
    const note = optionalString(input.note, '备注', { max: 2000 });

    let quantity = 0;
    if (trackingMode === 'quantity') {
      quantity = optionalInt(input.quantity, '数量', { min: 0, max: 1000000 }) ?? 0;
    } else if (input.quantity != null && Number(input.quantity) !== 0) {
      throw ERROR.validation('实例制物料的数量由实例维护，初始数量必须为 0');
    }

    const now = nowIso();
    let inserted;
    try {
      inserted = db
        .prepare(
          `INSERT INTO item (
             code, name, category_id, location_id, manufacturer, model, spec, unit,
             tracking_mode, quantity, min_quantity, price_cents, purchase_date, note,
             created_by, updated_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          code,
          name,
          categoryId,
          locationId,
          manufacturer,
          model,
          spec,
          unit,
          trackingMode,
          quantity,
          minQuantity,
          priceCents,
          purchaseDate,
          note,
          userId,
          userId,
          now,
          now,
        );
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw ERROR.duplicate('物料编号已存在');
      throw error;
    }

    const itemId = Number(inserted.lastInsertRowid);
    if (quantity > 0) {
      db.prepare(
        `INSERT INTO movement (
           item_id, user_id, type, quantity, quantity_delta, balance_after, note, occurred_at, created_at
         ) VALUES (?, ?, 'in', ?, ?, ?, ?, ?, ?)`,
      ).run(itemId, userId, quantity, quantity, quantity, '初始入库', now, now);
    }

    return getItem(db, itemId);
  });
}

/** 修改物料基本信息；数量只能通过流水修改 */
export function updateItem(db, id, input = {}, userId) {
  return withTransaction(db, () => {
    const current = getRow(db, id);
    if (!current) throw ERROR.notFound('物料不存在');

    if (has(input, 'quantity')) {
      throw ERROR.validation('数量请通过出入库流水修改');
    }

    const sets = [];
    const params = [];
    const assign = (column, value) => {
      sets.push(`${column} = ?`);
      params.push(value);
    };

    if (has(input, 'name')) assign('name', requireString(input.name, '物料名称', { min: 1, max: 200 }));
    if (has(input, 'code')) assign('code', optionalString(input.code, '编号', { max: 64 }));
    if (has(input, 'categoryId')) {
      assign(
        'category_id',
        ensureRef(db, 'category', optionalId(input.categoryId, '分类'), '分类'),
      );
    }
    if (has(input, 'locationId')) {
      assign(
        'location_id',
        ensureRef(db, 'location', optionalId(input.locationId, '位置'), '位置'),
      );
    }
    if (has(input, 'manufacturer')) {
      assign('manufacturer', optionalString(input.manufacturer, '厂商', { max: 120 }));
    }
    if (has(input, 'model')) assign('model', optionalString(input.model, '型号', { max: 120 }));
    if (has(input, 'spec')) assign('spec', optionalString(input.spec, '规格', { max: 2000 }));
    if (has(input, 'unit')) assign('unit', requireString(input.unit, '单位', { min: 1, max: 10 }));
    if (has(input, 'minQuantity')) {
      assign('min_quantity', requireInt(input.minQuantity, '低库存阈值', { min: 0, max: 1000000 }));
    }
    if (has(input, 'price')) {
      const price = optionalNumber(input.price, '价格', { min: 0, max: 1e9 });
      assign('price_cents', price == null ? null : Math.round(price * 100));
    }
    if (has(input, 'purchaseDate')) {
      assign('purchase_date', optionalDate(input.purchaseDate, '购买日期'));
    }
    if (has(input, 'note')) assign('note', optionalString(input.note, '备注', { max: 2000 }));

    if (has(input, 'trackingMode')) {
      const mode = requireEnum(input.trackingMode, '追踪模式', ['quantity', 'instance']);
      if (mode !== current.tracking_mode) {
        const instanceCount = Number(
          db
            .prepare('SELECT COUNT(*) AS c FROM item_instance WHERE item_id = ?')
            .get(id).c,
        );
        if (Number(current.quantity) > 0 || instanceCount > 0) {
          throw ERROR.conflict('已有库存或实例，不能切换追踪模式');
        }
      }
      assign('tracking_mode', mode);
    }

    if (sets.length === 0) {
      throw ERROR.validation('没有需要更新的字段');
    }

    assign('updated_by', userId);
    assign('updated_at', nowIso());

    try {
      db.prepare(`UPDATE item SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw ERROR.duplicate('物料编号已存在');
      throw error;
    }

    return getItem(db, id);
  });
}

/** 归档 / 恢复 */
export function setItemArchived(db, id, archived, userId) {
  const row = getRow(db, id);
  if (!row) throw ERROR.notFound('物料不存在');

  db.prepare('UPDATE item SET is_archived = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(
    archived ? 1 : 0,
    userId,
    nowIso(),
    id,
  );

  return getItem(db, id);
}
