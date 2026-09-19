import { describe, expect, it } from 'vitest';
import { SPRING_SCENARIO } from '../src/domain/scenario';
import { buildPlan, type PlanInput } from '../src/domain/plan';
import { countByConclusion, diffPlans } from '../src/domain/compare';
import { planFingerprint, shortHash, stableStringify } from '../src/domain/canonical';
import { DEFAULT_GLOBAL, historyReducer, initHistory, defaultDoc, patchPresent } from '../src/state/history';
import type { CachePolicy, RouteStrategy } from '../src/domain/types';

const v1 = SPRING_SCENARIO.versions[0];
const v2 = SPRING_SCENARIO.versions[1];
const springRoutes = (): RouteStrategy[] =>
  v1.routes.map((r) => ({
    routeId: r.id,
    selected: r.id === 'r-spring' || r.id === 'r-spring-sub',
    allowStale: false,
  }));
const baseInput = (extra: Partial<PlanInput> = {}): PlanInput => ({
  target: v2,
  allVersions: SPRING_SCENARIO.versions,
  routes: springRoutes(),
  policyOverrides: {},
  global: { ...DEFAULT_GLOBAL },
  ...extra,
});

describe('稳定序列化', () => {
  it('对象键顺序不同得到相同字符串', () => {
    expect(stableStringify({ a: 1, b: { y: 2, x: 3 } })).toBe(stableStringify({ b: { x: 3, y: 2 }, a: 1 }));
  });

  it('数组顺序被保留（不越俎代庖排序业务数组）', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('shortHash 确定性', () => {
    expect(shortHash('abc')).toBe(shortHash('abc'));
    expect(shortHash('abc')).not.toBe(shortHash('abd'));
    expect(shortHash('abc')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('规划指纹对展示性文本不敏感，对结论变化敏感', () => {
    const p1 = buildPlan(baseInput());
    const fp1 = planFingerprint(p1);
    // 同样输入
    expect(planFingerprint(buildPlan(baseInput()))).toBe(fp1);
    // 关闭 surrogate key → 多个结论变化 → 指纹变化
    const p2 = buildPlan(baseInput({ global: { ...DEFAULT_GLOBAL, useSurrogateKeys: false } }));
    expect(planFingerprint(p2)).not.toBe(fp1);
  });
});

describe('前后对比', () => {
  it('关闭 surrogate key 后：unsafe 减少，新指纹资源变为 stale-refresh', () => {
    const before = buildPlan(baseInput());
    const after = buildPlan(baseInput({ global: { ...DEFAULT_GLOBAL, useSurrogateKeys: false } }));
    const diff = diffPlans(before, after);
    const changed = new Map(diff.changedConclusion.map((c) => [c.assetId, c]));
    expect(changed.get('css-spring-comp-v2')).toEqual({
      assetId: 'css-spring-comp-v2',
      before: 'unsafe-keep',
      after: 'stale-refresh',
    });
    expect(changed.get('js-app-v2')).toEqual({
      assetId: 'js-app-v2',
      before: 'unsafe-keep',
      after: 'stale-refresh',
    });
    expect(diff.onlyBefore).toEqual([]);
    expect(diff.onlyAfter).toEqual([]);
  });

  it('减少选中路由时范围收缩：只属于春季的资源移出规划', () => {
    const before = buildPlan(baseInput());
    const onlyHome = springRoutes().map((r) => ({ ...r, selected: false }));
    const after = buildPlan(baseInput({ routes: onlyHome }));
    const diff = diffPlans(before, after);
    // 无选中路由 → 规划为空（before 里的资源全部出现在 onlyBefore）
    expect(diff.onlyBefore).toContain('html-spring');
    expect(diff.onlyBefore).toContain('css-spring-comp-v2');
    expect(after.assets).toHaveLength(0);
  });

  it('允许软失效：入口结论 purge-now → stale-refresh', () => {
    const before = buildPlan(baseInput());
    const routes = springRoutes().map((r) =>
      r.routeId === 'r-spring-sub' ? { ...r, allowStale: true } : r,
    );
    const after = buildPlan(baseInput({ routes }));
    const changed = new Map(diffPlans(before, after).changedConclusion.map((c) => [c.assetId, c]));
    expect(changed.get('html-spring-sub')).toMatchObject({ before: 'purge-now', after: 'stale-refresh' });
    expect(changed.has('html-spring')).toBe(false);
  });

  it('countByConclusion 与三类列表一致', () => {
    const plan = buildPlan(baseInput());
    const counts = countByConclusion(plan);
    expect(counts['purge-now']).toBe(plan.assets.filter((a) => a.conclusion === 'purge-now').length);
    expect(counts['stale-refresh'] + counts['unsafe-keep'] + counts['purge-now']).toBe(plan.assets.length);
  });
});

describe('撤销/重做', () => {
  it('commit→undo→redo 恢复现场，相同内容不产生历史', () => {
    let h = initHistory(defaultDoc());
    const d1 = patchPresent(h.present, { versionId: 'v1' });
    h = historyReducer(h, { type: 'commit', next: d1 });
    expect(h.past).toHaveLength(1);
    // 相同内容 commit：历史不变
    h = historyReducer(h, { type: 'commit', next: patchPresent(h.present, { versionId: 'v1' }) });
    expect(h.past).toHaveLength(1);

    h = historyReducer(h, { type: 'undo' });
    expect(h.present.versionId).toBe('v2');
    expect(h.future).toHaveLength(1);
    h = historyReducer(h, { type: 'redo' });
    expect(h.present.versionId).toBe('v1');
    expect(h.future).toHaveLength(0);
  });

  it('undo 后再 commit 会清空 future', () => {
    let h = initHistory(defaultDoc());
    h = historyReducer(h, { type: 'commit', next: patchPresent(h.present, { versionId: 'v1' }) });
    h = historyReducer(h, { type: 'undo' });
    const overrides: Record<string, CachePolicy> = { x: 'no-cache' };
    h = historyReducer(h, { type: 'commit', next: patchPresent(h.present, { policyOverrides: overrides }) });
    expect(h.future).toHaveLength(0);
    expect(h.past).toHaveLength(1);
  });

  it('reset 回到默认文档并清空历史', () => {
    let h = initHistory(defaultDoc());
    h = historyReducer(h, { type: 'commit', next: patchPresent(h.present, { versionId: 'v1' }) });
    h = historyReducer(h, { type: 'reset' });
    expect(h.present).toEqual(defaultDoc());
    expect(h.past).toHaveLength(0);
    expect(h.future).toHaveLength(0);
  });

  it('replace 用外部文档（刷新恢复）建立干净历史', () => {
    const external = patchPresent(defaultDoc(), { versionId: 'v1' });
    let h = initHistory(defaultDoc());
    h = historyReducer(h, { type: 'commit', next: patchPresent(h.present, { versionId: 'v2' }) });
    h = historyReducer(h, { type: 'replace', doc: external });
    expect(h.present.versionId).toBe('v1');
    expect(h.past).toHaveLength(0);
  });
});
