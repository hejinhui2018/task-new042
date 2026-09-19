import type { Asset, EdgeNode } from '../types';
import type { Plan } from './plan';

/** 单个（波次 × 节点）清除单元的状态 */
export type CellStatus = 'pending' | 'success' | 'timeout' | 'failed';

export interface SimCell {
  status: CellStatus;
  /** 已尝试次数（首次尝试 + 重试） */
  attempts: number;
}

export type SimStatus = 'idle' | 'running' | 'done' | 'failed';

export interface SimLogEntry {
  wave: number;
  nodeId: string;
  nodeName: string;
  result: 'success' | 'timeout' | 'failed';
  attempt: number;
  message: string;
}

/** 模拟执行状态（纯数据，可序列化、可持久化） */
export interface SimState {
  /** key 为 cellKey(waveIndex, nodeId) */
  cells: Record<string, SimCell>;
  /** 当前待执行的波次下标 */
  currentWave: number;
  status: SimStatus;
  log: SimLogEntry[];
}

export function cellKey(waveIndex: number, nodeId: string): string {
  return `${waveIndex}::${nodeId}`;
}

export function createSimState(): SimState {
  return { cells: {}, currentWave: 0, status: 'idle', log: [] };
}

/**
 * 执行当前波次：对每个尚未成功的节点尝试一次清除。
 *
 * - schedule[key] = 该单元在成功前会强制超时的次数（用户注入的故障）；
 * - 一次尝试超时后，若 attempts 已超过 maxRetries（首次 + maxRetries 次重试
 *   全部超时），该单元标记为 failed，整个模拟进入 failed 状态并停在当前波次；
 * - 波次内全部节点成功后才推进到下一波；后续波次的单元在到达前不会被触碰。
 *
 * 纯函数：不修改入参，返回新状态。
 */
export function runWave(
  sim: SimState,
  plan: Plan,
  nodes: readonly EdgeNode[],
  schedule: Record<string, number>,
  maxRetries: number,
): SimState {
  if (sim.status === 'done' || sim.status === 'failed') return sim;
  const wave = plan.waves[sim.currentWave];
  if (!wave) return { ...sim, status: 'done' };

  const cells: Record<string, SimCell> = { ...sim.cells };
  const log = [...sim.log];

  for (const node of nodes) {
    const key = cellKey(wave.index, node.id);
    const prev = cells[key] ?? { status: 'pending' as CellStatus, attempts: 0 };
    if (prev.status === 'success' || prev.status === 'failed') continue;

    const attempts = prev.attempts + 1;
    const forcedTimeouts = schedule[key] ?? 0;

    if (attempts <= forcedTimeouts) {
      if (attempts > maxRetries) {
        cells[key] = { status: 'failed', attempts };
        log.push({
          wave: wave.index,
          nodeId: node.id,
          nodeName: node.name,
          result: 'failed',
          attempt: attempts,
          message: `波次 ${wave.index + 1} · ${node.region}·${node.name}：第 ${attempts} 次尝试仍超时，重试耗尽，标记失败`,
        });
      } else {
        cells[key] = { status: 'timeout', attempts };
        log.push({
          wave: wave.index,
          nodeId: node.id,
          nodeName: node.name,
          result: 'timeout',
          attempt: attempts,
          message: `波次 ${wave.index + 1} · ${node.region}·${node.name}：第 ${attempts} 次尝试超时，等待重试`,
        });
      }
    } else {
      cells[key] = { status: 'success', attempts };
      log.push({
        wave: wave.index,
        nodeId: node.id,
        nodeName: node.name,
        result: 'success',
        attempt: attempts,
        message: `波次 ${wave.index + 1} · ${node.region}·${node.name}：清除成功（第 ${attempts} 次尝试）`,
      });
    }
  }

  const waveCells = nodes.map((n) => cells[cellKey(wave.index, n.id)]);
  const anyFailed = waveCells.some((c) => c?.status === 'failed');
  const allSuccess = waveCells.every((c) => c?.status === 'success');

  let currentWave = sim.currentWave;
  let status: SimStatus = 'running';
  if (anyFailed) {
    status = 'failed';
  } else if (allSuccess) {
    currentWave = sim.currentWave + 1;
    status = currentWave >= plan.waves.length ? 'done' : 'running';
  }
  return { cells, currentWave, status, log };
}

/** 连续执行直到完成或失败（用于「自动执行全部」与测试） */
export function runAllWaves(
  sim: SimState,
  plan: Plan,
  nodes: readonly EdgeNode[],
  schedule: Record<string, number>,
  maxRetries: number,
): SimState {
  let current = sim;
  for (let guard = 0; guard < 1000; guard++) {
    if (current.status === 'done' || current.status === 'failed') break;
    const next = runWave(current, plan, nodes, schedule, maxRetries);
    if (next === current) break;
    current = next;
  }
  return current;
}

/** 回退计划中的一步：把某个资源在指定节点回滚到上一版本并重新清除 */
export interface RollbackStep {
  wave: number;
  assetId: string;
  toVersion: string;
  /** 仅包含该资源已清除成功的节点（最小集合） */
  nodeIds: string[];
}

export interface RollbackPlan {
  steps: RollbackStep[];
  /** 已清除但没有可回滚版本的资源，无法自动回退 */
  unrecoverable: Array<{ assetId: string; nodeIds: string[]; reason: string }>;
}

/**
 * 最小回退计划：
 * - 只包含「已在至少一个节点清除成功」的资源 —— 未执行的波次无需回退；
 * - 每个资源只列出清除成功的节点 —— 失败/未触碰的节点无需处理；
 * - 顺序沿用原波次（依赖方先回滚、共享资源后回滚），保证边缘节点
 *   在收敛过程中不会缓存到「新引用指向旧资源」的中间态；
 * - 没有 rollbackVersion 的资源列入 unrecoverable，需人工介入。
 */
export function computeRollback(
  plan: Plan,
  sim: SimState,
  assets: readonly Asset[],
  nodes: readonly EdgeNode[],
): RollbackPlan {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const steps: RollbackStep[] = [];
  const unrecoverable: RollbackPlan['unrecoverable'] = [];

  for (const wave of plan.waves) {
    for (const assetId of wave.assetIds) {
      const okNodes = nodes
        .filter((n) => sim.cells[cellKey(wave.index, n.id)]?.status === 'success')
        .map((n) => n.id);
      if (okNodes.length === 0) continue;
      const asset = byId.get(assetId);
      if (asset?.rollbackVersion) {
        steps.push({ wave: wave.index, assetId, toVersion: asset.rollbackVersion, nodeIds: okNodes });
      } else {
        unrecoverable.push({
          assetId,
          nodeIds: okNodes,
          reason: '该资源没有可回滚版本，需要人工重新发布旧版本',
        });
      }
    }
  }

  steps.sort((a, b) => a.wave - b.wave || a.assetId.localeCompare(b.assetId));
  return { steps, unrecoverable };
}
