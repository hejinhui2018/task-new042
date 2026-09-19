import type { Asset, Route, Selection, StrategyConfig } from '../types';
import { buildDependentsMap, reverseClosure } from './dependency';

/** 失效分类 */
export type Classification = 'purge-now' | 'defer' | 'unsafe';

/** 结论依据的规则类型 */
export type ReasonRule =
  | 'changed' // 本次改动对象
  | 'route-entry' // 选中路由的入口 HTML
  | 'depends-on-changed' // （传递）依赖已变更资源
  | 'surrogate-key' // 与变更资源共享 surrogate key
  | 'swr-defer' // 带 stale-while-revalidate，可延迟刷新
  | 'cross-route-shared' // 仍被未纳入本次改动的路由引用
  | 'immutable'; // immutable 策略禁止清除

/** 一条结论依据：规则 + 人类可读说明 + 结构化证据（依赖链 / 键 / 路由） */
export interface Reason {
  rule: ReasonRule;
  message: string;
  /** 依赖链（含两端），如 ['font.brand', 'css.spring', 'html.spring'] */
  chain?: string[];
  /** 共享的 surrogate key */
  key?: string;
  /** 相关路由 id 列表 */
  routes?: string[];
}

export interface ClassifiedAsset {
  assetId: string;
  classification: Classification;
  reasons: Reason[];
}

/** 一个执行波次：同一波内的资源可并行清除 */
export interface Wave {
  index: number;
  assetIds: string[];
}

/** 完整失效计划 */
export interface Plan {
  /** 必须立即清除 */
  purgeNow: ClassifiedAsset[];
  /** 可以延迟刷新（依赖 SWR 窗口自然再验证） */
  defer: ClassifiedAsset[];
  /** 不能安全清除 */
  unsafe: ClassifiedAsset[];
  /** 不受影响 */
  unaffected: string[];
  /** 立即清除资源的执行波次（依赖方在前，被依赖的共享资源在后） */
  waves: Wave[];
}

/** surrogate key 连带：与变更资源共享某个 key 的资源会被同批清除波及 */
export interface KeySweep {
  key: string;
  fromId: string;
}

/**
 * surrogate key 扫描：若某个 key 被多个资源持有，且其中一个被变更，
 * 则按该 key 清除时其余持有者会一并失效。
 * 返回 Map<被波及资源 id, KeySweep[]>。
 */
export function surrogateSweep(
  assets: readonly Asset[],
  changedIds: readonly string[],
): Map<string, KeySweep[]> {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const keyHolders = new Map<string, string[]>();
  for (const asset of assets) {
    for (const key of asset.surrogateKeys) {
      const list = keyHolders.get(key) ?? [];
      list.push(asset.id);
      keyHolders.set(key, list);
    }
  }

  const changed = new Set(changedIds);
  const result = new Map<string, KeySweep[]>();
  for (const id of [...changed].sort()) {
    const asset = byId.get(id);
    if (!asset) continue;
    for (const key of [...asset.surrogateKeys].sort()) {
      const holders = keyHolders.get(key) ?? [];
      if (holders.length < 2) continue; // 非共享键，无连带
      for (const holder of [...holders].sort()) {
        if (holder === id || changed.has(holder)) continue;
        const list = result.get(holder) ?? [];
        if (!list.some((s) => s.key === key && s.fromId === id)) {
          list.push({ key, fromId: id });
        }
        result.set(holder, list);
      }
    }
  }
  return result;
}

/**
 * 计算每个资源被哪些路由（传递）引用。
 * 路由入口 HTML 的整条依赖闭包都算该路由的引用。
 */
export function computeRouteRefs(
  routes: readonly Route[],
  assets: readonly Asset[],
): Map<string, string[]> {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const refs = new Map<string, string[]>();
  for (const route of [...routes].sort((a, b) => a.id.localeCompare(b.id))) {
    const seen = new Set<string>();
    const stack = [route.entryAssetId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const asset = byId.get(id);
      if (!asset) continue;
      for (const dep of asset.dependsOn) stack.push(dep);
    }
    for (const id of seen) {
      const list = refs.get(id) ?? [];
      list.push(route.id);
      refs.set(id, list);
    }
  }
  for (const list of refs.values()) list.sort();
  return refs;
}

/**
 * 计算失效计划。
 *
 * 分类规则（按优先级）：
 * 1. 变更资源 + immutable 策略 → 不能安全清除（内容哈希寻址，应发新 URL）；
 * 2. 变更资源 + 仍被未选中路由引用（且策略不允许）→ 不能安全清除；
 * 3. 其余变更资源 → 必须立即清除；
 * 4. 间接受影响资源 + 带 SWR 且策略为 defer → 可以延迟刷新；
 * 5. 间接受影响资源 + 仍被未选中路由引用（且策略不允许）→ 不能安全清除；
 * 6. 其余间接受影响资源 → 必须立即清除。
 *
 * 每个结论都附带 Reason 列表，说明来自哪条依赖链 / surrogate key / 路由引用。
 */
export function computePlan(
  routes: readonly Route[],
  assets: readonly Asset[],
  selection: Selection,
  strategy: StrategyConfig,
): Plan {
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const routeById = new Map(routes.map((r) => [r.id, r]));
  const selectedRoutes = new Set(selection.routeIds);

  // 1. 变更集合 = 显式选中的资源 ∪ 选中路由的入口 HTML
  const changed = new Set<string>(selection.assetIds.filter((id) => assetById.has(id)));
  const entryRoutes = new Map<string, string[]>();
  for (const routeId of [...selection.routeIds].sort()) {
    const route = routeById.get(routeId);
    if (!route) continue;
    changed.add(route.entryAssetId);
    const list = entryRoutes.get(route.entryAssetId) ?? [];
    list.push(routeId);
    entryRoutes.set(route.entryAssetId, list);
  }
  const changedIds = [...changed].sort();

  // 2. 反向依赖闭包 + 3. surrogate key 连带 + 4. 路由引用关系
  const closure = reverseClosure(assets, changedIds);
  const sweep = surrogateSweep(assets, changedIds);
  const routeRefs = computeRouteRefs(routes, assets);

  // 5. 逐个资源分类
  const purgeNow: ClassifiedAsset[] = [];
  const defer: ClassifiedAsset[] = [];
  const unsafe: ClassifiedAsset[] = [];
  const unaffected: string[] = [];

  for (const asset of [...assets].sort((a, b) => a.id.localeCompare(b.id))) {
    const reasons: Reason[] = [];
    const isChanged = changed.has(asset.id);

    if (isChanged) {
      reasons.push({
        rule: 'changed',
        message: `本次改动资源（当前版本 ${asset.version}${
          asset.rollbackVersion ? `，可回滚至 ${asset.rollbackVersion}` : '，无可回滚版本'
        }）`,
      });
      for (const routeId of (entryRoutes.get(asset.id) ?? []).slice().sort()) {
        const route = routeById.get(routeId)!;
        reasons.push({
          rule: 'route-entry',
          routes: [routeId],
          message: `选中路由 ${route.path}（${route.name}）的入口 HTML`,
        });
      }
    }
    for (const chain of closure.get(asset.id) ?? []) {
      reasons.push({
        rule: 'depends-on-changed',
        chain,
        message: `依赖已变更资源：${chain.join(' → ')}`,
      });
    }
    for (const s of sweep.get(asset.id) ?? []) {
      reasons.push({
        rule: 'surrogate-key',
        key: s.key,
        message: `与 ${s.fromId} 共享 surrogate key "${s.key}"，按键清除时会一并失效`,
      });
    }

    if (reasons.length === 0) {
      unaffected.push(asset.id);
      continue;
    }

    const referencing = routeRefs.get(asset.id) ?? [];
    const crossRoutes = referencing.filter((rid) => !selectedRoutes.has(rid)).sort();
    const crossRouteReason: Reason | null =
      crossRoutes.length > 0
        ? {
            rule: 'cross-route-shared',
            routes: crossRoutes,
            message: `仍被未纳入本次改动的路由引用：${crossRoutes
              .map((rid) => {
                const r = routeById.get(rid)!;
                return `${r.path}（${r.name}）`;
              })
              .join('、')}`,
          }
        : null;

    let classification: Classification;
    if (isChanged) {
      if (asset.policy.immutable) {
        reasons.push({
          rule: 'immutable',
          message: 'immutable 缓存策略（内容哈希寻址），禁止清除旧版本，应发布新 URL',
        });
        classification = 'unsafe';
      } else if (crossRouteReason && !strategy.includeCrossRouteShared) {
        reasons.push(crossRouteReason);
        classification = 'unsafe';
      } else {
        classification = 'purge-now';
      }
    } else {
      if (asset.policy.swrSeconds > 0 && strategy.swrHandling === 'defer') {
        reasons.push({
          rule: 'swr-defer',
          message: `缓存策略含 stale-while-revalidate ${asset.policy.swrSeconds}s，可在窗口内自然刷新，无需立即清除`,
        });
        classification = 'defer';
      } else if (crossRouteReason && !strategy.includeCrossRouteShared) {
        reasons.push(crossRouteReason);
        classification = 'unsafe';
      } else {
        classification = 'purge-now';
      }
    }

    const classified: ClassifiedAsset = { assetId: asset.id, classification, reasons };
    if (classification === 'purge-now') purgeNow.push(classified);
    else if (classification === 'defer') defer.push(classified);
    else unsafe.push(classified);
  }

  const waves = computeWaves(assets, purgeNow.map((c) => c.assetId));
  return { purgeNow, defer, unsafe, unaffected: unaffected.sort(), waves };
}

/**
 * 波次编排：在「必须立即清除」集合内，按依赖关系分层。
 * 依赖方（如入口 HTML）排在前面波次，被依赖的共享资源（如字体）排在后面波次，
 * 保证深层共享资源被清除时，上层引用方已经完成刷新，不会在边缘节点重新缓存到
 * 引用了旧版本的中间态。同一波内按资源 id 字典序排序，输出确定。
 */
export function computeWaves(assets: readonly Asset[], purgeIds: readonly string[]): Wave[] {
  const inSet = new Set(purgeIds);
  const dependents = buildDependentsMap(assets);
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const waveOf = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // 循环依赖兜底
    visiting.add(id);
    let wave = 0;
    for (const dependent of dependents.get(id) ?? []) {
      if (!inSet.has(dependent)) continue;
      wave = Math.max(wave, waveOf(dependent) + 1);
    }
    visiting.delete(id);
    memo.set(id, wave);
    return wave;
  };

  const buckets = new Map<number, string[]>();
  for (const id of [...purgeIds].sort()) {
    const wave = waveOf(id);
    const list = buckets.get(wave) ?? [];
    list.push(id);
    buckets.set(wave, list);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, ids]) => ({ index, assetIds: ids.sort() }));
}

/** 递归按键名排序的稳定序列化（数组顺序由 computePlan 保证已排序） */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * 计划的稳定序列化：同样的输入（与数组顺序无关）产生同样的字符串，
 * 不含时间戳或随机量，可用于 diff、审计与回归校验。
 */
export function serializePlan(plan: Plan): string {
  const classified = (c: ClassifiedAsset) => ({
    id: c.assetId,
    reasons: c.reasons.map((r) => ({
      rule: r.rule,
      chain: r.chain ?? [],
      key: r.key ?? '',
      routes: r.routes ?? [],
    })),
  });
  return stableStringify({
    waves: plan.waves.map((w) => ({ index: w.index, assets: [...w.assetIds].sort() })),
    purgeNow: plan.purgeNow.map(classified),
    defer: plan.defer.map(classified),
    unsafe: plan.unsafe.map(classified),
    unaffected: [...plan.unaffected].sort(),
  });
}

/** 计划的稳定哈希（djb2，8 位十六进制），用于快速比对两次计划是否一致 */
export function planHash(plan: Plan): string {
  const s = serializePlan(plan);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
