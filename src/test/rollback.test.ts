import { describe, expect, it } from 'vitest';
import { ASSETS, NODES, ROUTES } from '../data/scenario';
import { computePlan } from '../lib/plan';
import { cellKey, computeRollback, createSimState, runWave, type SimState } from '../lib/simulate';

// 三波次计划：波次 0 = 各入口 HTML，波次 1 = css/img，波次 2 = font.brand
const plan = computePlan(
  ROUTES,
  ASSETS,
  { routeIds: ['route.spring'], assetIds: ['css.spring', 'img.hero', 'font.brand'] },
  { swrHandling: 'purge', includeCrossRouteShared: true, maxRetries: 2 },
);

/** 构造：波次 0 全部成功，波次 1 在新加坡失败（其余成功），波次 2 未执行 */
function failedSim(): SimState {
  const schedule = { [cellKey(1, 'edge-ap-singapore')]: 9 };
  let sim = createSimState();
  sim = runWave(sim, plan, NODES, schedule, 2); // 波次 0 全部成功
  sim = runWave(sim, plan, NODES, schedule, 2); // 波次 1：新加坡超时 1
  sim = runWave(sim, plan, NODES, schedule, 2); // 波次 1：新加坡超时 2
  sim = runWave(sim, plan, NODES, schedule, 2); // 波次 1：新加坡失败
  expect(sim.status).toBe('failed');
  return sim;
}

describe('最小回退计划', () => {
  it('未执行任何清除时回退计划为空', () => {
    const rollback = computeRollback(plan, createSimState(), ASSETS, NODES);
    expect(rollback.steps).toEqual([]);
    expect(rollback.unrecoverable).toEqual([]);
  });

  it('只包含已清除成功的资源，未执行的波次无需回退', () => {
    const rollback = computeRollback(plan, failedSim(), ASSETS, NODES);
    const rolledAssets = rollback.steps.map((s) => s.assetId);
    // 波次 2 的字体从未执行 → 不在回退计划中
    expect(rolledAssets).not.toContain('font.brand');
    // 波次 0、1 中已成功的资源在内
    expect(rolledAssets).toContain('html.spring');
    expect(rolledAssets).toContain('css.spring');
    expect(rolledAssets).toContain('img.hero');
  });

  it('每个资源只列出清除成功的节点（最小集合）', () => {
    const rollback = computeRollback(plan, failedSim(), ASSETS, NODES);
    const css = rollback.steps.find((s) => s.assetId === 'css.spring')!;
    expect(css.toVersion).toBe('v1');
    expect(css.nodeIds.sort()).toEqual(
      ['edge-ap-shanghai', 'edge-eu-frankfurt', 'edge-us-virginia'].sort(),
    );
    // 波次 0 的资源在全部 4 个节点成功
    const html = rollback.steps.find((s) => s.assetId === 'html.spring')!;
    expect(html.nodeIds).toHaveLength(4);
  });

  it('回退步骤按原波次顺序排列（依赖方先回滚）', () => {
    const rollback = computeRollback(plan, failedSim(), ASSETS, NODES);
    const waves = rollback.steps.map((s) => s.wave);
    expect(waves).toEqual([...waves].sort((a, b) => a - b));
    expect(rollback.steps[0].wave).toBe(0);
  });

  it('没有可回滚版本的资源列入 unrecoverable', () => {
    const rollback = computeRollback(plan, failedSim(), ASSETS, NODES);
    // html.about 没有 rollbackVersion
    const unrecoverableIds = rollback.unrecoverable.map((u) => u.assetId);
    expect(unrecoverableIds).toContain('html.about');
    expect(rollback.steps.map((s) => s.assetId)).not.toContain('html.about');
  });
});
