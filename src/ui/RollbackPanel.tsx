import { useMemo } from 'react';
import type { InvalidationPlan, SimState, Version } from '../domain/types';
import { buildRollbackPlan } from '../domain/rollback';
import { assetBasename } from './format';

interface Props {
  plan: InvalidationPlan;
  previousVersion: Version;
  sim: SimState | null;
  regions: readonly { id: string; name: string }[];
  /** 当前规划是否已是旧版本（即本身就是回滚发布） */
  targetingOld: boolean;
}

export function RollbackPanel({ plan, previousVersion, sim, regions, targetingOld }: Props) {
  const rb = useMemo(
    () => buildRollbackPlan(plan, previousVersion.label, regions, sim ?? undefined),
    [plan, previousVersion, sim, regions],
  );
  const urlOf = (id: string) => plan.assets.find((a) => a.assetId === id)?.url ?? id;

  return (
    <div>
      <div className="panel">
        <h2>最小回退计划 → {previousVersion.label}</h2>
        <p className="section-sub">
          {targetingOld
            ? '当前规划本身已指向旧版本：按 W1→W2 执行即等价于回滚发布。'
            : '仅把前向发布中「确实已改变」的边缘副本反向 purge；前向超时或未执行的区域仍持有旧副本，回退零操作。指纹新资源永不被旧文档引用，保留无害。'}
        </p>
        <div className="stat-row">
          <div className="stat danger">
            <div className="n">{rb.neededCount}</div>
            <div className="t">需要反向操作</div>
          </div>
          <div className="stat muted">
            <div className="n">{rb.skippedCount}</div>
            <div className="t">跳过（无需操作）</div>
          </div>
        </div>
        <p className="section-sub">
          顺序：先恢复 W2 的稳定 URL 皮肤资源，最后硬清除 W1 入口 HTML 把流量切回旧引用图。
        </p>
      </div>

      <div className="panel">
        <h2>步骤明细</h2>
        {rb.steps.map((s) => (
          <div key={`${s.order}-${s.region}-${s.assetId}`} className={`rb-step ${s.needed ? 'needed' : 'skipped'}`}>
            <div className="head">
              <span className="order">#{s.order + 1}</span>
              <span className="mono" style={{ fontSize: 12 }}>{assetBasename(urlOf(s.assetId))}</span>
              <span className="badge">{s.region}</span>
              <span className="badge">{s.fromWave}</span>
              <span className={`tag ${s.needed ? 'purge-now' : 'unsafe-keep'}`}>
                {s.needed ? '执行反向 purge' : '跳过'}
              </span>
            </div>
            <div className="reason">{s.reason}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
