import { describe, expect, it } from 'vitest';
import { EDGE_REGIONS, SPRING_SCENARIO } from '../src/domain/scenario';
import { buildPlan, type PlanInput } from '../src/domain/plan';
import { applyOutcome, initSim } from '../src/domain/simulate';
import { buildRollbackPlan } from '../src/domain/rollback';
import { DEFAULT_GLOBAL } from '../src/state/history';
import type { RouteStrategy } from '../src/domain/types';

const v1 = SPRING_SCENARIO.versions[0];
const v2 = SPRING_SCENARIO.versions[1];
const routes: RouteStrategy[] = v1.routes.map((r) => ({
  routeId: r.id,
  selected: r.id === 'r-spring' || r.id === 'r-spring-sub',
  allowStale: false,
}));
const input: PlanInput = { target: v2, allVersions: SPRING_SCENARIO.versions, routes, policyOverrides: {}, global: { ...DEFAULT_GLOBAL } };
const plan = buildPlan(input);
const MAX = 2;

describe('最小回退计划', () => {
  it('无执行记录时按最坏情况：所有可执行单元（指纹新资源除外）都需要回退', () => {
    const rb = buildRollbackPlan(plan, v1.label, EDGE_REGIONS, undefined);
    // W1: 2 HTML × 5 区域 = 10；W2: 皮肤 css 需要(1)，指纹新资源 3 个跳过 → 1×5 = 5
    expect(rb.neededCount).toBe(15);
    expect(rb.skippedCount).toBe(15); // 3 个指纹/连带副本 × 5
    // 指纹新资源全部跳过且理由明确
    for (const id of ['font-display-v2', 'img-hero-v2', 'img-hero-v1']) {
      const steps = rb.steps.filter((s) => s.assetId === id);
      expect(steps).toHaveLength(5);
      expect(steps.every((s) => !s.needed)).toBe(true);
      expect(steps[0].reason).toContain('指纹');
    }
  });

  it('回退顺序：W2 的皮肤资源先恢复，W1 入口最后切换', () => {
    const rb = buildRollbackPlan(plan, v1.label, EDGE_REGIONS, undefined);
    const needed = rb.steps.filter((s) => s.needed);
    // 前 5 个 needed 应为 css-spring-skin（W2），之后才是两个 HTML（W1）
    const first = needed[0];
    const last = needed[needed.length - 1];
    expect(first.assetId).toBe('css-spring-skin');
    expect(first.fromWave).toBe('W2 · 延迟刷新');
    expect(['html-spring', 'html-spring-sub']).toContain(last.assetId);
    expect(last.fromWave).toBe('W1 · 立即清除');
    // order 连续
    expect(rb.steps.map((s) => s.order)).toEqual(rb.steps.map((_, i) => i));
  });

  it('前向超时的区域：边缘仍是旧副本，回退零操作；仅成功的区域需要回退', () => {
    let sim = initSim(plan, EDGE_REGIONS);
    // W1：华东(index0) 对 html-spring-sub(index0) 三次超时耗尽；其余成功
    for (let i = 0; i < 3; i++) sim = applyOutcome(sim, 0, 0, 0, 'timeout', MAX).state;
    for (let ri = 0; ri < EDGE_REGIONS.length; ri++) {
      for (let ai = 0; ai < sim.waveAssetIds[0].length; ai++) {
        if (ri === 0 && ai === 0) continue;
        sim = applyOutcome(sim, 0, ri, ai, 'success', MAX).state;
      }
    }
    const stuckAsset = sim.waveAssetIds[0][0]; // 排序后第一个入口
    const rb = buildRollbackPlan(plan, v1.label, EDGE_REGIONS, sim);
    const stuck = rb.steps.filter((s) => s.region === '华东' && s.assetId === stuckAsset);
    expect(stuck).toHaveLength(1);
    expect(stuck[0].needed).toBe(false);
    expect(stuck[0].reason).toContain('超时未生效');
    // 同资源其它区域仍需回退
    const otherRegions = rb.steps.filter((s) => s.assetId === stuckAsset && s.region !== '华东');
    expect(otherRegions.every((s) => s.needed)).toBe(true);
    expect(otherRegions).toHaveLength(4);
  });

  it('未执行的波次（W2）所有区域都跳过', () => {
    let sim = initSim(plan, EDGE_REGIONS);
    for (let ri = 0; ri < EDGE_REGIONS.length; ri++) {
      for (let ai = 0; ai < sim.waveAssetIds[0].length; ai++) {
        sim = applyOutcome(sim, 0, ri, ai, 'success', MAX).state;
      }
    }
    const rb = buildRollbackPlan(plan, v1.label, EDGE_REGIONS, sim);
    const w2Skin = rb.steps.filter((s) => s.assetId === 'css-spring-skin');
    // W2 未执行 → attempt=0/pending → 跳过
    expect(w2Skin.every((s) => !s.needed)).toBe(true);
    expect(w2Skin[0].reason).toContain('未在');
    // W1 入口全部成功 → 需要回退
    const w1 = rb.steps.filter((s) => s.fromWave.startsWith('W1'));
    expect(w1.every((s) => s.needed)).toBe(true);
  });

  it('输出稳定：相同输入步骤序列一致', () => {
    const a = buildRollbackPlan(plan, v1.label, EDGE_REGIONS, undefined);
    const b = buildRollbackPlan(plan, v1.label, EDGE_REGIONS, undefined);
    expect(a.steps).toEqual(b.steps);
  });
});
