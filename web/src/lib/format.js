/** 日期展示：UTC ISO → 本地时间 */
export function formatDate(iso, { withTime = false } = {}) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
  }).format(date);
}

/** 金额：数据库以分存储，接口返回元 */
export function formatMoney(value) {
  if (value == null) return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `¥${number.toFixed(2)}`;
}
