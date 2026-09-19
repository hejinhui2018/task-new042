import { describe, expect, it } from 'vitest';
import { historyReducer, initialHistory } from '../state/history';
import { createInitialState, reducer } from '../state/store';

describe('状态与撤销重做', () => {
  it('toggle-route 切换路由选择', () => {
    const s0 = createInitialState();
    const s1 = reducer(s0, { type: 'toggle-route', routeId: 'route.home' });
    expect(s1.selection.routeIds).toContain('route.home');
    const s2 = reducer(s1, { type: 'toggle-route', routeId: 'route.home' });
    expect(s2.selection.routeIds).not.toContain('route.home');
  });

  it('改动选择或策略会使模拟状态失效', () => {
    const s0 = createInitialState();
    const withSim = {
      ...s0,
      sim: { ...s0.sim, status: 'running' as const, currentWave: 1 },
      schedule: { '0::edge-ap-shanghai': 1 },
    };
    const s1 = reducer(withSim, { type: 'toggle-asset', assetId: 'font.brand' });
    expect(s1.sim.status).toBe('idle');
    expect(s1.schedule).toEqual({});
    const s2 = reducer(withSim, { type: 'set-strategy', patch: { swrHandling: 'purge' } });
    expect(s2.sim.status).toBe('idle');
  });

  it('cycle-schedule 循环递增并归零删除', () => {
    let s = createInitialState();
    s = reducer(s, { type: 'cycle-schedule', key: 'k', max: 2 });
    expect(s.schedule.k).toBe(1);
    s = reducer(s, { type: 'cycle-schedule', key: 'k', max: 2 });
    expect(s.schedule.k).toBe(2);
    s = reducer(s, { type: 'cycle-schedule', key: 'k', max: 2 });
    expect(s.schedule.k).toBeUndefined();
  });

  it('撤销/重做：apply 入栈，undo 回退，redo 重放，新 apply 清空 future', () => {
    let h = initialHistory();
    const original = h.present;
    h = historyReducer(h, { kind: 'apply', action: { type: 'toggle-route', routeId: 'route.home' } });
    expect(h.present.selection.routeIds).toContain('route.home');
    expect(h.past).toHaveLength(1);

    h = historyReducer(h, { kind: 'undo' });
    expect(h.present).toBe(original);
    expect(h.future).toHaveLength(1);

    h = historyReducer(h, { kind: 'redo' });
    expect(h.present.selection.routeIds).toContain('route.home');

    h = historyReducer(h, { kind: 'undo' });
    h = historyReducer(h, { kind: 'apply', action: { type: 'toggle-asset', assetId: 'font.brand' } });
    expect(h.future).toHaveLength(0);
  });

  it('无变化的 apply 不入栈', () => {
    let h = initialHistory();
    h = historyReducer(h, { kind: 'apply', action: { type: 'sim-reset' } });
    expect(h.past).toHaveLength(0);
  });

  it('reset 恢复到初始场景并清空历史', () => {
    let h = initialHistory();
    h = historyReducer(h, { kind: 'apply', action: { type: 'toggle-route', routeId: 'route.home' } });
    h = historyReducer(h, { kind: 'reset' });
    expect(h.present).toEqual(createInitialState());
    expect(h.past).toHaveLength(0);
    expect(h.future).toHaveLength(0);
  });
});
