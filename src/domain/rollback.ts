// ─────────────────────────────────────────────────────────────
// 最小回退计划
//
// 回退目标：把边缘流量恢复到上一版本。要点是“最小”——
//  1. 只处理前向发布中【确实已经改变】的边缘副本：
//     前向 purge 成功的 (区域×资源) 才需要反向 purge；
//     前向超时/未执行的区域仍在服务旧副本，回退时零操作。
//  2. 指纹新资源（v2 的 css/js/font/img）永不被 v1 文档引用，
//     保留在边缘无害，不回退、不清除。
//  3. 回退顺序与前向相反的安全方向：先恢复稳定 URL 的皮肤资源（W2 项），
//     最后硬清除入口 HTML（W1 项）把流量切回旧引用图。
// ─────────────────────────────────────────────────────────────
import type { InvalidationPlan, SimState } from './types';
import { executableWaves } from './simulate';

export interface RollbackStep {
  /** 回退执行顺序（0 起） */
  order: number;
  region: string;
  assetId: string;
  /** 来源前向波次标题 */
  fromWave: string;
  needed: boolean;
  reason: string;
}

export interface RollbackPlan {
  targetLabel: string;
  steps: RollbackStep[];
  neededCount: number;
  skippedCount: number;
}

export function buildRollbackPlan(
  forwardPlan: InvalidationPlan,
  previousLabel: string,
  regions: readonly { id: string; name: string }[],
  sim?: SimState,
): RollbackPlan {
  const exec = executableWaves(forwardPlan);
  const steps: RollbackStep[] = [];

  // 反向遍历前向波次：W2 先恢复，W1 最后切入口
  const plannedById = new Map(forwardPlan.assets.map((a) => [a.assetId, a]));
  for (let wi = exec.length - 1; wi >= 0; wi--) {
    const w = exec[wi];
    for (const assetId of w.assetIds) {
      const planned = plannedById.get(assetId);
      const immutable = planned?.policy === 'immutable';
      for (let ri = 0; ri < regions.length; ri++) {
        const regionName = sim?.waves[wi]?.[ri]?.name ?? regions[ri].name;
        const status = sim?.waves[wi]?.[ri]?.statuses[assetId];
        const attempt = sim?.attempts[wi]?.[ri]?.[w.assetIds.indexOf(assetId)] ?? 0;

        let needed: boolean;
        let reason: string;
        if (immutable) {
          needed = false;
          reason = `内容指纹新 URL 资源：${previousLabel} 的文档永不引用它，边缘保留无害，回退零操作`;
        } else if (!sim) {
          needed = true;
          reason = `尚无执行记录：按最坏情况处理，假设 ${regionName} 已被前向发布刷新，需反向 purge 恢复 ${previousLabel}`;
        } else if (status === 'success') {
          needed = true;
          reason =
            wi === 0
              ? `前向 W1 在 ${regionName} 已硬清除成功，该区域入口现指向新版本：必须再次 purge 入口 HTML 切回 ${previousLabel} 的引用图`
              : `前向 W2 在 ${regionName} 已把该稳定 URL 资源刷新为新版本内容：需反向刷新，避免 ${previousLabel} 入口读到新皮肤内容`;
        } else if (status === 'timeout' && attempt > 0) {
          needed = false;
          reason = `前向在 ${regionName} 超时未生效，边缘仍持有旧副本，回退零操作`;
        } else {
          needed = false;
          reason = `前向未在 ${regionName} 执行该单元，边缘仍是 ${previousLabel} 副本，跳过`;
        }

        steps.push({
          order: 0,
          region: regionName,
          assetId,
          fromWave: w.title,
          needed,
          reason,
        });
      }
    }
  }

  // 稳定排序：回退波序（W2→W1）→ 区域 → 资源
  const waveRank = new Map(exec.map((w, i) => [w.title, exec.length - 1 - i]));
  steps.sort((a, b) => {
    const wr = (waveRank.get(a.fromWave) ?? 0) - (waveRank.get(b.fromWave) ?? 0);
    if (wr !== 0) return wr;
    if (a.region !== b.region) return a.region < b.region ? -1 : 1;
    return a.assetId < b.assetId ? -1 : 1;
  });
  steps.forEach((s, i) => (s.order = i));

  return {
    targetLabel: previousLabel,
    steps,
    neededCount: steps.filter((s) => s.needed).length,
    skippedCount: steps.filter((s) => !s.needed).length,
  };
}
