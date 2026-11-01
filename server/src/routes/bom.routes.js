import { ERROR } from '../lib/errors.js';
import { matchBom, rematchGroups, resolveOptions, kindOfKey } from '../services/bom.js';
import {
  deleteAlias,
  deleteAliasByKey,
  listAliases,
  upsertAlias,
} from '../services/bom-alias.js';
import { recordAudit } from '../services/audit-log.js';

const MAX_BOM_BYTES = 4 * 1024 * 1024;
const MAX_GROUPS = 10000;

function enforce(limiter, key) {
  const result = limiter.hit(key);
  if (!result.ok) {
    throw ERROR.rateLimited('操作太频繁，请稍后再试', result.retryAfter);
  }
}

/**
 * BOM 匹配接口：预览与覆盖重算只读；人工对应关系可写，限管理员并记审计。
 * 支持 multipart 上传（.csv / .xlsx）与 JSON（{ csvText }）。
 * @param {import('fastify').FastifyInstance} app
 */
export default async function bomRoutes(app) {
  const { db } = app;

  app.post('/api/bom/preview', { preHandler: app.authenticate }, async (request) => {
    const sets = request.query?.sets ?? request.body?.sets;

    if (request.isMultipart()) {
      let part;
      try {
        part = await request.file();
      } catch {
        throw ERROR.validation('没有收到 BOM 文件');
      }
      if (!part) throw ERROR.validation('没有收到 BOM 文件');

      let buffer;
      try {
        buffer = await part.toBuffer();
      } catch (error) {
        if (String(error.code).includes('FILE_TOO_LARGE') || String(error.message).includes('too large')) {
          throw ERROR.payloadTooLarge('BOM 文件不能超过 4MB');
        }
        throw error;
      }
      if (buffer.length > MAX_BOM_BYTES) throw ERROR.payloadTooLarge('BOM 文件不能超过 4MB');

      // fastify-multipart 会把普通字段放进 part.fields
      const fields = part.fields ?? {};
      return matchBom(db, {
        buffer,
        filename: part.filename,
        sets: fields.sets?.value ?? sets,
        options: fields.options?.value,
      });
    }

    const text = typeof request.body?.csvText === 'string' ? request.body.csvText : null;
    if (!text) throw ERROR.validation('请上传 BOM 文件，或在 csvText 中提供内容');
    if (Buffer.byteLength(text) > MAX_BOM_BYTES) throw ERROR.payloadTooLarge('BOM 文件不能超过 4MB');

    return matchBom(db, {
      text,
      sets,
      options: request.body?.options,
      overrides: request.body?.overrides,
    });
  });

  /**
   * 覆盖重算：把人工选定/接受差异应用到已有分组上，重新算库存、缺口与可支持套数。
   * 纯计算，不落库，方便前端即时预览。
   */
  app.post('/api/bom/apply', { preHandler: app.authenticate }, async (request) => {
    const groups = request.body?.groups;
    if (Array.isArray(groups) && groups.length > MAX_GROUPS) {
      throw ERROR.payloadTooLarge(`BOM 分组超过 ${MAX_GROUPS} 组，请拆分后再处理`);
    }

    return rematchGroups(db, groups, {
      sets: request.body?.sets,
      options: request.body?.options,
      overrides: request.body?.overrides,
    });
  });

  /** 匹配选项的默认值，供前端初始化表单 */
  app.get('/api/bom/options', { preHandler: app.authenticate }, async () => ({
    defaults: resolveOptions(null),
    tolerances: ['strict', 'family', 'ignore'],
  }));

  /** 已记住的人工对应关系 */
  app.get('/api/bom/aliases', { preHandler: app.authenticate }, async () => ({
    data: listAliases(db),
  }));

  /**
   * 记住 / 撤销一条「BOM 行 → 物料」对应。
   * action: bind（指定物料）| accept（接受差异，视为完全匹配）| unbind（撤销）
   */
  app.post('/api/bom/resolve', { preHandler: app.requireAdmin }, async (request, reply) => {
    const action = String(request.body?.action ?? 'bind');
    const matchKey = request.body?.matchKey;
    const itemId = request.body?.itemId;

    enforce(app.limiters.bomAlias, String(request.user.id));

    if (action === 'unbind') {
      const removed = deleteAliasByKey(db, matchKey);
      if (removed) {
        recordAudit(db, {
          actorId: request.user.id,
          action: 'bom.alias.delete',
          targetType: 'bom_alias',
          targetId: removed.id,
          detail: { matchKey: removed.matchKey, itemId: removed.itemId },
          ipHash: request.ipHash,
        });
      }
      return { removed: Boolean(removed) };
    }

    if (action !== 'bind' && action !== 'accept') {
      throw ERROR.validation('action 只能是 bind / accept / unbind');
    }
    if (itemId === undefined || itemId === null) {
      throw ERROR.validation('请选择要绑定的物料');
    }

    const saved = upsertAlias(db, {
      matchKey,
      kind: kindOfKey(matchKey),
      itemId,
      skipParams: action === 'accept' || request.body?.skipParams === true,
      note: typeof request.body?.note === 'string' ? request.body.note.slice(0, 200) : null,
      actorId: request.user.id,
    });

    recordAudit(db, {
      actorId: request.user.id,
      action: action === 'accept' ? 'bom.alias.accept' : 'bom.alias.create',
      targetType: 'bom_alias',
      targetId: saved.id,
      detail: { matchKey: saved.matchKey, itemId: saved.itemId, skipParams: saved.skipParams },
      ipHash: request.ipHash,
    });

    return reply.code(action === 'accept' ? 200 : 201).send({ alias: saved });
  });

  app.delete('/api/bom/aliases/:id', { preHandler: app.requireAdmin }, async (request) => {
    enforce(app.limiters.bomAlias, String(request.user.id));

    const removed = deleteAlias(db, request.params.id);
    recordAudit(db, {
      actorId: request.user.id,
      action: 'bom.alias.delete',
      targetType: 'bom_alias',
      targetId: removed.id,
      detail: { matchKey: removed.matchKey, itemId: removed.itemId },
      ipHash: request.ipHash,
    });
    return { removed: true };
  });
}
