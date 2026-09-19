// ─────────────────────────────────────────────────────────────
// 失效规划
//
// 输入：目标版本（要发布成什么样）、边缘全集（新旧版本并集——旧指纹资源
// 的副本可能还在边缘，且仍被未发布页面引用）、用户策略。
//
// 规划范围＝目标版本中选中路由的依赖闭包 ∪ 闭包对象所携带 surrogate key
// 在边缘命中的其它副本（评估“误伤半径”）。
//
// 对范围内每个对象给出三选一结论，并保留完整推理链（rule/via）：
//   purge-now      必须立即清除
//   stale-refresh  可延迟刷新（SWR 窗口内，或指纹新资源无需清除）
//   unsafe-keep    不能安全清除（共享引用 / 宽 key 碰撞）
// ─────────────────────────────────────────────────────────────
import type {
  AssetNode,
  CachePolicy,
  Conclusion,
  GlobalStrategy,
  InvalidationPlan,
  PlannedAsset,
  Reason,
  RouteStrategy,
  Version,
  Wave,
} from './types';
import { carriersOfKey, dependencyClosure, edgeUniverse, indexAssets } from './graph';

export interface PlanInput {
  /** 要发布的目标版本 */
  target: Version;
  /** 参与对比的全部版本（用于推断边缘上的新旧副本） */
  allVersions: Version[];
  routes: RouteStrategy[];
  /** 资源 id → 用户手动覆盖的缓存策略 */
  policyOverrides?: Record<string, CachePolicy>;
  global: GlobalStrategy;
}

const KIND_LABEL: Record<AssetNode['kind'], string> = {
  html: '入口 HTML',
  css: '样式',
  js: '脚本',
  font: '字体',
  img: '图片',
};

export function effectivePolicy(node: AssetNode, overrides?: Record<string, CachePolicy>): CachePolicy {
  return overrides?.[node.id] ?? node.policy;
}

/**
 * 计算规划。纯函数；相同输入恒得相同输出（所有集合均排序后输出）。
 */
export function buildPlan(input: PlanInput): InvalidationPlan {
  const { target, allVersions, routes, policyOverrides, global } = input;
  const targetIdx = indexAssets(target.assets);
  const edge = edgeUniverse(allVersions);

  // 1) 选中 / 未选中路由的入口
  const entryOf = (routeId: string) => target.routes.find((r) => r.id === routeId)?.entryId;
  const selectedEntries = routes.filter((r) => r.selected).map((r) => entryOf(r.routeId)!) ;
  const untouchedEntries = routes.filter((r) => !r.selected).map((r) => entryOf(r.routeId)!);

  // 2) 依赖闭包
  const closure = new Set(dependencyClosure(target, selectedEntries));
  // 未改动页面仍在使用的对象（目标版本引用图）
  const stillReferenced = new Set(dependencyClosure(target, untouchedEntries));

  // 3) 误伤半径：闭包对象携带的 key 在边缘命中的其它副本
  const scope = new Set(closure);
  for (const id of closure) {
    const node = targetIdx.byId.get(id);
    if (!node) continue;
    for (const key of node.keys) {
      for (const carrier of carriersOfKey(edge, key)) scope.add(carrier.id);
    }
  }

  const entryToRoute = new Map(target.routes.map((r) => [r.entryId, r.id]));
  const allowStaleByRoute = new Map(routes.map((r) => [r.routeId, r.allowStale]));

  const planned: PlannedAsset[] = [];

  for (const assetId of scope) {
    // 目标版本没有的对象＝边缘上的旧副本
    const node = targetIdx.byId.get(assetId) ?? edge.find((a) => a.id === assetId)!;
    const policy = effectivePolicy(node, policyOverrides);
    const reasons: Reason[] = [];
    const isEntry = selectedEntries.includes(assetId);

    // ── R1：入口被改动路由直接选中 ──
    if (isEntry) {
      const routeId = entryToRoute.get(assetId)!;
      const route = target.routes.find((r) => r.id === routeId)!;
      const soft = allowStaleByRoute.get(routeId);
      reasons.push({
        rule: 'R1-entry-selected',
        text: `路由 ${route.path}（${route.name}）本次发布，入口 HTML ${
          soft ? '允许软失效（SWR）' : '必须立即硬清除'
        }，否则边缘继续返回引用旧资源的旧文档`,
        via: [routeId],
      });
    }

    // ── R2：仍被本次不发布的页面引用 ──
    const sharedWithUntouched = stillReferenced.has(assetId);
    if (sharedWithUntouched) {
      const users = (targetIdx.referrers.get(assetId) ?? []).filter((r) => stillReferenced.has(r)).sort();
      reasons.push({
        rule: 'R2-shared-by-untouched',
        text: `仍被本次不发布的页面引用（${users.map((u) => labelOf(target, u)).join('、') || '其它路由'}）：清除会让这些页面在边缘缓存收敛前承担回源抖动与字体/样式回退风险`,
        via: users,
      });
    }

    // ── R3：宽 surrogate key 碰撞（误伤旧副本） ──
    const dangerousKeys = new Set<string>();
    const endangered = new Set<string>(); // 会被连带伤害的旧副本
    const harmlessCarriers = new Set<string>(); // 同 key 但已无人引用的旧副本
    for (const key of node.keys) {
      for (const carrier of carriersOfKey(edge, key).filter((c) => c.id !== node.id)) {
        const refs = targetIdx.referrers.get(carrier.id) ?? [];
        const needed = stillReferenced.has(carrier.id) || refs.some((r) => stillReferenced.has(r));
        if (needed) {
          dangerousKeys.add(key);
          endangered.add(carrier.id);
          refs.filter((r) => stillReferenced.has(r)).forEach((r) => endangered.add(r));
        } else {
          harmlessCarriers.add(carrier.id);
        }
      }
    }
    if (dangerousKeys.size > 0) {
      reasons.push({
        rule: 'R3-surrogate-key-collision',
        text: `surrogate key ${[...dangerousKeys].sort().join('、')} 在边缘同时命中 ${[...endangered]
          .sort()
          .map((u) => labelOf(target, u))
          .join('、')}（未发布页面仍在引用）：按 key purge 会连带失效它`,
        via: [...endangered].sort(),
      });
    }

    // ── R6：同 key 的其它副本已无未发布引用方，连带清除安全 ──
    if (harmlessCarriers.size > 0) {
      reasons.push({
        rule: 'R6-collateral-safe',
        text: `同 key 的其它副本 ${[...harmlessCarriers].sort().map((u) => labelOf(target, u)).join('、')} 已无未发布引用方，随 key 连带清除是安全的`,
        via: [...harmlessCarriers].sort(),
      });
    }

    // ── R4：内容指纹 + immutable：新 URL 首请求即回源，无需 purge ──
    if (policy === 'immutable') {
      reasons.push({
        rule: 'R4-fingerprinted-immutable',
        text: `${KIND_LABEL[node.kind]}为内容指纹资源且 immutable：新内容在新 URL，首次被新文档引用时自然回源，旧副本不会被新文档命中，无需主动清除`,
        via: [],
      });
    }

    // ── R5：SWR：旧副本可继续服务，后台异步刷新 ──
    if (policy === 'srl') {
      reasons.push({
        rule: 'R5-stale-while-revalidate',
        text: `${KIND_LABEL[node.kind]}策略为 stale-while-revalidate，可先服务旧副本、后台刷新（容忍窗口 ${global.staleToleranceSec}s）`,
        via: [],
      });
    }

    // ── 结论：unsafe > 入口 > SWR > immutable ──
    // R3 仅在“真的会按 key purge”时构成阻断；逐 URL 模式下 key 碰撞不阻断
    const keyPurgeWouldCollide = global.useSurrogateKeys && dangerousKeys.size > 0;
    let conclusion: Conclusion;
    if (sharedWithUntouched || keyPurgeWouldCollide) {
      conclusion = 'unsafe-keep';
    } else if (isEntry) {
      const routeId = entryToRoute.get(assetId)!;
      conclusion = allowStaleByRoute.get(routeId) ? 'stale-refresh' : 'purge-now';
    } else if (policy === 'srl') {
      conclusion = global.staleToleranceSec > 0 ? 'stale-refresh' : 'purge-now';
    } else if (policy === 'immutable') {
      conclusion = 'stale-refresh'; // 无需清除；需要预热时可延迟刷新
    } else {
      conclusion = 'purge-now'; // no-cache 非入口
    }

    // unsafe 对象不产出任何可执行 purge（防止误操作）；
    // immutable 指纹资源无需主动清除（R4）；
    // 碰撞 key 一律剔除；逐 URL 模式下列出 URL。
    let purgeKeys: string[] = [];
    let purgeUrls: string[] = [];
    if (conclusion !== 'unsafe-keep' && policy !== 'immutable') {
      if (global.useSurrogateKeys) {
        purgeKeys = node.keys.filter((k) => !dangerousKeys.has(k)).sort();
      } else {
        purgeUrls = [node.url].sort();
      }
    }

    const remediation =
      conclusion === 'unsafe-keep'
        ? keyPurgeWouldCollide
          ? `不要按宽 key ${[...dangerousKeys].sort().join('、')} 清除：改为对新资源逐 URL purge，或先在边缘配置中把新旧资源拆到不同 surrogate key 后重规划`
          : `保留缓存不动；等引用它的未发布页面（${(targetIdx.referrers.get(assetId) ?? [])
              .filter((r) => stillReferenced.has(r))
              .map((u) => labelOf(target, u))
              .join('、')}）一并发布时再统一失效`
        : undefined;

    planned.push({
      assetId: node.id,
      url: node.url,
      kind: node.kind,
      keys: [...node.keys].sort(),
      policy,
      conclusion,
      reasons,
      purgeKeys,
      purgeUrls,
      remediation,
    });
  }

  // 稳定排序：结论优先级 + id
  const order: Record<Conclusion, number> = {
    'purge-now': 0,
    'stale-refresh': 1,
    'unsafe-keep': 2,
  };
  planned.sort((a, b) => order[a.conclusion] - order[b.conclusion] || (a.assetId < b.assetId ? -1 : 1));

  return {
    waves: buildWaves(planned),
    assets: planned,
    allPurgeKeys: collectKeys(planned),
    allPurgeUrls: [
      ...new Set(planned.filter((p) => p.conclusion !== 'unsafe-keep').flatMap((p) => p.purgeUrls)),
    ].sort(),
  };
}

function labelOf(version: Version, id: string): string {
  const route = version.routes.find((r) => r.entryId === id);
  if (route) return route.path;
  const asset = version.assets.find((a) => a.id === id);
  return asset ? asset.url.split('/').pop()! : id;
}

function collectKeys(planned: PlannedAsset[]): string[] {
  return [...new Set(planned.filter((p) => p.conclusion !== 'unsafe-keep').flatMap((p) => p.purgeKeys))].sort();
}

// ─────────────────────────────────────────────────────────────
// 波次
//  W1 立即清除：入口 HTML（硬清除），先切断旧文档
//  W2 延迟刷新：SWR 资源软清除/预热 + 指纹新资源预热
//  W3 不操作：unsafe-keep（收窄 key 或随未发布页面一起发）
// ─────────────────────────────────────────────────────────────
function buildWaves(planned: PlannedAsset[]): Wave[] {
  const defs: { conclusion: Conclusion; title: string; rationale: string }[] = [
    {
      conclusion: 'purge-now',
      title: 'W1 · 立即清除',
      rationale:
        '入口 HTML 最先硬清除：边缘立即回源拿到引用新指纹资源的新文档，从入口切断旧版本。必须全部成功后才能进入 W2。',
    },
    {
      conclusion: 'stale-refresh',
      title: 'W2 · 延迟刷新',
      rationale:
        'SWR 样式可在 W1 成功后软清除：边缘继续服务旧副本并后台刷新；指纹新资源无需清除，可顺带预热。本波超时不阻塞发布，容忍窗口内收敛即可。',
    },
    {
      conclusion: 'unsafe-keep',
      title: 'W3 · 不操作（不能安全清除）',
      rationale:
        '共享对象存在未发布引用方，或宽 surrogate key 会误伤旧副本：本波不执行 purge。处置＝收窄/拆分 surrogate key 后重规划，或等引用它的页面一并发布。',
    },
  ];
  const waves: Wave[] = [];
  for (const def of defs) {
    const items = planned.filter((p) => p.conclusion === def.conclusion);
    if (items.length === 0) continue;
    waves.push({
      index: waves.length,
      title: def.title,
      assetIds: items.map((p) => p.assetId).sort(),
      purgeKeys: [...new Set(items.flatMap((p) => p.purgeKeys))].sort(),
      rationale: def.rationale,
    });
  }
  return waves;
}
