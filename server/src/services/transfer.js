import { withTransaction } from '../db/connection.js';
import { ERROR } from '../lib/errors.js';
import { buildPathMap } from '../lib/tree.js';
import { nowIso } from '../lib/time.js';

const ALIASES = {
  name: ['名称', 'name'],
  code: ['编号', 'code'],
  category: ['分类', 'category'],
  location: ['位置', 'location'],
  manufacturer: ['厂商', 'manufacturer'],
  model: ['型号', 'model'],
  spec: ['规格', 'spec'],
  unit: ['单位', 'unit'],
  quantity: ['数量', 'quantity'],
  minQuantity: ['低库存阈值', 'minquantity', 'min_quantity', '低库存'],
  price: ['价格', 'price'],
  purchaseDate: ['购买日期', 'purchasedate', 'purchase_date'],
  note: ['备注', 'note'],
  trackingMode: ['追踪模式', 'trackingmode', 'tracking_mode'],
};

function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase();
}

/** 简单的 RFC 4180 解析：支持引号、转义引号、字段内逗号与换行 */
export function parseCsv(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r') {
      // 忽略 CR，下一轮处理 LF
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ''));
}

function headerIndex(header) {
  const index = {};
  const normalized = header.map(normalizeHeader);
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const position = normalized.findIndex((value) => aliases.includes(value));
    if (position >= 0) index[field] = position;
  }
  return index;
}

function cell(cells, index, field) {
  if (index[field] === undefined) return '';
  return String(cells[index[field]] ?? '').trim();
}

function parseInteger(value, field, label, errors, { min = 0, max = 1000000, fallback = 0 } = {}) {
  if (value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    errors.push(`${label}必须是 ${min}–${max} 的整数`);
    return fallback;
  }
  return number;
}

function parseDraft(cells, index, line) {
  const errors = [];
  const name = cell(cells, index, 'name');
  if (!name) errors.push('名称不能为空');
  if (name.length > 200) errors.push('名称过长');

  const trackingMode = cell(cells, index, 'trackingMode') || 'quantity';
  if (!['quantity', 'instance'].includes(trackingMode)) {
    errors.push('追踪模式只能是 quantity 或 instance');
  }

  const quantity = parseInteger(cell(cells, index, 'quantity'), 'quantity', '数量', errors);
  if (trackingMode === 'instance' && quantity !== 0) {
    errors.push('实例制物料的数量必须为 0');
  }

  const minQuantity = parseInteger(
    cell(cells, index, 'minQuantity'),
    'minQuantity',
    '低库存阈值',
    errors,
  );

  const priceText = cell(cells, index, 'price');
  let price = null;
  if (priceText !== '') {
    price = Number(priceText);
    if (!Number.isFinite(price) || price < 0) errors.push('价格必须是非负数字');
  }

  const purchaseDate = cell(cells, index, 'purchaseDate') || null;
  if (purchaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
    errors.push('购买日期格式应为 YYYY-MM-DD');
  }

  return {
    line,
    errors,
    data: {
      name,
      code: cell(cells, index, 'code') || null,
      category: cell(cells, index, 'category') || null,
      location: cell(cells, index, 'location') || null,
      manufacturer: cell(cells, index, 'manufacturer') || null,
      model: cell(cells, index, 'model') || null,
      spec: cell(cells, index, 'spec') || null,
      unit: cell(cells, index, 'unit') || '个',
      quantity,
      minQuantity,
      price,
      purchaseDate,
      note: cell(cells, index, 'note') || null,
      trackingMode,
    },
  };
}

function parseItems(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) throw ERROR.validation('CSV 内容为空');

  const index = headerIndex(rows[0]);
  if (index.name === undefined) throw ERROR.validation('CSV 缺少「名称」列');

  const drafts = [];
  const errors = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const draft = parseDraft(rows[rowIndex], index, rowIndex + 1);
    drafts.push(draft);
    for (const message of draft.errors) {
      errors.push({ line: draft.line, field: 'row', message });
    }
  }
  return { drafts, errors };
}

function findExisting(db, data) {
  if (data.code) {
    return { item: db.prepare('SELECT * FROM item WHERE code = ?').get(data.code) ?? null };
  }
  const matches = db
    .prepare("SELECT * FROM item WHERE name = ? AND COALESCE(model, '') = ? AND unit = ?")
    .all(data.name, data.model ?? '', data.unit);
  if (matches.length > 1) {
    return { item: null, multiple: true };
  }
  return { item: matches[0] ?? null };
}

export function previewImport(db, text) {
  const { drafts, errors } = parseItems(text);
  const summary = { rows: drafts.length, create: 0, update: 0, unchanged: 0, error: 0 };
  const preview = [];

  for (const draft of drafts) {
    if (draft.errors.length > 0) {
      summary.error += 1;
      continue;
    }
    const { item: existing, multiple } = findExisting(db, draft.data);
    if (multiple) {
      summary.error += 1;
      errors.push({ line: draft.line, field: 'name', message: '同名同型号物料有多条，请补充编号' });
      continue;
    }

    if (!existing) {
      summary.create += 1;
      preview.push({
        line: draft.line,
        action: 'create',
        name: draft.data.name,
        quantityBefore: 0,
        quantityAfter: draft.data.quantity,
      });
      continue;
    }

    const delta = draft.data.quantity - Number(existing.quantity);
    if (delta === 0) {
      summary.unchanged += 1;
      preview.push({ line: draft.line, action: 'unchanged', name: draft.data.name });
    } else {
      summary.update += 1;
      preview.push({
        line: draft.line,
        action: 'update',
        name: draft.data.name,
        quantityBefore: Number(existing.quantity),
        quantityAfter: draft.data.quantity,
        delta,
      });
    }
  }

  return { summary, errors: errors.slice(0, 100), preview: preview.slice(0, 100) };
}

function ensurePath(db, table, pathText) {
  const segments = String(pathText)
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return { id: null, created: 0 };
  if (segments.length > 5) throw ERROR.validation(`层级过深：${pathText}`);

  const find = db.prepare(
    `SELECT id FROM ${table} WHERE parent_id IS ? AND name = ? COLLATE NOCASE`,
  );
  const insert = db.prepare(
    `INSERT INTO ${table} (parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  );

  const now = nowIso();
  let parentId = null;
  let created = 0;
  for (const segment of segments) {
    const existing = find.get(parentId, segment);
    if (existing) {
      parentId = Number(existing.id);
    } else {
      const result = insert.run(parentId, segment, now, now);
      parentId = Number(result.lastInsertRowid);
      created += 1;
    }
  }
  return { id: parentId, created };
}

export function commitImport(db, text, userId) {
  const { drafts, errors } = parseItems(text);
  if (errors.length > 0) {
    throw ERROR.validation('CSV 存在错误，请先修正后再导入', { errors: errors.slice(0, 50) });
  }

  return withTransaction(db, () => {
    const summary = {
      rows: drafts.length,
      create: 0,
      update: 0,
      unchanged: 0,
      quantityAdjusted: 0,
      createdCategories: 0,
      createdLocations: 0,
    };
    const now = nowIso();

    for (const draft of drafts) {
      const data = draft.data;
      const category = data.category ? ensurePath(db, 'category', data.category) : { id: null, created: 0 };
      const location = data.location ? ensurePath(db, 'location', data.location) : { id: null, created: 0 };
      summary.createdCategories += category.created;
      summary.createdLocations += location.created;

      const { item: existing, multiple } = findExisting(db, data);
      if (multiple) {
        throw ERROR.validation(`第 ${draft.line} 行匹配到多条物料，请补充编号`);
      }

      const priceCents = data.price == null ? null : Math.round(data.price * 100);

      if (!existing) {
        const inserted = db
          .prepare(
            `INSERT INTO item (
               code, name, category_id, location_id, manufacturer, model, spec, unit,
               tracking_mode, quantity, min_quantity, price_cents, purchase_date, note,
               created_by, updated_by, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            data.code,
            data.name,
            category.id,
            location.id,
            data.manufacturer,
            data.model,
            data.spec,
            data.unit,
            data.trackingMode,
            data.quantity,
            data.minQuantity,
            priceCents,
            data.purchaseDate,
            data.note,
            userId,
            userId,
            now,
            now,
          );

        if (data.quantity > 0) {
          db.prepare(
            `INSERT INTO movement (
               item_id, user_id, type, quantity, quantity_delta, balance_after, note, occurred_at, created_at
             ) VALUES (?, ?, 'in', ?, ?, ?, 'CSV 导入', ?, ?)`,
          ).run(
            Number(inserted.lastInsertRowid),
            userId,
            data.quantity,
            data.quantity,
            data.quantity,
            now,
            now,
          );
        }
        summary.create += 1;
        continue;
      }

      const itemId = Number(existing.id);
      const instanceCount = Number(
        db.prepare('SELECT COUNT(*) AS c FROM item_instance WHERE item_id = ?').get(itemId).c,
      );
      if (
        data.trackingMode !== existing.tracking_mode &&
        (Number(existing.quantity) > 0 || instanceCount > 0)
      ) {
        throw ERROR.conflict(`第 ${draft.line} 行：已有库存或实例，不能切换追踪模式`);
      }

      db.prepare(
        `UPDATE item SET
           name = ?, code = ?, category_id = ?, location_id = ?, manufacturer = ?, model = ?,
           spec = ?, unit = ?, tracking_mode = ?, min_quantity = ?, price_cents = ?,
           purchase_date = ?, note = ?, updated_by = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        data.name,
        data.code ?? existing.code,
        category.id,
        location.id,
        data.manufacturer,
        data.model,
        data.spec,
        data.unit,
        data.trackingMode,
        data.minQuantity,
        priceCents,
        data.purchaseDate,
        data.note,
        userId,
        now,
        itemId,
      );

      const delta = data.quantity - Number(existing.quantity);
      if (delta !== 0) {
        if (data.trackingMode === 'instance') {
          throw ERROR.validation(`第 ${draft.line} 行：实例制物料不能设置数量`);
        }
        db.prepare('UPDATE item SET quantity = ?, updated_at = ? WHERE id = ?').run(
          data.quantity,
          now,
          itemId,
        );
        db.prepare(
          `INSERT INTO movement (
             item_id, user_id, type, quantity, quantity_delta, balance_after, note, occurred_at, created_at
           ) VALUES (?, ?, 'adjust', ?, ?, ?, 'CSV 导入', ?, ?)`,
        ).run(itemId, userId, Math.abs(delta), delta, data.quantity, now, now);
        summary.quantityAdjusted += 1;
      }
      summary.update += 1;
    }

    return summary;
  });
}

function escapeCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(headers, rows) {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function exportItemsCsv(db) {
  const categories = buildPathMap(db.prepare('SELECT id, parent_id, name FROM category').all());
  const locations = buildPathMap(db.prepare('SELECT id, parent_id, name FROM location').all());
  const rows = db
    .prepare('SELECT * FROM item ORDER BY id ASC')
    .all()
    .map((item) => [
      item.name,
      item.code,
      item.category_id == null ? '' : (categories.get(Number(item.category_id)) ?? ''),
      item.location_id == null ? '' : (locations.get(Number(item.location_id)) ?? ''),
      item.manufacturer,
      item.model,
      item.spec,
      item.unit,
      item.quantity,
      item.min_quantity,
      item.price_cents == null ? '' : (Number(item.price_cents) / 100).toFixed(2),
      item.purchase_date,
      item.note,
      item.tracking_mode,
      item.is_archived ? '是' : '否',
    ]);

  return toCsv(
    ['名称', '编号', '分类', '位置', '厂商', '型号', '规格', '单位', '数量', '低库存阈值', '价格', '购买日期', '备注', '追踪模式', '已归档'],
    rows,
  );
}

export function exportMovementsCsv(db) {
  const rows = db
    .prepare(
      `SELECT m.*, i.name AS item_name, u.username AS user_name
       FROM movement m JOIN item i ON i.id = m.item_id JOIN user u ON u.id = m.user_id
       ORDER BY m.occurred_at DESC, m.id DESC LIMIT 100000`,
    )
    .all()
    .map((row) => [
      row.occurred_at,
      row.item_name,
      row.type,
      row.quantity,
      row.quantity_delta,
      row.balance_after,
      row.user_name,
      row.note,
    ]);
  return toCsv(['时间', '物料', '类型', '数量', '数量变动', '操作后余额', '操作人', '备注'], rows);
}

export function exportLoansCsv(db) {
  const rows = db
    .prepare(
      `SELECT l.*, i.name AS item_name FROM loan l JOIN item i ON i.id = l.item_id
       ORDER BY l.borrowed_at DESC, l.id DESC`,
    )
    .all()
    .map((row) => [
      row.item_name,
      row.borrower,
      row.quantity,
      row.returned_quantity,
      row.borrowed_at,
      row.due_at,
      row.returned_at,
      row.contact,
      row.note,
    ]);
  return toCsv(
    ['物料', '借用人', '借出数量', '已归还', '借出时间', '预计归还', '实际归还', '联系方式', '备注'],
    rows,
  );
}
