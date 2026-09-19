import { useMemo } from 'react';
import { ASSETS, ROUTES, SCENARIO } from '../data/scenario';
import { computeRouteRefs } from '../lib/plan';
import type { Selection, StrategyConfig } from '../types';
import type { Action } from '../state/store';

interface Props {
  selection: Selection;
  strategy: StrategyConfig;
  apply: (action: Action) => void;
}

/** 左栏：场景说明 + 改动路由/资源选择 + 缓存策略 */
export function ScenarioPanel({ selection, strategy, apply }: Props) {
  const routeRefs = useMemo(() => computeRouteRefs(ROUTES, ASSETS), []);
  const sharedAssets = useMemo(() => {
    const set = new Set<string>();
    for (const [assetId, routes] of routeRefs) {
      if (routes.length > 1) set.add(assetId);
    }
    return set;
  }, [routeRefs]);

  return (
    <div className="panel">
      <section className="card scenario-card">
        <h2>{SCENARIO.title}</h2>
        <p className="muted">{SCENARIO.description}</p>
        <ul className="change-list">
          {SCENARIO.changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h3>① 本次改动的路由</h3>
        <p className="hint">入口 HTML 随选中路由自动纳入改动</p>
        {ROUTES.map((route) => (
          <label className="check-row" key={route.id}>
            <input
              type="checkbox"
              checked={selection.routeIds.includes(route.id)}
              onChange={() => apply({ type: 'toggle-route', routeId: route.id })}
            />
            <code className="route-path">{route.path}</code>
            <span className="route-name">{route.name}</span>
          </label>
        ))}
      </section>

      <section className="card">
        <h3>② 本次变更的资源</h3>
        {ASSETS.map((asset) => (
          <label className="check-row" key={asset.id}>
            <input
              type="checkbox"
              checked={selection.assetIds.includes(asset.id)}
              onChange={() => apply({ type: 'toggle-asset', assetId: asset.id })}
            />
            <span className={`type-badge type-${asset.type}`}>{asset.type}</span>
            <span className="asset-name-sm">{asset.name}</span>
            <span className="asset-version">{asset.version}</span>
            {sharedAssets.has(asset.id) && <span className="shared-badge">跨路由共享</span>}
          </label>
        ))}
      </section>

      <section className="card">
        <h3>③ 缓存策略</h3>
        <div className="field">
          <span className="field-label">SWR 资源处理</span>
          <label className="check-row">
            <input
              type="radio"
              name="swrHandling"
              checked={strategy.swrHandling === 'defer'}
              onChange={() => apply({ type: 'set-strategy', patch: { swrHandling: 'defer' } })}
            />
            延迟刷新（利用 stale-while-revalidate 窗口）
          </label>
          <label className="check-row">
            <input
              type="radio"
              name="swrHandling"
              checked={strategy.swrHandling === 'purge'}
              onChange={() => apply({ type: 'set-strategy', patch: { swrHandling: 'purge' } })}
            />
            立即清除
          </label>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={strategy.includeCrossRouteShared}
            onChange={() =>
              apply({
                type: 'set-strategy',
                patch: { includeCrossRouteShared: !strategy.includeCrossRouteShared },
              })
            }
          />
          允许清除跨路由共享资源（会影响未选中的路由）
        </label>
        <label className="check-row">
          单节点最大重试次数
          <input
            className="num-input"
            type="number"
            min={0}
            max={5}
            value={strategy.maxRetries}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(n)) {
                apply({ type: 'set-strategy', patch: { maxRetries: Math.max(0, Math.min(5, n)) } });
              }
            }}
          />
        </label>
      </section>
    </div>
  );
}
