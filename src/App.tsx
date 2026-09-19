import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { SPRING_SCENARIO, EDGE_REGIONS } from './domain/scenario';
import { buildPlan } from './domain/plan';
import { initSim } from './domain/simulate';
import type { InvalidationPlan, SimState } from './domain/types';
import { planFingerprint } from './domain/canonical';
import {
  clearPersistence,
  defaultDoc,
  historyReducer,
  initHistory,
  loadDoc,
  loadSim,
  saveDoc,
  saveSim,
} from './state/history';
import { StrategyPanel } from './ui/StrategyPanel';
import { PlanPanel } from './ui/PlanPanel';
import { SimPanel } from './ui/SimPanel';
import { DiffPanel } from './ui/DiffPanel';
import { RollbackPanel } from './ui/RollbackPanel';
import { assetLabel } from './ui/format';

type RightTab = 'sim' | 'diff' | 'rollback';

export function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () =>
    initHistory(loadDoc() ?? defaultDoc()),
  );
  const doc = history.present;

  const version = useMemo(
    () => SPRING_SCENARIO.versions.find((v) => v.id === doc.versionId)!,
    [doc.versionId],
  );
  const previousVersion = useMemo(
    () => SPRING_SCENARIO.versions.find((v) => v.id !== doc.versionId)!,
    [doc.versionId],
  );

  const plan: InvalidationPlan = useMemo(
    () =>
      buildPlan({
        target: version,
        allVersions: SPRING_SCENARIO.versions,
        routes: doc.routes,
        policyOverrides: doc.policyOverrides,
        global: doc.global,
      }),
    [version, doc.routes, doc.policyOverrides, doc.global],
  );
  const fingerprint = useMemo(() => planFingerprint(plan), [plan]);

  // ── 模拟：规划指纹变化时尝试恢复，否则重新初始化 ──
  const [sim, setSimState] = useState<SimState>(() => initSim(plan, EDGE_REGIONS));
  useEffect(() => {
    setSimState(loadSim(plan) ?? initSim(plan, EDGE_REGIONS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  const setSim = useCallback(
    (next: SimState) => {
      setSimState(next);
      saveSim(next, plan);
    },
    [plan],
  );

  // ── 文档持久化（刷新恢复） ──
  useEffect(() => {
    saveDoc(doc);
  }, [doc]);

  // ── 撤销/重做快捷键 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
    };
    const onRedo = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.key.toLowerCase() !== 'y') return;
      e.preventDefault();
      dispatch({ type: 'redo' });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onRedo);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onRedo);
    };
  }, []);

  // ── 前后对比基线（独立于撤销栈的分析快照） ──
  const [baseline, setBaseline] = useState<InvalidationPlan | null>(null);
  const [tab, setTab] = useState<RightTab>('sim');

  const resetAll = () => {
    if (!window.confirm('确定重置为默认场景？将清空撤销历史、模拟结果与本地存储。')) return;
    clearPersistence();
    dispatch({ type: 'reset' });
    setBaseline(null);
    setTab('sim');
  };

  const labelOf = useCallback((id: string) => assetLabel(version, id), [version]);

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="logo">C</div>
          <div>
            <h1>CacheSketch · 缓存失效规划台</h1>
            <small>纯浏览器本地运行 · surrogate key / 引用闭包 / SWR 波次规划</small>
          </div>
        </div>
        <div className="spacer" />
        <button
          className="iconbtn"
          disabled={history.past.length === 0}
          onClick={() => dispatch({ type: 'undo' })}
          title="撤销 (Ctrl/Cmd+Z)"
        >
          ↶ 撤销
        </button>
        <button
          className="iconbtn"
          disabled={history.future.length === 0}
          onClick={() => dispatch({ type: 'redo' })}
          title="重做 (Ctrl/Cmd+Shift+Z)"
        >
          ↷ 重做
        </button>
        <button className="iconbtn" onClick={resetAll}>重置</button>
        <span className="save-hint">已自动保存到本地</span>
      </header>

      <main className="shell">
        <div>
          <StrategyPanel scenario={SPRING_SCENARIO} doc={doc} commit={(next) => dispatch({ type: 'commit', next })} />
        </div>

        <div>
          <PlanPanel scenario={SPRING_SCENARIO} version={version} plan={plan} fingerprint={fingerprint} />
        </div>

        <div>
          <div className="tabs">
            <button className={tab === 'sim' ? 'active' : ''} onClick={() => setTab('sim')}>
              边缘模拟
            </button>
            <button className={tab === 'diff' ? 'active' : ''} onClick={() => setTab('diff')}>
              前后对比
            </button>
            <button className={tab === 'rollback' ? 'active' : ''} onClick={() => setTab('rollback')}>
              最小回退
            </button>
          </div>

          {tab === 'sim' && (
            <SimPanel
              plan={plan}
              sim={sim}
              setSim={setSim}
              maxRetries={doc.global.maxRetries}
              regions={EDGE_REGIONS}
            />
          )}
          {tab === 'diff' && (
            <DiffPanel
              baseline={baseline}
              current={plan}
              labelOf={labelOf}
              pinned={baseline !== null}
              onPin={() => setBaseline(plan)}
            />
          )}
          {tab === 'rollback' && (
            <RollbackPanel
              plan={plan}
              previousVersion={previousVersion}
              sim={sim}
              regions={EDGE_REGIONS}
              targetingOld={doc.versionId === SPRING_SCENARIO.versions[0].id}
            />
          )}
        </div>
      </main>
    </>
  );
}
