// ─────────────────────────────────────────────────────────────
// 规划前后对比（用户调整策略后比较失效范围）
// ─────────────────────────────────────────────────────────────
import type { Conclusion, InvalidationPlan, PlanDiff } from './types';

export function diffPlans(before: InvalidationPlan, after: InvalidationPlan): PlanDiff {
  const beforeMap = new Map(before.assets.map((a) => [a.assetId, a.conclusion]));
  const afterMap = new Map(after.assets.map((a) => [a.assetId, a.conclusion]));

  const onlyBefore = [...beforeMap.keys()].filter((id) => !afterMap.has(id)).sort();
  const onlyAfter = [...afterMap.keys()].filter((id) => !beforeMap.has(id)).sort();
  const changedConclusion: { assetId: string; before: Conclusion; after: Conclusion }[] = [];

  for (const [id, afterConclusion] of afterMap) {
    const beforeConclusion = beforeMap.get(id);
    if (beforeConclusion && beforeConclusion !== afterConclusion) {
      changedConclusion.push({ assetId: id, before: beforeConclusion, after: afterConclusion });
    }
  }
  changedConclusion.sort((a, b) => (a.assetId < b.assetId ? -1 : 1));

  return { onlyBefore, onlyAfter, changedConclusion };
}

export function countByConclusion(plan: InvalidationPlan): Record<Conclusion, number> {
  const out: Record<Conclusion, number> = { 'purge-now': 0, 'stale-refresh': 0, 'unsafe-keep': 0 };
  for (const a of plan.assets) out[a.conclusion]++;
  return out;
}
