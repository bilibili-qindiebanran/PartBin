/**
 * 立创商城/嘉立创 SMT 标签二维码解析。
 *
 * 标签原文示例：
 *   {on:SO2610270429,pc:C49329911,pm:XTM32021250JT00351001,qty:10,mc:,cc:1,pdi:244912256,hp:null}
 *
 * 字段约定（已与仓库维护者确认）：
 *   pc → 立创料号（C 开头）
 *   pm → 型号
 *   mc → 厂商（标签里常为空）
 *   qty → 入库数量
 *   on → 订单号（写入备注，便于回溯）
 *   cc / pdi / hp → 暂不使用
 */

const CODE_RE = /C\d{4,10}/;

/** 去掉引号、首尾空白；null/undefined 归一为空串 */
function clean(value) {
  if (value == null) return '';
  return String(value)
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

/** `{a:1,b:2}` 这类无引号键值对 → 普通对象 */
function parseCompact(text) {
  const body = text.replace(/^\{/, '').replace(/\}$/, '');
  const fields = {};
  for (const chunk of body.split(',')) {
    const index = chunk.indexOf(':');
    if (index < 0) continue;
    const key = clean(chunk.slice(0, index)).toLowerCase();
    if (!key) continue;
    fields[key] = clean(chunk.slice(index + 1));
  }
  return fields;
}

/** 可能是 JSON、`{k:v}` 或纯文本；返回小写键的对象 */
function parseFields(text) {
  if (text.startsWith('{')) {
    try {
      const json = JSON.parse(text);
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        return Object.fromEntries(
          Object.entries(json).map(([key, value]) => [key.toLowerCase(), clean(value)]),
        );
      }
    } catch {
      return parseCompact(text);
    }
  }
  return parseCompact(text);
}

/** 归一化立创料号：接受 C2286 / c2286 / 含料号的文本 */
export function normalizeLcscCode(value) {
  const text = clean(value).toUpperCase();
  if (text === '') return null;
  const match = text.match(CODE_RE);
  return match ? match[0] : null;
}

function parseQuantity(value) {
  const number = Number.parseInt(clean(value), 10);
  return Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * 解析扫码结果。
 * @param {string} rawText 二维码原文
 * @returns {{
 *   raw: string, code: string|null, quantity: number|null, orderNo: string|null,
 *   model: string|null, manufacturer: string|null
 * } | null} 无法识别出料号时返回 null
 */
export function parseLcscQr(rawText) {
  const text = clean(rawText);
  if (text === '') return null;

  const fields = parseFields(text);
  const code = normalizeLcscCode(fields.pc ?? fields.code ?? '') ?? normalizeLcscCode(text);
  if (!code) return null;

  return {
    raw: text,
    code,
    quantity: parseQuantity(fields.qty ?? fields.quantity),
    orderNo: fields.on || fields.order || null,
    model: fields.pm || fields.model || null,
    manufacturer: fields.mc || fields.manufacturer || null,
  };
}
