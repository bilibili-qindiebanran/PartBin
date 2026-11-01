import { ERROR } from '../lib/errors.js';
import { optionalId, optionalString, requireId, requireInt } from '../lib/validate.js';
import { normalizeLcscCode, lookupLcsc } from './lcsc.js';
import { createItem, findItemByLcscCode, getItem, updateItem } from './items.js';
import { recordMovement } from './movements.js';

/** 订单号 → 流水/备注文案 */
function orderNote(orderNo) {
  const text = optionalString(orderNo, '订单号', { max: 60 });
  return text ? `立创订单 ${text}` : '快速入库';
}

/**
 * 快速入库预览：查立创信息，并判断库存里是否已有同料号物料。
 * 上游查不到/连不上时不报错，返回 part=null + warning，前端仍可手工补全后入库。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} rawCode
 * @param {Parameters<typeof lookupLcsc>[2]} [options]
 */
export async function previewQuickIn(db, rawCode, options = {}) {
  // 先本地查重，上游失败也不影响「累加到已有物料」
  const existing = findItemByLcscCode(db, normalizeLcscCode(rawCode));

  try {
    const { part, cached, source } = await lookupLcsc(db, rawCode, options);
    return { part, existing, cached, source, warning: null };
  } catch (error) {
    const degradable =
      error?.code === 'UPSTREAM_UNAVAILABLE' || error?.code === 'NOT_FOUND';
    if (!degradable) throw error;
    return {
      part: null,
      existing,
      cached: false,
      source: null,
      warning: error.message,
    };
  }
}

/**
 * 快速入库提交：
 * - mode=add：把数量累加到已有物料（料号必须一致），必要时补位置；
 * - mode=create：用预览时填写的字段新建数量制物料。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Record<string, any>} input
 * @param {number} userId
 */
export function commitQuickIn(db, input = {}, userId) {
  const code = normalizeLcscCode(input.code);
  const quantity = requireInt(input.quantity, '入库数量', { min: 1, max: 1000000 });
  const locationId = optionalId(input.locationId, '位置');
  const note = orderNote(input.orderNo);

  if (input.mode === 'add') {
    const itemId = requireId(input.itemId, '物料');
    const existing = getItem(db, itemId);
    if (existing.isArchived) {
      throw ERROR.conflict('该物料已归档，请先恢复后再入库');
    }
    if (existing.lcscCode !== code) {
      throw ERROR.validation('该物料的立创料号与扫码结果不一致');
    }

    const result = recordMovement(db, {
      itemId,
      type: 'in',
      quantity,
      note,
      userId,
    });

    // 已有物料还没有位置时，用本次选择的位置补上（分类盒的格位不在这里处理）
    if (locationId != null && existing.locationId == null) {
      updateItem(db, itemId, { locationId }, userId);
    }

    return {
      mode: 'add',
      created: false,
      item: getItem(db, itemId),
      movement: result.movement,
    };
  }

  if (input.mode === 'create') {
    const fields = input.item ?? {};
    const name = optionalString(fields.name, '物料名称', { max: 200 }) ?? code;

    const item = createItem(
      db,
      {
        ...fields,
        name,
        trackingMode: 'quantity',
        quantity,
        lcscCode: code,
        lcscMatched: true,
        locationId,
        // 备注留空时把订单号写进去，便于回溯来源
        note: optionalString(fields.note, '备注', { max: 2000 }) ?? note,
        initialNote: note,
      },
      userId,
    );

    return { mode: 'create', created: true, item, movement: null };
  }

  throw ERROR.validation('请选择入库方式');
}
