import type { DocState, GlobalStrategy, Scenario } from '../domain/types';
import { POLICY_LABEL } from './format';

interface Props {
  scenario: Scenario;
  doc: DocState;
  commit: (next: DocState) => void;
}

export function StrategyPanel({ scenario, doc, commit }: Props) {
  const version = scenario.versions.find((v) => v.id === doc.versionId)!;

  const setRoutes = (routeId: string, patch: Partial<DocState['routes'][number]>) => {
    commit({
      ...doc,
      routes: doc.routes.map((r) => (r.routeId === routeId ? { ...r, ...patch } : r)),
    });
  };

  const setGlobal = (patch: Partial<GlobalStrategy>) =>
    commit({ ...doc, global: { ...doc.global, ...patch } });

  const setPolicy = (assetId: string, value: string) => {
    const overrides = { ...doc.policyOverrides };
    if (value === '') delete overrides[assetId];
    else overrides[assetId] = value as DocState['policyOverrides'][string];
    commit({ ...doc, policyOverrides: overrides });
  };

  return (
    <div>
      <div className="panel">
        <h2>发布版本</h2>
        <div className="seg" style={{ display: 'flex', width: '100%' }}>
          {scenario.versions.map((v) => (
            <button
              key={v.id}
              className={v.id === doc.versionId ? 'active' : ''}
              style={{ flex: 1 }}
              onClick={() => commit({ ...doc, versionId: v.id })}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="section-sub" style={{ marginTop: 8 }}>
          切换到 v1 即等价于规划一次回滚发布；右侧「最小回退计划」给出按执行结果裁剪的反向操作清单。
        </p>
      </div>

      <div className="panel">
        <h2>
          本次改动的路由
          <span className="count">{doc.routes.filter((r) => r.selected).length} 已选</span>
        </h2>
        {doc.routes.map((rs) => {
          const route = version.routes.find((r) => r.id === rs.routeId)!;
          return (
            <div key={rs.routeId} className={`route-row${rs.selected ? '' : ' unselected'}`}>
              <div className="route-head">
                <input
                  type="checkbox"
                  checked={rs.selected}
                  onChange={(e) => setRoutes(rs.routeId, { selected: e.target.checked })}
                />
                <span className="route-path">{route.path}</span>
                <span className="route-name">{route.name}</span>
              </div>
              {rs.selected && (
                <label className="route-opt">
                  <input
                    type="checkbox"
                    checked={rs.allowStale}
                    onChange={(e) => setRoutes(rs.routeId, { allowStale: e.target.checked })}
                  />
                  入口允许 SWR 软失效（先放行旧文档、后台刷新）
                </label>
              )}
            </div>
          );
        })}
      </div>

      <div className="panel">
        <h2>缓存策略</h2>
        <div className="switch-row">
          <div>
            <div>按 surrogate key 批量失效</div>
            <div className="hint">关闭后改为逐 URL purge，可绕开宽 key 碰撞</div>
          </div>
          <input
            type="checkbox"
            checked={doc.global.useSurrogateKeys}
            onChange={(e) => setGlobal({ useSurrogateKeys: e.target.checked })}
          />
        </div>
        <div className="field">
          <label>
            SWR 容忍延迟
            <input
              type="number"
              min={0}
              step={30}
              value={doc.global.staleToleranceSec}
              onChange={(e) => setGlobal({ staleToleranceSec: Math.max(0, Number(e.target.value) || 0) })}
            />
            秒
          </label>
          <div className="hint">为 0 时 SWR 资源升级为立即清除</div>
        </div>
        <div className="field">
          <label>
            边缘超时
            <input
              type="number"
              min={100}
              step={100}
              value={doc.global.edgeTimeoutMs}
              onChange={(e) => setGlobal({ edgeTimeoutMs: Math.max(100, Number(e.target.value) || 800) })}
            />
            ms
          </label>
        </div>
        <div className="field">
          <label>
            最大重试
            <input
              type="number"
              min={0}
              max={6}
              value={doc.global.maxRetries}
              onChange={(e) => setGlobal({ maxRetries: Math.max(0, Math.min(6, Number(e.target.value) || 0)) })}
            />
            次
          </label>
        </div>

        <details className="advanced">
          <summary>逐资源覆盖缓存策略（{Object.keys(doc.policyOverrides).length}）</summary>
          <div style={{ marginTop: 10 }}>
            {version.assets.map((a) => (
              <div key={a.id} className="policy-row">
                <div className="meta">
                  <span>{a.id}</span>
                  <span className="url" title={a.url}>
                    {a.url}
                  </span>
                </div>
                <select value={doc.policyOverrides[a.id] ?? ''} onChange={(e) => setPolicy(a.id, e.target.value)}>
                  <option value="">默认：{POLICY_LABEL[a.policy]}</option>
                  <option value="no-cache">{POLICY_LABEL['no-cache']}</option>
                  <option value="srl">{POLICY_LABEL.srl}</option>
                  <option value="immutable">{POLICY_LABEL.immutable}</option>
                </select>
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
