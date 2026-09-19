import { ASSET_MAP } from '../data/scenario';
import type { ClassifiedAsset, Plan } from '../lib/plan';
import { ReasonList } from './ReasonList';

function AssetCard({ classified }: { classified: ClassifiedAsset }) {
  const asset = ASSET_MAP.get(classified.assetId);
  if (!asset) return null;
  return (
    <div className="asset-card">
      <div className="asset-head">
        <span className={`type-badge type-${asset.type}`}>{asset.type}</span>
        <span className="asset-name">{asset.name}</span>
        <span className="asset-version">{asset.version}</span>
      </div>
      <div className="asset-id muted">{asset.id}</div>
      <div className="keys">
        {asset.surrogateKeys.map((k) => (
          <span key={k} className="key-chip">
            {k}
          </span>
        ))}
      </div>
      <ReasonList reasons={classified.reasons} />
    </div>
  );
}

/** 中栏：失效范围三分类 + 执行波次，每个结论都带依赖依据 */
export function ScopeView({ plan }: { plan: Plan }) {
  return (
    <div className="panel">
      <section className="card">
        <h3>
          失效范围
          <span className="summary">
            <span className="count count-purge">立即清除 {plan.purgeNow.length}</span>
            <span className="count count-defer">延迟刷新 {plan.defer.length}</span>
            <span className="count count-unsafe">不能安全清除 {plan.unsafe.length}</span>
            <span className="count">不受影响 {plan.unaffected.length}</span>
          </span>
        </h3>

        <h4 className="group-title group-purge">必须立即清除</h4>
        {plan.waves.length > 0 && (
          <div className="waves">
            {plan.waves.map((wave) => (
              <div className="wave-row" key={wave.index}>
                <span className="wave-badge">波次 {wave.index + 1}</span>
                {wave.assetIds.map((id) => (
                  <span key={id} className="chip">
                    {ASSET_MAP.get(id)?.name ?? id}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
        {plan.purgeNow.length === 0 && <p className="muted">（无）</p>}
        {plan.purgeNow.map((c) => (
          <AssetCard key={c.assetId} classified={c} />
        ))}

        <h4 className="group-title group-defer">可以延迟刷新</h4>
        {plan.defer.length === 0 && <p className="muted">（无）</p>}
        {plan.defer.map((c) => (
          <AssetCard key={c.assetId} classified={c} />
        ))}

        <h4 className="group-title group-unsafe">不能安全清除</h4>
        {plan.unsafe.length === 0 && <p className="muted">（无）</p>}
        {plan.unsafe.map((c) => (
          <AssetCard key={c.assetId} classified={c} />
        ))}
      </section>
    </div>
  );
}
