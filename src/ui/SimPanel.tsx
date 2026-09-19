import type { InvalidationPlan, SimState } from '../domain/types';
import {
  applyOutcome,
  canEnterWave,
  executableWaves,
  initSim,
  isRetryable,
  runWaveAuto,
  stuckCells,
} from '../domain/simulate';
import { assetBasename } from './format';

interface Props {
  plan: InvalidationPlan;
  sim: SimState;
  setSim: (s: SimState) => void;
  maxRetries: number;
  regions: readonly { id: string; name: string }[];
}

const AUTO_SEED = 0x5eed;

export function SimPanel({ plan, sim, setSim, maxRetries, regions }: Props) {
  const exec = executableWaves(plan);
  if (sim.waves.length === 0) {
    return <div className="empty-note">当前规划没有可执行波次（可能全部对象都不能安全清除，或未选择路由）。</div>;
  }

  const reset = () => setSim(initSim(plan, regions));

  return (
    <div>
      <div className="btn-row" style={{ marginBottom: 10, justifyContent: 'space-between' }}>
        <span className="section-sub" style={{ margin: 0 }}>
          逐波模拟 5 个边缘区域的执行结果；超时可在 {maxRetries} 次预算内重试。
        </span>
        <button className="btn ghost small" onClick={reset}>重置模拟</button>
      </div>

      {sim.waves.map((waveRegions, wi) => {
        const assetIds = sim.waveAssetIds[wi];
        const allowed = canEnterWave(sim, wi, maxRetries);
        const passed = waveRegions.every((r) => assetIds.every((id) => r.statuses[id] === 'success'));
        const settled = waveRegions.every((r, ri) =>
          assetIds.every((id, ai) => {
            const s = r.statuses[id];
            return s === 'success' || (s === 'timeout' && sim.attempts[wi][ri][ai] > maxRetries);
          }),
        );
        const stuck = stuckCells(sim, wi);
        const waveDef = plan.waves.find((w) => w.title === exec[wi].title)!;

        return (
          <div key={wi} className="panel" style={{ opacity: allowed ? 1 : 0.62 }}>
            <h2>
              {waveDef.title}
              <span className="count">{assetIds.length} 对象 × {regions.length} 区域</span>
            </h2>
            <p className="section-sub">{waveDef.rationale}</p>

            {wi > 0 && !allowed && (
              <div className="gate-banner block">⛔ 波次门禁：上一波尚未在所有区域成功，本波不可开始（避免旧文档仍在边缘时先刷新下游资源）。</div>
            )}
            {passed && <div className="gate-banner go">✅ 全部区域成功{wi === 0 ? '，门禁放行下一波' : ''}。</div>}
            {!passed && settled && (
              <div className="gate-banner block">
                ❌ 本波已到终态但存在失败：{stuck.map((s) => `${s.region}/${assetBasename(plan.assets.find((a) => a.assetId === s.assetId)?.url ?? s.assetId)}`).join('、')}。
                {wi === 0 ? ' W1 失败将阻塞 W2，需立即处理或执行回退。' : ' W2 失败不阻塞发布，SWR 窗口内继续收敛。'}
              </div>
            )}
            {allowed && !settled && wi === 1 && (
              <div className="gate-banner info">ℹ️ W2 为延迟刷新：即使个别区域超时，也不阻塞发布。</div>
            )}

            <table className="grid">
              <thead>
                <tr>
                  <th>区域 ＼ 对象</th>
                  {assetIds.map((id) => (
                    <th key={id} title={id}>{assetBasename(plan.assets.find((a) => a.assetId === id)?.url ?? id)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {waveRegions.map((r, ri) => (
                  <tr key={r.id}>
                    <td className="asset-col">{r.name}</td>
                    {assetIds.map((id, ai) => {
                      const status = r.statuses[id];
                      const attempt = sim.attempts[wi][ri][ai];
                      const retryable = isRetryable(sim, wi, ri, ai, maxRetries);
                      const terminal = status === 'success' || (status === 'timeout' && attempt > maxRetries);
                      const cls =
                        status === 'success' ? 'success' : status === 'timeout' ? (retryable ? 'retryable' : 'timeout') : 'pending';
                      const stateText =
                        status === 'pending' ? '待执行' : status === 'success' ? '成功' : retryable ? `超时 ${attempt}/${maxRetries + 1}` : '已耗尽';
                      return (
                        <td key={id}>
                          <div className={`cell ${cls}`}>
                            <span className="state">{stateText}</span>
                            {allowed && !terminal && (
                              <span className="acts">
                                <button
                                  title="标记成功"
                                  onClick={() => setSim(applyOutcome(sim, wi, ri, ai, 'success', maxRetries).state)}
                                >
                                  ✓
                                </button>
                                <button
                                  title="标记超时"
                                  onClick={() => setSim(applyOutcome(sim, wi, ri, ai, 'timeout', maxRetries).state)}
                                >
                                  ×
                                </button>
                              </span>
                            )}
                            {attempt > 0 && <span className="attempts">已尝试 {attempt} 次</span>}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="btn-row" style={{ marginTop: 10 }}>
              <button
                className="btn secondary small"
                disabled={!allowed || settled}
                onClick={() => setSim(runWaveAuto(sim, wi, maxRetries, AUTO_SEED + wi * 131))}
              >
                自动模拟本波（确定性，可重放）
              </button>
            </div>
          </div>
        );
      })}

      <div className="panel">
        <h2>执行事件流 <span className="count">{sim.events.length}</span></h2>
        {sim.events.length === 0 ? (
          <div className="empty-note">还没有执行动作。</div>
        ) : (
          <div className="event-log">
            {[...sim.events].reverse().map((e) => (
              <div key={e.seq} className={`event-row ${e.outcome}`}>
                <span className="seq">#{e.seq}</span>
                <span className="mark">{e.outcome === 'success' ? '✓' : '×'}</span>
                <span className="who">{e.region} · {e.assetId}</span>
                <span className="detail">{e.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
