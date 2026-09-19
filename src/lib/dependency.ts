import type { Asset } from '../types';

/**
 * 构建「被依赖方 → 依赖方」的反向邻接表。
 * 若 A.dependsOn 包含 B，则 dependents[B] 中包含 A。
 * 返回的列表按 id 字典序排序，保证后续遍历顺序确定。
 */
export function buildDependentsMap(assets: readonly Asset[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const asset of assets) {
    for (const dep of asset.dependsOn) {
      const list = map.get(dep) ?? [];
      list.push(asset.id);
      map.set(dep, list);
    }
  }
  for (const list of map.values()) {
    list.sort();
  }
  return map;
}

/**
 * 反向依赖闭包：从每个变更资源出发，沿「被谁依赖」方向遍历，
 * 找出所有（传递地）依赖变更资源的对象。
 *
 * 返回 Map<目标资源 id, 依赖链列表>。每条依赖链从变更源开始、到目标结束，
 * 例如 ['font.brand', 'css.spring', 'html.spring'] 表示
 * html.spring 经由 css.spring 依赖已变更的 font.brand。
 *
 * - 每个（变更源, 目标）对只保留一条最短链（BFS）；
 * - 变更资源自身不出现在结果中（但可作为链的中间节点）；
 * - 对循环依赖安全（按变更源做 visited 标记）；
 * - 遍历顺序确定：变更源按字典序、邻接表按字典序。
 */
export function reverseClosure(
  assets: readonly Asset[],
  changedIds: readonly string[],
): Map<string, string[][]> {
  const dependents = buildDependentsMap(assets);
  const changed = new Set(changedIds);
  const result = new Map<string, string[][]>();

  for (const root of [...changed].sort()) {
    const visited = new Set<string>([root]);
    const queue: Array<{ id: string; chain: string[] }> = [{ id: root, chain: [root] }];
    while (queue.length > 0) {
      const { id, chain } = queue.shift()!;
      for (const next of dependents.get(id) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        const nextChain = [...chain, next];
        if (!changed.has(next)) {
          const chains = result.get(next) ?? [];
          chains.push(nextChain);
          result.set(next, chains);
        }
        queue.push({ id: next, chain: nextChain });
      }
    }
  }

  // 链列表排序，保证输出稳定
  for (const chains of result.values()) {
    chains.sort((a, b) => a.join('>').localeCompare(b.join('>')));
  }
  return result;
}
