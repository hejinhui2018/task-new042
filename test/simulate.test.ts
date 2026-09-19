import { describe, expect, it } from 'vitest';
import { EDGE_REGIONS, SPRING_SCENARIO } from '../src/domain/scenario';
import { buildPlan, type PlanInput } from '../src/domain/plan';
import {
  applyOutcome,
  canEnterWave,
  cellSeed,
  initSim,
  isRetryable,
  makeRng,
  runWaveAuto,
  stuckCells,
} from '../src/domain/simulate';
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
const MAX_RETRIES = 2;

describe('边缘模拟初始化', () => {
  it('只包含可执行波次（W3 unsafe 不参与），区域 × 资源矩阵初始 pending', () => {
    const sim = initSim(plan, EDGE_REGIONS);
    expect(sim.waves).toHaveLength(2);
    expect(sim.waveAssetIds[0]).toEqual(['html-spring', 'html-spring-sub']);
    expect(sim.waveAssetIds[1]).toEqual(['css-spring-skin', 'font-display-v2', 'img-hero-v1', 'img-hero-v2']);
    for (const wave of sim.waves) {
      expect(wave).toHaveLength(EDGE_REGIONS.length);
      for (const r of wave) for (const s of Object.values(r.statuses)) expect(s).toBe('pending');
    }
  });
});

describe('超时与重试', () => {
  it('超时在预算内可重试，成功后转为 success', () => {
    let sim = initSim(plan, EDGE_REGIONS);
    const r1 = applyOutcome(sim, 0, 0, 0, 'timeout', MAX_RETRIES);
    sim = r1.state;
    expect(isRetryable(sim, 0, 0, 0, MAX_RETRIES)).toBe(true);
    expect(sim.events[0].detail).toContain('可重试');

    const r2 = applyOutcome(sim, 0, 0, 0, 'timeout', MAX_RETRIES);
    sim = r2.state;
    // 第 2 次尝试：attempt=2 <= maxRetries=2，仍可重试
    expect(isRetryable(sim, 0, 0, 0, MAX_RETRIES)).toBe(true);

    const r3 = applyOutcome(sim, 0, 0, 0, 'timeout', MAX_RETRIES);
    sim = r3.state;
    // 第 3 次仍超时：超过预算，终态 timeout，不可再重试
    expect(isRetryable(sim, 0, 0, 0, MAX_RETRIES)).toBe(false);
    expect(sim.events[2].detail).toContain('待人工处理');

    const ok = applyOutcome(sim, 0, 0, 0, 'success', MAX_RETRIES);
    // 终态失败后不允许再改（需重置模拟）
    expect(ok.state).toBe(sim);
  });

  it('已成功的单元不可回退', () => {
    let sim = initSim(plan, EDGE_REGIONS);
    sim = applyOutcome(sim, 0, 1, 1, 'success', MAX_RETRIES).state;
    const again = applyOutcome(sim, 0, 1, 1, 'timeout', MAX_RETRIES);
    expect(again.state).toBe(sim);
    expect(sim.waves[0][1].statuses[sim.waveAssetIds[0][1]]).toBe('success');
  });
});

describe('波次门禁', () => {
  it('W1 未全部成功前不能进入 W2；全部成功后放行', () => {
    let sim = initSim(plan, EDGE_REGIONS);
    expect(canEnterWave(sim, 1, MAX_RETRIES)).toBe(false);

    for (let ri = 0; ri < EDGE_REGIONS.length; ri++) {
      for (let ai = 0; ai < sim.waveAssetIds[0].length; ai++) {
        sim = applyOutcome(sim, 0, ri, ai, 'success', MAX_RETRIES).state;
      }
    }
    expect(canEnterWave(sim, 1, MAX_RETRIES)).toBe(true);
  });

  it('W1 存在重试耗尽的超时单元时门禁不开放', () => {
    let sim = initSim(plan, EDGE_REGIONS);
    // 第一单元三次超时耗尽
    for (let i = 0; i < 3; i++) sim = applyOutcome(sim, 0, 0, 0, 'timeout', MAX_RETRIES).state;
    for (let ri = 0; ri < EDGE_REGIONS.length; ri++) {
      for (let ai = 0; ai < sim.waveAssetIds[0].length; ai++) {
        if (ri === 0 && ai === 0) continue;
        sim = applyOutcome(sim, 0, ri, ai, 'success', MAX_RETRIES).state;
      }
    }
    expect(canEnterWave(sim, 1, MAX_RETRIES)).toBe(false);
    expect(stuckCells(sim, 0)).toEqual([{ region: '华东', assetId: sim.waveAssetIds[0][0] }]);
  });
});

describe('自动模拟（确定性）', () => {
  it('相同 seed 两次运行得到逐事件一致的结果（可重放）', () => {
    const a = runWaveAuto(initSim(plan, EDGE_REGIONS), 0, MAX_RETRIES, 42);
    const b = runWaveAuto(initSim(plan, EDGE_REGIONS), 0, MAX_RETRIES, 42);
    expect(a.events).toEqual(b.events);
    expect(a.waves).toEqual(b.waves);
  });

  it('自动运行后所有单元到达终态（成功或重试耗尽）', () => {
    const sim = runWaveAuto(initSim(plan, EDGE_REGIONS), 0, MAX_RETRIES, 7);
    for (let ri = 0; ri < EDGE_REGIONS.length; ri++) {
      for (let ai = 0; ai < sim.waveAssetIds[0].length; ai++) {
        const status = sim.waves[0][ri].statuses[sim.waveAssetIds[0][ai]];
        const attempt = sim.attempts[0][ri][ai];
        const terminal = status === 'success' || (status === 'timeout' && attempt > MAX_RETRIES);
        expect(terminal).toBe(true);
      }
    }
  });

  it('cellSeed 对相同单元稳定、不同单元不同', () => {
    expect(cellSeed(0, 1, 2)).toBe(cellSeed(0, 1, 2));
    expect(cellSeed(0, 1, 2)).not.toBe(cellSeed(0, 2, 1));
  });

  it('RNG 序列确定且落在 [0,1)', () => {
    const r1 = makeRng(99);
    const r2 = makeRng(99);
    const seq1 = [r1(), r1(), r1()];
    const seq2 = [r2(), r2(), r2()];
    expect(seq1).toEqual(seq2);
    for (const x of seq1) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
