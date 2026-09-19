import { ASSET_MAP, NODES } from '../data/scenario';
import type { Plan } from '../lib/plan';
import { cellKey, type SimState } from '../lib/simulate';
import type { StrategyConfig } from '../types';
import type { Action } from '../state/store';

const STATUS_ICON: Record<string, string> = {
  pending: '○',
  success: '✓',
  timeout: '⏱',
  failed: '✗',
};

const SIM_STATUS_LABEL: Record<string, { text: string; className: string }> = {
  idle: { text: '待执行', className: 'sim-idle' },
  running: { text: '执行中', className: 'sim-running' },
  done: { text: '全部完成', className: 'sim-done' },
  failed: { text: '存在失败节点，已停止 —— 请查看最小回退计划', className: 'sim-failed' },
};

interface Props {
  plan: Plan;
  sim: SimState;
  schedule: Record<string, number>;
  strategy: StrategyConfig;
  apply: (action: Action) => void;
}

/** 右栏：逐波模拟边缘节点的清除执行，可注入超时故障 */
export function SimulationPanel({ plan, sim, schedule, strategy, apply }: Props) {
  const lastWave = plan.waves[plan.waves.length - 1];

  const injectFaults = () => {
    if (!lastWave) return;
    apply({
      type: 'set-schedule',
      schedule: {
        [cellKey(lastWave.index, 'edge-ap-singapore')]: 2,
        [cellKey(lastWave.index, 'edge-eu-frankfurt')]: 1,
      },
    });
  };

  const status = SIM_STATUS_LABEL[sim.status];
  const recentLog = sim.log.slice(-14).reverse();

  return (
    <section className="card">
      <h3>
        执行波次模拟
        <span className={`sim-status ${status.className}`}>{status.text}</span>
      </h3>
      {plan.waves.length === 0 && <p className="hint">当前策略下没有需要立即清除的资源。</p>}
      {plan.waves.length > 0 && (
        <>
          <p className="hint">点击单元格可为该节点注入「强制超时次数」（0–{strategy.maxRetries + 1}），再次点击递增。</p>
          <table className="sim-grid">
            <thead>
              <tr>
                <th>波次</th>
                {NODES.map((n) => (
                  <th key={n.id}>
                    {n.region}·{n.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plan.waves.map((wave) => (
                <tr key={wave.index} className={wave.index === sim.currentWave && sim.status !== 'done' ? 'wave-active' : ''}>
                  <td>
                    <span className="wave-badge">波次 {wave.index + 1}</span>
                    <div className="wave-assets">
                      {wave.assetIds.map((id) => (
                        <span key={id} className="chip chip-sm">
                          {ASSET_MAP.get(id)?.name ?? id}
                        </span>
                      ))}
                    </div>
                  </td>
                  {NODES.map((node) => {
                    const key = cellKey(wave.index, node.id);
                    const cell = sim.cells[key];
                    const forced = schedule[key] ?? 0;
                    const cellStatus = cell?.status ?? 'pending';
                    return (
                      <td key={node.id}>
                        <button
                          className={`cell cell-${cellStatus}`}
                          title={`强制超时次数：${forced}（点击递增）`}
                          onClick={() =>
                            apply({ type: 'cycle-schedule', key, max: strategy.maxRetries + 1 })
                          }
                        >
                          <span className="cell-icon">{STATUS_ICON[cellStatus]}</span>
                          {cell && cell.attempts > 0 && <span className="cell-attempts">×{cell.attempts}</span>}
                          {forced > 0 && <span className="cell-forced">⏱{forced}</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sim-actions">
            <button
              disabled={sim.status === 'done' || sim.status === 'failed'}
              onClick={() => apply({ type: 'sim-run-wave', plan, nodes: NODES })}
            >
              执行下一波
            </button>
            <button
              disabled={sim.status === 'done' || sim.status === 'failed'}
              onClick={() => apply({ type: 'sim-run-all', plan, nodes: NODES })}
            >
              自动执行全部
            </button>
            <button disabled={!lastWave || sim.status === 'done'} onClick={injectFaults}>
              注入典型故障
            </button>
            <button onClick={() => apply({ type: 'sim-reset' })}>重置模拟</button>
          </div>
        </>
      )}
      {recentLog.length > 0 && (
        <ol className="sim-log">
          {recentLog.map((entry, i) => (
            <li key={`${entry.wave}-${entry.nodeId}-${entry.attempt}-${i}`} className={`log-${entry.result}`}>
              {entry.message}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
