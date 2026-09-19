import type { InvalidationPlan, PlanDiff } from '../domain/types';
import { diffPlans } from '../domain/compare';
import { CONCLUSION_META } from './format';

interface Props {
  baseline: InvalidationPlan | null;
  current: InvalidationPlan;
  labelOf: (id: string) => string;
  onPin: () => void;
  pinned: boolean;
}

export function DiffPanel({ baseline, current, labelOf, onPin, pinned }: Props) {
  let diff: PlanDiff | null = null;
  if (baseline) diff = diffPlans(baseline, current);

  return (
    <div>
      <div className="panel">
        <h2>前后范围对比</h2>
        <p className="section-sub">
          先「钉住当前规划」作为基线，再在左侧调整策略/路由，这里显示结论与范围差异。
        </p>
        <div className="btn-row">
          <button className="btn small" onClick={onPin}>
            {pinned ? '重新钉住当前规划为基线' : '钉住当前规划为基线'}
          </button>
          {baseline && <span className="section-sub" style={{ margin: 0 }}>基线已记录，调整左侧即可看到差异。</span>}
        </div>
      </div>

      {!diff && <div className="panel"><div className="empty-note">尚无基线。点击上方按钮钉住一份规划。</div></div>}

      {diff && (
        <>
          <div className="panel">
            <h2>结论变化 <span className="count">{diff.changedConclusion.length}</span></h2>
            {diff.changedConclusion.length === 0 ? (
              <div className="empty-note">结论与基线完全一致。</div>
            ) : (
              diff.changedConclusion.map((c) => (
                <div key={c.assetId} className="diff-row">
                  <span className="asset-id mono">{c.assetId}</span>
                  <span className={`tag ${c.before}`}>{CONCLUSION_META[c.before].label}</span>
                  <span className="diff-arrow">→</span>
                  <span className={`tag ${c.after}`}>{CONCLUSION_META[c.after].label}</span>
                </div>
              ))
            )}
          </div>
          <div className="panel">
            <h2>移出范围 <span className="count">{diff.onlyBefore.length}</span></h2>
            {diff.onlyBefore.length === 0 ? (
              <div className="empty-note">无。</div>
            ) : (
              diff.onlyBefore.map((id) => <div key={id} className="diff-row">− {labelOf(id)} <span className="asset-id">({id})</span></div>)
            )}
          </div>
          <div className="panel">
            <h2>新增进范围 <span className="count">{diff.onlyAfter.length}</span></h2>
            {diff.onlyAfter.length === 0 ? (
              <div className="empty-note">无。</div>
            ) : (
              diff.onlyAfter.map((id) => <div key={id} className="diff-row">＋ {labelOf(id)} <span className="asset-id">({id})</span></div>)
            )}
          </div>
        </>
      )}
    </div>
  );
}
