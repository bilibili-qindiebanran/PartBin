/**
 * 内存滑动窗口限速器。
 * 只用于登录/注册等低频接口，重启后清零，不追求分布式能力。
 *
 * @param {{ limit: number, windowMs: number, maxEntries?: number }} options
 */
export function createRateLimiter({ limit, windowMs, maxEntries = 5000 }) {
  /** @type {Map<string, number[]>} */
  const buckets = new Map();

  /**
   * 记录一次尝试。返回 { ok, retryAfter }
   * @param {string} key
   */
  function hit(key) {
    const now = Date.now();
    const cutoff = now - windowMs;

    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
    }
    while (list.length > 0 && list[0] <= cutoff) list.shift();

    if (list.length >= limit) {
      const retryAfter = Math.max(1, Math.ceil((list[0] + windowMs - now) / 1000));
      return { ok: false, retryAfter };
    }

    list.push(now);

    if (buckets.size > maxEntries) {
      for (const [bucketKey, timestamps] of buckets) {
        const last = timestamps[timestamps.length - 1] ?? 0;
        if (last <= cutoff) buckets.delete(bucketKey);
        if (buckets.size <= maxEntries) break;
      }
    }

    return { ok: true };
  }

  /** 清空某个 key（例如登录成功后） */
  function reset(key) {
    buckets.delete(key);
  }

  return { hit, reset };
}
