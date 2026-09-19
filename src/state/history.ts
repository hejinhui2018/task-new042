import type { Action, AppState } from './store';
import { createInitialState, reducer } from './store';

/** 撤销/重做历史：past / present / future 三段快照 */
export interface History {
  past: AppState[];
  present: AppState;
  future: AppState[];
}

export type HistoryAction =
  | { kind: 'apply'; action: Action }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'reset' }
  | { kind: 'hydrate'; state: AppState };

const HISTORY_LIMIT = 100;

export function initialHistory(state?: AppState): History {
  return { past: [], present: state ?? createInitialState(), future: [] };
}

export function historyReducer(history: History, action: HistoryAction): History {
  switch (action.kind) {
    case 'apply': {
      const next = reducer(history.present, action.action);
      if (next === history.present) return history; // 无变化不入栈
      return {
        past: [...history.past, history.present].slice(-HISTORY_LIMIT),
        present: next,
        future: [],
      };
    }
    case 'undo': {
      if (history.past.length === 0) return history;
      return {
        past: history.past.slice(0, -1),
        present: history.past[history.past.length - 1],
        future: [history.present, ...history.future],
      };
    }
    case 'redo': {
      if (history.future.length === 0) return history;
      return {
        past: [...history.past, history.present],
        present: history.future[0],
        future: history.future.slice(1),
      };
    }
    case 'reset':
      return initialHistory();
    case 'hydrate':
      return initialHistory(action.state);
    default:
      return history;
  }
}
