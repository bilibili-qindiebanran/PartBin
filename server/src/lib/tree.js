import { ERROR } from './errors.js';

/**
 * 把扁平行构建成树。行需包含 id、parent_id、name、sort_order。
 * 返回节点带 children，按 sort_order、中文名称排序。
 */
export function buildTree(rows) {
  const nodes = new Map();

  for (const row of rows) {
    const id = Number(row.id);
    nodes.set(id, {
      ...row,
      id,
      parentId: row.parent_id == null ? null : Number(row.parent_id),
      children: [],
    });
  }

  const roots = [];
  for (const node of nodes.values()) {
    if (node.parentId != null && nodes.has(node.parentId)) {
      nodes.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (list) => {
    list.sort(
      (a, b) =>
        Number(a.sort_order) - Number(b.sort_order) ||
        String(a.name).localeCompare(String(b.name), 'zh-CN'),
    );
    for (const node of list) sortNodes(node.children);
  };
  sortNodes(roots);

  return roots;
}

/** 某个节点及其全部子孙的 id 集合（包含自身） */
export function descendantIds(rows, rootId) {
  const childrenByParent = new Map();
  for (const row of rows) {
    const parentId = row.parent_id == null ? null : Number(row.parent_id);
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(Number(row.id));
  }

  const result = new Set();
  const stack = [Number(rootId)];
  while (stack.length > 0) {
    const current = stack.pop();
    if (result.has(current)) continue;
    result.add(current);
    for (const child of childrenByParent.get(current) ?? []) stack.push(child);
  }
  return result;
}

/** 构建 id → "父/子/孙" 路径映射 */
export function buildPathMap(rows) {
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const paths = new Map();

  const pathOf = (id, seen = new Set()) => {
    if (paths.has(id)) return paths.get(id);
    const row = byId.get(id);
    if (!row) return '';
    if (seen.has(id)) return row.name; // 防御历史脏数据中的环

    seen.add(id);
    const parentId = row.parent_id == null ? null : Number(row.parent_id);
    const parentPath = parentId ? pathOf(parentId, seen) : '';
    const path = parentPath ? `${parentPath}/${row.name}` : row.name;
    paths.set(id, path);
    return path;
  };

  for (const row of rows) pathOf(Number(row.id));
  return paths;
}

/** 把节点挂到自己的子孙下会形成环，必须拒绝 */
export function assertNoCycle(rows, id, parentId) {
  if (parentId == null) return;

  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const guard = new Set();
  let current = Number(parentId);

  while (current != null) {
    if (current === Number(id)) throw ERROR.treeCycle();
    if (guard.has(current)) throw ERROR.treeCycle();
    guard.add(current);
    const parent = byId.get(current);
    current = parent?.parent_id == null ? null : Number(parent.parent_id);
  }
}
