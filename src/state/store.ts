import type { EdgeNode, Selection, StrategyConfig } from '../types';
import type { Plan } from '../lib/plan';
import { createSimState, runAllWaves, runWave, type SimState } from '../lib/simulate';
import { defaultSelection, defaultStrategy } from '../data/scenario';

/** 某一时刻计划的快照，用于「比较前后范围」 */
export interface PlanSnapshot {
  hash: string;
  /** assetId -> 分类（purge-now / defer / unsafe / unaffected） */
  classification: Record<string, string>;
  /** assetId -> 波次下标（仅立即清除的资源） */
  waveOf: Record<string, number>;
  label: string;
}

export interface AppState {
  selection: Selection;
  strategy: StrategyConfig;
  /** 故障注入：cellKey -> 成功前强制超时次数 */
  schedule: Record<string, number>;
  sim: SimState;
  /** 用户固定的基准计划快照 */
  baseline: PlanSnapshot | null;
}

export type Action =
  | { type: 'toggle-route'; routeId: string }
  | { type: 'toggle-asset'; assetId: string }
  | { type: 'set-strategy'; patch: Partial<StrategyConfig> }
  | { type: 'cycle-schedule'; key: string; max: number }
  | { type: 'set-schedule'; schedule: Record<string, number> }
  | { type: 'sim-run-wave'; plan: Plan; nodes: readonly EdgeNode[] }
  | { type: 'sim-run-all'; plan: Plan; nodes: readonly EdgeNode[] }
  | { type: 'sim-reset' }
  | { type: 'pin-baseline'; snapshot: PlanSnapshot }
  | { type: 'clear-baseline' };

export function createInitialState(): AppState {
  return {
    selection: defaultSelection(),
    strategy: defaultStrategy(),
    schedule: {},
    sim: createSimState(),
    baseline: null,
  };
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** 计划相关输入变化后，模拟结果与故障注入随之失效，一并重置 */
function invalidateSim(state: AppState): AppState {
  return { ...state, sim: createSimState(), schedule: {} };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'toggle-route':
      return invalidateSim({
        ...state,
        selection: { ...state.selection, routeIds: toggle(state.selection.routeIds, action.routeId) },
      });
    case 'toggle-asset':
      return invalidateSim({
        ...state,
        selection: { ...state.selection, assetIds: toggle(state.selection.assetIds, action.assetId) },
      });
    case 'set-strategy':
      return invalidateSim({ ...state, strategy: { ...state.strategy, ...action.patch } });
    case 'cycle-schedule': {
      const current = state.schedule[action.key] ?? 0;
      const next = current >= action.max ? 0 : current + 1;
      const schedule = { ...state.schedule };
      if (next === 0) delete schedule[action.key];
      else schedule[action.key] = next;
      return { ...state, schedule };
    }
    case 'set-schedule':
      return { ...state, schedule: action.schedule };
    case 'sim-run-wave': {
      const sim = runWave(state.sim, action.plan, action.nodes, state.schedule, state.strategy.maxRetries);
      if (sim === state.sim) return state;
      return { ...state, sim };
    }
    case 'sim-run-all': {
      const sim = runAllWaves(state.sim, action.plan, action.nodes, state.schedule, state.strategy.maxRetries);
      if (sim === state.sim) return state;
      return { ...state, sim };
    }
    case 'sim-reset': {
      const { sim } = state;
      if (
        sim.status === 'idle' &&
        sim.currentWave === 0 &&
        sim.log.length === 0 &&
        Object.keys(sim.cells).length === 0
      ) {
        return state; // 已是初始模拟状态，无变化
      }
      return { ...state, sim: createSimState() };
    }
    case 'pin-baseline':
      return { ...state, baseline: action.snapshot };
    case 'clear-baseline':
      return { ...state, baseline: null };
    default:
      return state;
  }
}
