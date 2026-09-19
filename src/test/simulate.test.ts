import { describe, expect, it } from 'vitest';
import { ASSETS, NODES, ROUTES, defaultSelection, defaultStrategy } from '../data/scenario';
import { computePlan } from '../lib/plan';
import { cellKey, createSimState, runAllWaves, runWave } from '../lib/simulate';

const plan = computePlan(ROUTES, ASSETS, defaultSelection(), defaultStrategy());
// 默认计划：波次 0 = [html.spring, html.spring-promo]，波次 1 = [css.spring, img.hero]

describe('波次执行与超时重试', () => {
  it('全部成功时逐波推进直至完成', () => {
    let sim = createSimState();
    sim = runWave(sim, plan, NODES, {}, 2);
    expect(sim.currentWave).toBe(1);
    expect(sim.status).toBe('running');
    for (const node of NODES) {
      expect(sim.cells[cellKey(0, node.id)]).toEqual({ status: 'success', attempts: 1 });
    }
    sim = runWave(sim, plan, NODES, {}, 2);
    expect(sim.status).toBe('done');
    expect(sim.currentWave).toBe(2);
  });

  it('波次门禁：前一波未完成时不会触碰后续波次', () => {
    const sim = runWave(createSimState(), plan, NODES, {}, 2);
    // 只执行了波次 0，波次 1 的单元格不存在
    for (const node of NODES) {
      expect(sim.cells[cellKey(1, node.id)]).toBeUndefined();
    }
  });

  it('超时的节点会重试，成功后波次才推进', () => {
    const schedule = { [cellKey(0, 'edge-ap-singapore')]: 1 };
    let sim = runWave(createSimState(), plan, NODES, schedule, 2);
    // 新加坡超时，波次不推进
    expect(sim.cells[cellKey(0, 'edge-ap-singapore')]).toEqual({ status: 'timeout', attempts: 1 });
    expect(sim.currentWave).toBe(0);
    expect(sim.status).toBe('running');
    // 其余节点已成功
    expect(sim.cells[cellKey(0, 'edge-ap-shanghai')].status).toBe('success');

    // 再次执行：只重试未成功的节点
    sim = runWave(sim, plan, NODES, schedule, 2);
    expect(sim.cells[cellKey(0, 'edge-ap-singapore')]).toEqual({ status: 'success', attempts: 2 });
    expect(sim.currentWave).toBe(1);
    // 已成功的节点不重复尝试
    expect(sim.cells[cellKey(0, 'edge-ap-shanghai')].attempts).toBe(1);
  });

  it('重试耗尽后标记失败并停止，且状态不可继续推进', () => {
    const schedule = { [cellKey(0, 'edge-ap-singapore')]: 5 };
    let sim = createSimState();
    sim = runWave(sim, plan, NODES, schedule, 2); // 尝试 1：超时
    expect(sim.cells[cellKey(0, 'edge-ap-singapore')].status).toBe('timeout');
    sim = runWave(sim, plan, NODES, schedule, 2); // 尝试 2：超时
    expect(sim.cells[cellKey(0, 'edge-ap-singapore')].status).toBe('timeout');
    sim = runWave(sim, plan, NODES, schedule, 2); // 尝试 3 > maxRetries 2：失败
    expect(sim.cells[cellKey(0, 'edge-ap-singapore')]).toEqual({ status: 'failed', attempts: 3 });
    expect(sim.status).toBe('failed');
    expect(sim.currentWave).toBe(0);

    // 失败后继续调用是 no-op
    const after = runWave(sim, plan, NODES, schedule, 2);
    expect(after).toBe(sim);
  });

  it('日志按顺序记录每次尝试', () => {
    const schedule = { [cellKey(0, 'edge-ap-singapore')]: 1 };
    let sim = runWave(createSimState(), plan, NODES, schedule, 2);
    sim = runWave(sim, plan, NODES, schedule, 2);
    const singaporeLog = sim.log.filter((e) => e.nodeId === 'edge-ap-singapore');
    expect(singaporeLog.map((e) => e.result)).toEqual(['timeout', 'success']);
    expect(singaporeLog.map((e) => e.attempt)).toEqual([1, 2]);
  });

  it('runAllWaves 连续执行直到完成（含重试）', () => {
    const schedule = { [cellKey(1, 'edge-eu-frankfurt')]: 2 };
    const sim = runAllWaves(createSimState(), plan, NODES, schedule, 2);
    expect(sim.status).toBe('done');
    expect(sim.cells[cellKey(1, 'edge-eu-frankfurt')]).toEqual({ status: 'success', attempts: 3 });
  });

  it('runAllWaves 在失败时停止', () => {
    const schedule = { [cellKey(1, 'edge-us-virginia')]: 9 };
    const sim = runAllWaves(createSimState(), plan, NODES, schedule, 2);
    expect(sim.status).toBe('failed');
    expect(sim.currentWave).toBe(1);
    expect(sim.cells[cellKey(1, 'edge-us-virginia')].status).toBe('failed');
  });
});
