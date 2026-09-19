import { useEffect, useMemo, useReducer } from 'react';
import { ASSETS, ROUTES, SCENARIO } from './data/scenario';
import { computePlan, planHash } from './lib/plan';
import { historyReducer, initialHistory } from './state/history';
import { clearPersisted, loadPersisted, persist } from './state/persistence';
import type { Action } from './state/store';
import { ScenarioPanel } from './components/ScenarioPanel';
import { ScopeView } from './components/ScopeView';
import { CompareView } from './components/CompareView';
import { SimulationPanel } from './components/SimulationPanel';
import { RollbackView } from './components/RollbackView';

export default function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () =>
    initialHistory(loadPersisted() ?? undefined),
  );
  const { present } = history;

  const plan = useMemo(
    () => computePlan(ROUTES, ASSETS, present.selection, present.strategy),
    [present.selection, present.strategy],
  );
  const hash = useMemo(() => planHash(plan), [plan]);

  // 刷新恢复：每次状态变化后持久化到 localStorage
  useEffect(() => {
    persist(present);
  }, [present]);

  // Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ kind: e.shiftKey ? 'redo' : 'undo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const apply = (action: Action) => dispatch({ kind: 'apply', action });
  const reset = () => {
    clearPersisted();
    dispatch({ kind: 'reset' });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          CacheSketch <span className="brand-sub">缓存失效规划台</span>
        </div>
        <code className="plan-hash" title="当前计划的稳定哈希（输入不变则哈希不变）">
          #{hash}
        </code>
        <div className="spacer" />
        <span className="saved muted">已自动保存 · 刷新可恢复</span>
        <button onClick={() => dispatch({ kind: 'undo' })} disabled={history.past.length === 0}>
          ↩ 撤销
        </button>
        <button onClick={() => dispatch({ kind: 'redo' })} disabled={history.future.length === 0}>
          ↪ 重做
        </button>
        <button className="danger" onClick={reset}>
          重置
        </button>
      </header>

      <div className="scenario-banner">
        <strong>{SCENARIO.title}</strong>
        <span className="muted">{SCENARIO.description}</span>
      </div>

      <main className="layout">
        <aside className="col-left">
          <ScenarioPanel selection={present.selection} strategy={present.strategy} apply={apply} />
        </aside>
        <section className="col-center">
          <ScopeView plan={plan} />
          <CompareView plan={plan} planHash={hash} baseline={present.baseline} apply={apply} />
        </section>
        <aside className="col-right">
          <SimulationPanel
            plan={plan}
            sim={present.sim}
            schedule={present.schedule}
            strategy={present.strategy}
            apply={apply}
          />
          <RollbackView plan={plan} sim={present.sim} />
        </aside>
      </main>
    </div>
  );
}
