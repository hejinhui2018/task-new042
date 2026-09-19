import type { InvalidationPlan, PlannedAsset, Scenario, Version } from '../domain/types';
import { CONCLUSION_META, RULE_LABEL } from './format';
import { countByConclusion } from '../domain/compare';

interface Props {
  scenario: Scenario;
  version: Version;
  plan: InvalidationPlan;
  fingerprint: string;
}

const KIND_LABEL: Record<string, string> = { html: 'HTML', css: 'CSS', js: 'JS', font: '字体', img: '图片' };

export function PlanPanel({ scenario, version, plan, fingerprint }: Props) {
  const counts = countByConclusion(plan);
  const order = ['purge-now', 'stale-refresh', 'unsafe-keep'] as const;

  return (
    <div>
      <div className="panel">
        <h2>
          {scenario.name} · {version.label}
          <span className="count">规划指纹</span>
          <span className="fp" title="结论与 purge 范围的稳定哈希，策略相同时恒定">{fingerprint}</span>
        </h2>
        <p className="section-sub">{scenario.description}</p>
        <div className="stat-row">
          <div className="stat danger">
            <div className="n">{counts['purge-now']}</div>
            <div className="t">必须立即清除</div>
          </div>
          <div className="stat warn">
            <div className="n">{counts['stale-refresh']}</div>
            <div className="t">可延迟刷新</div>
          </div>
          <div className="stat muted">
            <div className="n">{counts['unsafe-keep']}</div>
            <div className="t">不能安全清除</div>
          </div>
        </div>

        <div className="wave-flow">
          {plan.waves.map((w, i) => (
            <div key={w.title} style={{ display: 'contents' }}>
              {i > 0 && <div className="wave-arrow">→</div>}
              <div className="wave-pill">
                <div className="wp-title">{w.title}</div>
                <div className="wp-n">{w.assetIds.length} 个对象</div>
              </div>
            </div>
          ))}
        </div>
        <p className="section-sub" style={{ marginTop: 8 }}>
          实际 purge 范围：
          {plan.allPurgeKeys.length > 0 && (
            <span className="keys-line" style={{ display: 'inline-flex', marginLeft: 6 }}>
              {plan.allPurgeKeys.map((k) => (
                <span key={k} className="badge key">{k}</span>
              ))}
            </span>
          )}
          {plan.allPurgeUrls.length > 0 && (
            <span className="keys-line" style={{ display: 'inline-flex', marginLeft: 6 }}>
              {plan.allPurgeUrls.map((u) => (
                <span key={u} className="badge" title={u}>{u.split('/').slice(-2).join('/')}</span>
              ))}
            </span>
          )}
          {plan.allPurgeKeys.length === 0 && plan.allPurgeUrls.length === 0 && (
            <em style={{ marginLeft: 4 }}>无可安全执行的 purge（全部对象不安全或无需清除）</em>
          )}
        </p>
      </div>

      {plan.assets.length === 0 && (
        <div className="panel">
          <div className="empty-note">未选择任何路由：本次没有需要失效的对象。勾选左侧路由后生成规划。</div>
        </div>
      )}

      {order.map((conclusion) => {
        const items = plan.assets.filter((a) => a.conclusion === conclusion);
        if (items.length === 0) return null;
        const meta = CONCLUSION_META[conclusion];
        return (
          <div key={conclusion} className="panel">
            <div className="group-title">
              <span className={`dot ${meta.tone}`} />
              {meta.label}
              <span className="count">{items.length}</span>
              <span className="desc">{meta.desc}</span>
            </div>
            {items.map((a) => (
              <AssetCard key={a.assetId} asset={a} plan={plan} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function AssetCard({ asset, plan }: { asset: PlannedAsset; plan: InvalidationPlan }) {
  const tone = CONCLUSION_META[asset.conclusion].tone;
  const droppedKeys = asset.keys.filter((k) => !asset.purgeKeys.includes(k));
  return (
    <div className={`asset-card ${tone}`}>
      <div className="asset-head">
        <span className="asset-url">{asset.url}</span>
        <span className="asset-id">{asset.assetId}</span>
      </div>
      <div className="badges">
        <span className="badge kind">{KIND_LABEL[asset.kind] ?? asset.kind}</span>
        <span className="badge policy">{CONCLUSION_POLICY[asset.policy] ?? asset.policy}</span>
        {asset.keys.map((k) => (
          <span key={k} className={`badge key${droppedKeys.includes(k) ? ' dropped' : ''}`} title={droppedKeys.includes(k) ? '该 key 会误伤旧副本，已从 purge 集合剔除' : ''}>
            key: {k}
          </span>
        ))}
        {asset.purgeKeys.length > 0 && (
          <span className="badge">本次 purge key: {asset.purgeKeys.join(', ')}</span>
        )}
        {asset.purgeUrls.length > 0 && (
          <span className="badge">本次逐 URL purge（{asset.purgeUrls.length} 条）</span>
        )}
      </div>
      <ul className="reasons">
        {asset.reasons.map((r, i) => (
          <li key={i}>
            <span className="rule-tag">{r.rule}</span>
            <b>{RULE_LABEL[r.rule] ?? r.rule}：</b>
            {r.text}
            {r.via.length > 0 && <span className="via">（依赖：{r.via.join('、')}）</span>}
          </li>
        ))}
      </ul>
      {asset.remediation && (
        <div className="remediation">
          <b>建议处置：</b>
          {asset.remediation}
        </div>
      )}
      {conclusionWaveNote(asset, plan)}
    </div>
  );
}

function conclusionWaveNote(asset: PlannedAsset, plan: InvalidationPlan) {
  const wave = plan.waves.find((w) => w.assetIds.includes(asset.assetId));
  if (!wave) return null;
  return <div className="section-sub" style={{ marginTop: 6 }}>执行位置：{wave.title} — {wave.rationale}</div>;
}

const CONCLUSION_POLICY: Record<string, string> = {
  'no-cache': 'no-cache',
  srl: 'stale-while-revalidate',
  immutable: 'immutable',
};
