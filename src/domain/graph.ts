// ─────────────────────────────────────────────────────────────
// 引用图与依赖闭包
// 边的方向：引用方 ──refs──▶ 被引用资源
// （HTML → CSS/JS → font/img）
// ─────────────────────────────────────────────────────────────
import type { AssetNode, Version } from './types';

export interface AssetIndex {
  byId: Map<string, AssetNode>;
  /** 反向边：谁直接引用了我 */
  referrers: Map<string, string[]>;
}

export function indexAssets(assets: AssetNode[]): AssetIndex {
  const byId = new Map<string, AssetNode>();
  for (const a of assets) byId.set(a.id, a);
  const referrers = new Map<string, string[]>();
  for (const a of assets) {
    for (const ref of a.refs) {
      const list = referrers.get(ref) ?? [];
      list.push(a.id);
      referrers.set(ref, list);
    }
  }
  return { byId, referrers };
}

/**
 * 从一批种子（通常是被改动路由的入口 HTML）沿 refs 求传递闭包。
 * 输出按 id 排序，保证与输入顺序无关（稳定输出的基础）。
 */
export function dependencyClosure(version: Version, seedIds: string[]): string[] {
  const idx = indexAssets(version.assets);
  const seen = new Set<string>();
  const stack = [...seedIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = idx.byId.get(id);
    if (!node) continue;
    for (const ref of node.refs) if (!seen.has(ref)) stack.push(ref);
  }
  return [...seen].sort();
}

/** 多版本并集：边缘节点上可能同时存在新旧两版副本（v2 优先取属性） */
export function edgeUniverse(versions: Version[]): AssetNode[] {
  const map = new Map<string, AssetNode>();
  for (const v of versions) {
    for (const a of v.assets) map.set(a.id, a);
  }
  return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** 某 key 在边缘会命中的全部对象 */
export function carriersOfKey(edgeAssets: AssetNode[], key: string): AssetNode[] {
  return edgeAssets.filter((a) => a.keys.includes(key));
}
