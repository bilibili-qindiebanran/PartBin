/**
 * 业务错误。HTTP 层统一转换成 { error: { code, message, details } }。
 */
export class AppError extends Error {
  /**
   * @param {string} code 稳定的错误码，供前端判断
   * @param {number} status HTTP 状态码
   * @param {string} message 面向用户的中文提示
   * @param {unknown} [details] 附加信息（字段、行号、retryAfter 等）
   */
  constructor(code, status, message, details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const ERROR = {
  validation: (message, details) => new AppError('VALIDATION', 400, message, details),
  authRequired: () => new AppError('AUTH_REQUIRED', 401, '请先登录'),
  invalidCredentials: () => new AppError('INVALID_CREDENTIALS', 401, '账号或密码错误'),
  forbidden: (message = '没有权限执行该操作') => new AppError('FORBIDDEN', 403, message),
  registrationClosed: () => new AppError('REGISTRATION_CLOSED', 403, '注册已关闭，请联系管理员'),
  notFound: (message = '资源不存在') => new AppError('NOT_FOUND', 404, message),
  usernameTaken: () => new AppError('USERNAME_TAKEN', 409, '用户名已被占用'),
  duplicate: (message = '数据重复') => new AppError('DUPLICATE', 409, message),
  conflict: (message = '操作与当前状态冲突') => new AppError('CONFLICT', 409, message),
  treeCycle: () => new AppError('TREE_CYCLE', 409, '不能把节点移动到自己的子节点下'),
  insufficientStock: (message = '库存不足', details = null) =>
    new AppError('INSUFFICIENT_STOCK', 409, message, details),
  payloadTooLarge: (message = '文件过大') => new AppError('PAYLOAD_TOO_LARGE', 413, message),
  unsupportedMedia: (message = '不支持的文件类型') =>
    new AppError('UNSUPPORTED_MEDIA', 415, message),
  lastAdmin: () => new AppError('LAST_ADMIN', 409, '至少保留一个启用状态的管理员'),
  cannotDisableSelf: () => new AppError('CANNOT_DISABLE_SELF', 409, '不能禁用自己'),
  rateLimited: (message = '操作太频繁，请稍后再试', retryAfter = 60) =>
    new AppError('RATE_LIMITED', 429, message, { retryAfter }),
  internal: (message = '服务器内部错误') => new AppError('INTERNAL', 500, message),
};
