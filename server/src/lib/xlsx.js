import zlib from 'node:zlib';
import { ERROR } from './errors.js';

/**
 * 极简 xlsx 读取：只取第一个工作表的值，不解析样式与公式结果之外的元数据。
 * 之所以自己实现：BOM 只需要「按行列读出文本」，避免为一个功能引入整套 Excel 依赖。
 */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value;
  }
  return table;
})();

/** 供测试与写 zip 用 */
export function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function findEocd(buffer) {
  const min = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIG) return offset;
  }
  return -1;
}

/** 读取 zip 中央目录，返回 { 文件名: Buffer } */
export function readZipEntries(buffer) {
  const eocd = findEocd(buffer);
  if (eocd < 0) throw ERROR.validation('不是有效的 xlsx 文件');

  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = {};

  for (let i = 0; i < total; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw ERROR.validation('xlsx 中央目录损坏');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw ERROR.validation(`xlsx 条目损坏：${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      entries[name] = raw;
    } else if (method === 8) {
      entries[name] = zlib.inflateRawSync(raw);
    } else {
      throw ERROR.validation(`xlsx 使用了不支持的压缩方式（${method}）`);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function textOf(xml) {
  let out = '';
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let match;
  while ((match = re.exec(xml)) !== null) out += decodeEntities(match[1]);
  return out;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const list = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match;
  while ((match = re.exec(xml)) !== null) list.push(textOf(match[1]));
  return list;
}

/** A1 → 0；AA3 → 26 */
export function columnIndex(ref) {
  const letters = String(ref).match(/^[A-Z]+/);
  if (!letters) return -1;
  let index = 0;
  for (const char of letters[0]) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function parseRow(cellsXml, sharedStrings) {
  const values = [];
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let match;
  let nextIndex = 0;

  while ((match = cellRe.exec(cellsXml)) !== null) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    const refMatch = attrs.match(/\br="([A-Z]+\d+)"/);
    const typeMatch = attrs.match(/\bt="([^"]+)"/);

    const index = refMatch ? columnIndex(refMatch[1]) : nextIndex;
    if (index < 0) continue;
    nextIndex = index + 1;

    let value = '';
    const type = typeMatch?.[1];
    if (type === 'inlineStr') {
      value = textOf(body);
    } else if (type === 's') {
      const v = body.match(/<v>([\s\S]*?)<\/v>/);
      const position = v ? Number(v[1]) : -1;
      value = Number.isInteger(position) ? sharedStrings[position] ?? '' : '';
    } else {
      const v = body.match(/<v>([\s\S]*?)<\/v>/);
      if (v) value = decodeEntities(v[1]);
      else if (body.includes('<t')) value = textOf(body);
    }

    values[index] = value;
  }

  for (let i = 0; i < values.length; i += 1) {
    if (values[i] === undefined) values[i] = '';
  }
  return values;
}

function isBlankRow(row) {
  return !row || row.every((cell) => String(cell ?? '').trim() === '');
}

/** 找到工作簿里第一个工作表在包内的路径 */
function firstSheetPath(files) {
  const workbook = files['xl/workbook.xml']?.toString('utf8');
  const rels = files['xl/_rels/workbook.xml.rels']?.toString('utf8');

  if (workbook && rels) {
    const sheet = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"[^>]*\/?>/);
    const relId = sheet?.[1];
    if (relId) {
      const relRe = /<Relationship\b([^>]*)\/?>/g;
      let rel;
      while ((rel = relRe.exec(rels)) !== null) {
        const attrs = rel[1];
        if (!new RegExp(`\\bId="${relId}"`).test(attrs)) continue;
        const target = attrs.match(/\bTarget="([^"]+)"/)?.[1];
        if (!target) continue;
        const path = target.startsWith('/')
          ? target.slice(1)
          : `xl/${target.replace(/^\.\//, '')}`;
        if (files[path]) return path;
      }
    }
  }

  const fallbacks = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  return fallbacks[0] ?? null;
}

/**
 * 读取 xlsx 第一个工作表，返回字符串二维数组。
 * @param {Buffer} buffer
 * @returns {string[][]}
 */
export function readXlsxRows(buffer) {
  const files = readZipEntries(buffer);
  const sheetPath = firstSheetPath(files);
  if (!sheetPath) throw ERROR.validation('xlsx 中没有可用的工作表');

  const sharedStrings = parseSharedStrings(files['xl/sharedStrings.xml']?.toString('utf8'));
  const sheetXml = files[sheetPath].toString('utf8');

  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let match;
  while ((match = rowRe.exec(sheetXml)) !== null) {
    const row = parseRow(match[1], sharedStrings);
    if (!isBlankRow(row)) rows.push(row);
  }

  // 只有内联在 <sheetData> 之外没有 <row> 标签的极简表：按 c 标签顺序兜底解析
  if (rows.length === 0) {
    const body = sheetXml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/)?.[1];
    if (body) {
      const row = parseRow(body, sharedStrings);
      if (!isBlankRow(row)) rows.push(row);
    }
  }

  return rows;
}

/** 按魔数判断是否为 xlsx/zip */
export function isZipBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 4 && buffer.readUInt32LE(0) === LOCAL_SIG;
}
