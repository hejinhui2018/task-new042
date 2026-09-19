import { useMemo } from 'react';
import { ASSET_MAP } from '../data/scenario';
import type { Plan } from '../lib/plan';
import type { PlanSnapshot } from '../state/store';
import type { Action } from '../state/store';

const CLASS_LABEL: Record<string, string> = {
  'purge-now': '立即清除',
  defer: '延迟刷新',
  unsafe: '不能安全清除',
  unaffected: '不受影响',
};

export function classificationMap(plan: Plan): {
  classes: Record<string, string>;
  waveOf: Record<string, number>;
} {
  const classes: Record<string, string> = {};
  for (const c of plan.purgeNow) classes[c.assetId] = 'purge-now';
  for (const c of plan.defer) classes[c.assetId] = 'defer';
  for (const c of plan.unsafe) classes[c.assetId] = 'unsafe';
  for (const id of plan.unaffected) classes[id] = 'unaffected';
  const waveOf: Record<string, number> = {};
  for (const w of plan.waves) for (const id of w.assetIds) waveOf[id] = w.index;
  return { classes, waveOf };
}

function describe(classId: string | undefined, wave: number | undefined): string {
  const label = CLASS_LABEL[classId ?? 'unaffected'] ?? classId ?? '不受影响';
  return classId === 'purge-now' && wave !== undefined ? `${label}（波次 ${wave + 1}）` : label;
}

interface Props {
  plan: Plan;
  planHash: string;
  baseline: PlanSnapshot | null;
  apply: (action: Action) => void;
}

/** 比较前后范围：固定一个基准计划，调整策略后查看每个对象的分类/波次变化 */
export function CompareView({ plan, planHash, baseline, apply }: Props) {
  const current = useMemo(() => classificationMap(plan), [plan]);

  const movements = useMemo(() => {
    if (!baseline) return [];
    const ids = new Set([...Object.keys(baseline.classification), ...Object.keys(current.classes)]);
    const rows: Array<{ assetId: string; from: string; to: string }> = [];
    for (const id of [...ids].sort()) {
      const fromCls = baseline.classification[id] ?? 'unaffected';
      const toCls = current.classes[id] ?? 'unaffected';
      const fromWave = baseline.waveOf[id];
      const toWave = current.waveOf[id];
      if (fromCls !== toCls || fromWave !== toWave) {
        rows.push({
          assetId: id,
          from: describe(fromCls, fromWave),
          to: describe(toCls, toWave),
        });
      }
    }
    return rows;
  }, [baseline, current]);

  const pinBaseline = () => {
    apply({
      type: 'pin-baseline',
      snapshot: {
        hash: planHash,
        classification: current.classes,
        waveOf: current.waveOf,
        label: new Date().toLocaleString('zh-CN'),
      },
    });
  };

  return (
    <section className="card">
      <h3>
        范围对比
        {baseline && (
          <span className="summary">
            <span className="count">
              基准 #{baseline.hash}（{baseline.label}）
            </span>
            <span className="count">当前 #{planHash}</span>
          </span>
        )}
      </h3>
      <div className="compare-actions">
        <button onClick={pinBaseline}>固定当前为基准</button>
        {baseline && <button onClick={() => apply({ type: 'clear-baseline' })}>清除基准</button>}
      </div>
      {!baseline && <p className="hint">固定一个基准计划后，调整策略即可逐项比较失效范围的变化。</p>}
      {baseline && movements.length === 0 && (
        <p className="hint">{baseline.hash === planHash ? '与基准完全一致，范围无变化。' : '分类有细节变化，但逐项对比未发现移动。'}</p>
      )}
      {baseline && movements.length > 0 && (
        <table className="compare-table">
          <thead>
            <tr>
              <th>资源</th>
              <th>基准</th>
              <th></th>
              <th>当前</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.assetId}>
                <td>{ASSET_MAP.get(m.assetId)?.name ?? m.assetId}</td>
                <td>{m.from}</td>
                <td className="arrow">→</td>
                <td>{m.to}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
