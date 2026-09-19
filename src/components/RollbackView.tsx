import { useMemo } from 'react';
import { ASSET_MAP, ASSETS, NODES } from '../data/scenario';
import type { Plan } from '../lib/plan';
import { computeRollback, type SimState } from '../lib/simulate';

interface Props {
  plan: Plan;
  sim: SimState;
}

/** 最小回退计划：仅包含已清除成功的资源与节点，按原波次顺序回滚 */
export function RollbackView({ plan, sim }: Props) {
  const rollback = useMemo(() => computeRollback(plan, sim, ASSETS, NODES), [plan, sim]);
  if (rollback.steps.length === 0 && rollback.unrecoverable.length === 0) return null;

  return (
    <section className={`card rollback-card ${sim.status === 'failed' ? 'rollback-alert' : ''}`}>
      <h3>最小回退计划</h3>
      <p className="hint">
        仅包含已在边缘节点清除成功的资源（最小集合）。请先将源站回滚到对应版本，再按下表在对应节点重新清除。
      </p>
      {rollback.steps.length > 0 && (
        <table className="rollback-table">
          <thead>
            <tr>
              <th>顺序</th>
              <th>资源</th>
              <th>回滚至</th>
              <th>目标节点</th>
            </tr>
          </thead>
          <tbody>
            {rollback.steps.map((step, i) => (
              <tr key={`${step.wave}-${step.assetId}`}>
                <td>{i + 1}</td>
                <td>{ASSET_MAP.get(step.assetId)?.name ?? step.assetId}</td>
                <td>
                  <code>{step.toVersion}</code>
                </td>
                <td>
                  {step.nodeIds.map((id) => {
                    const node = NODES.find((n) => n.id === id);
                    return (
                      <span key={id} className="chip chip-sm">
                        {node ? `${node.region}·${node.name}` : id}
                      </span>
                    );
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rollback.unrecoverable.length > 0 && (
        <div className="unrecoverable">
          <h4>无法自动回退</h4>
          {rollback.unrecoverable.map((u) => (
            <p key={u.assetId} className="warning">
              ⚠ {ASSET_MAP.get(u.assetId)?.name ?? u.assetId}：{u.reason}（涉及 {u.nodeIds.length} 个节点）
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
