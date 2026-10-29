/**
 * 业务错误：统一承载后端返回的 code / status / details。
 */
export class ApiError extends Error {
  constructor(message, { code, status, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * 轻量 fetch 封装：同源 Cookie、JSON 编解码、统一错误。
 * @param {string} path
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal }} [options]
 */
export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('网络不可用，请检查与服务器的连接', { code: 'NETWORK', status: 0 });
  }

  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(data?.error?.message || `请求失败（${response.status}）`, {
      code: data?.error?.code,
      status: response.status,
      details: data?.error?.details,
    });
  }

  return data;
}

/** multipart 上传；其余行为与 api() 一致 */
export async function apiUpload(path, formData) {
  let response;
  try {
    response = await fetch(path, { method: 'POST', body: formData, credentials: 'same-origin' });
  } catch {
    throw new ApiError('网络不可用，请检查与服务器的连接', { code: 'NETWORK', status: 0 });
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(data?.error?.message || `请求失败（${response.status}）`, {
      code: data?.error?.code,
      status: response.status,
      details: data?.error?.details,
    });
  }
  return data;
}
