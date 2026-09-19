// ─────────────────────────────────────────────────────────────
// 应用文档状态：撤销/重做历史 + localStorage 持久化（纯数据、纯函数）
// ─────────────────────────────────────────────────────────────
import { SPRING_SCENARIO } from '../domain/scenario';
import { planFingerprint, stableStringify } from '../domain/canonical';
import type { DocState, GlobalStrategy, SimState } from '../domain/types';
import type { InvalidationPlan } from '../domain/types';

const STORAGE_KEY = 'cachesketch.doc.v1';
const SIM_STORAGE_KEY = 'cachesketch.sim.v1';

export const DEFAULT_GLOBAL: GlobalStrategy = {
  useSurrogateKeys: true,
  staleToleranceSec: 300,
  edgeTimeoutMs: 800,
  maxRetries: 2,
};

export function defaultDoc(): DocState {
  const v2 = SPRING_SCENARIO.versions[1];
  return {
    versionId: v2.id,
    routes: SPRING_SCENARIO.versions[0].routes.map((r) => ({
      routeId: r.id,
      selected: r.id === 'r-spring' || r.id === 'r-spring-sub',
      allowStale: false,
    })),
    policyOverrides: {},
    global: { ...DEFAULT_GLOBAL },
  };
}

// ── 历史 ──

export interface HistoryState {
  past: DocState[];
  present: DocState;
  future: DocState[];
}

export type DocAction =
  | { type: 'commit'; next: DocState }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'replace'; doc: DocState }
  | { type: 'reset' };

export function initHistory(doc: DocState = defaultDoc()): HistoryState {
  return { past: [], present: doc, future: [] };
}

export function historyReducer(state: HistoryState, action: DocAction): HistoryState {
  switch (action.type) {
    case 'commit':
      if (stableStringify(action.next) === stableStringify(state.present)) return state;
      return { past: [...state.past, state.present], present: action.next, future: [] };
    case 'undo': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
      };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
      };
    }
    case 'replace':
    case 'reset': {
      const doc = action.type === 'reset' ? defaultDoc() : action.doc;
      return { past: [], present: doc, future: [] };
    }
  }
}

// ── 便捷变更：基于 present 产出新文档 ──

export function patchPresent(present: DocState, patch: Partial<DocState>): DocState {
  return {
    versionId: patch.versionId ?? present.versionId,
    routes: patch.routes ?? present.routes.map((r) => ({ ...r })),
    policyOverrides: patch.policyOverrides ?? { ...present.policyOverrides },
    global: patch.global ?? { ...present.global },
  };
}

// ── 持久化 ──

export function saveDoc(doc: DocState): void {
  try {
    localStorage.setItem(STORAGE_KEY, stableStringify(doc));
  } catch {
    /* 隐私模式等场景下静默降级为内存态 */
  }
}

export function loadDoc(): DocState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DocState;
    // 简单结构校验，损坏则回落到默认
    if (!parsed.versionId || !Array.isArray(parsed.routes) || typeof parsed.global !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSim(sim: SimState, plan: InvalidationPlan): void {
  try {
    localStorage.setItem(
      SIM_STORAGE_KEY,
      stableStringify({ fp: planFingerprint(plan), sim }),
    );
  } catch {
    /* ignore */
  }
}

export function loadSim(plan: InvalidationPlan): SimState | null {
  try {
    const raw = localStorage.getItem(SIM_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fp: string; sim: SimState };
    if (parsed.fp !== planFingerprint(plan)) return null;
    return parsed.sim;
  } catch {
    return null;
  }
}

export function clearPersistence(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SIM_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
