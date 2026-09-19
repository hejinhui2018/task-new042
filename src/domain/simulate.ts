// ─────────────────────────────────────────────────────────────
// 边缘节点执行模拟（纯函数、确定性）
//
// 规则：
//  - 每个 波次 × 区域 × 资源 是一个可观察执行单元
//  - 超时可重试，attempt 从 1 开始；attempt > maxRetries 后为终态 timeout
//  - W1（立即清除）必须所有区域成功才能放行 W2
//  - W2（延迟刷新）即使有超时也不阻塞发布（SWR 窗口内继续收敛）
//  - W3（unsafe-keep）没有执行动作
// 结果由可注入 outcome 决定；自动模式使用确定性伪随机，可重放、可测试。
// ─────────────────────────────────────────────────────────────
import type { InvalidationPlan, RegionState, SimEvent, SimState } from './types';

interface RegionDef {
  id: string;
  name: string;
}

/** 可执行波次：有资源且不是 W3（unsafe-keep 不执行 purge） */
export function executableWaves(
  plan: InvalidationPlan,
): { index: number; title: string; assetIds: string[] }[] {
  return plan.waves
    .filter((w) => !w.title.startsWith('W3'))
    .map((w) => ({ index: w.index, title: w.title, assetIds: w.assetIds }));
}

export function initSim(plan: InvalidationPlan, regions: readonly RegionDef[]): SimState {
  const exec = executableWaves(plan);
  return {
    waves: exec.map((w) =>
      regions.map<RegionState>((r) => ({
        id: r.id,
        name: r.name,
        statuses: Object.fromEntries(w.assetIds.map((id) => [id, 'pending' as const])),
      })),
    ),
    waveAssetIds: exec.map((w) => w.assetIds),
    attempts: exec.map((w) => regions.map(() => w.assetIds.map(() => 0))),
    events: [],
    finished: false,
  };
}

export type Outcome = 'success' | 'timeout';

/** mulberry32 确定性伪随机：相同 seed 永远得到相同序列 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 每个 (波,区域,资源) 单元的稳定 seed，与点击顺序无关 */
export function cellSeed(wave: number, regionIndex: number, assetIndex: number): number {
  return (wave * 1_000_003 + regionIndex * 9_176 + assetIndex * 37 + 11) >>> 0;
}

function isTerminalStatus(status: string, attempt: number, maxRetries: number): boolean {
  return status === 'success' || (status === 'timeout' && attempt > maxRetries);
}

function isWaveSettled(state: SimState, wave: number, maxRetries: number): boolean {
  return state.waves[wave].every((r, ri) =>
    state.waveAssetIds[wave].every(
      (id, ai) => isTerminalStatus(r.statuses[id], state.attempts[wave][ri][ai], maxRetries),
    ),
  );
}

function isWavePassed(state: SimState, wave: number): boolean {
  return state.waves[wave].every((r) =>
    state.waveAssetIds[wave].every((id) => r.statuses[id] === 'success'),
  );
}

/** 重试预算内的 timeout 仍可继续重试；超过预算才是终态 */
export function isRetryable(
  state: SimState,
  wave: number,
  regionIndex: number,
  assetIndex: number,
  maxRetries: number,
): boolean {
  const id = state.waveAssetIds[wave][assetIndex];
  return (
    state.waves[wave][regionIndex].statuses[id] === 'timeout' &&
    state.attempts[wave][regionIndex][assetIndex] <= maxRetries
  );
}

export interface ApplyResult {
  state: SimState;
  waveSettled: boolean;
  wavePassed: boolean;
}

/**
 * 对单个执行单元施加结果。纯函数：返回新 state。
 * 已成功的单元不可再改变（需要重置请重建模拟）。
 */
export function applyOutcome(
  state: SimState,
  wave: number,
  regionIndex: number,
  assetIndex: number,
  outcome: Outcome,
  maxRetries: number,
): ApplyResult {
  const assetId = state.waveAssetIds[wave][assetIndex];
  const currentStatus = state.waves[wave][regionIndex].statuses[assetId];
  const currentAttempt = state.attempts[wave][regionIndex][assetIndex];
  // 已到终态（成功或重试耗尽）的单元不可再改变，需要重置请重建模拟
  if (isTerminalStatus(currentStatus, currentAttempt, maxRetries)) {
    return { state, waveSettled: isWaveSettled(state, wave, maxRetries), wavePassed: isWavePassed(state, wave) };
  }

  const waves = state.waves.map((rs) => rs.map((r) => ({ ...r, statuses: { ...r.statuses } })));
  const attempts = state.attempts.map((rs) => rs.map((row) => [...row]));
  const events = [...state.events];

  attempts[wave][regionIndex][assetIndex] += 1;
  const attempt = attempts[wave][regionIndex][assetIndex];
  waves[wave][regionIndex].statuses[assetId] = outcome;

  const detail =
    outcome === 'success'
      ? attempt === 1
        ? '第 1 次请求即成功，边缘副本已刷新'
        : `第 ${attempt} 次重试成功，边缘副本已刷新`
      : attempt > maxRetries
        ? `第 ${attempt} 次仍超时，超过最大重试 ${maxRetries} 次，标记为待人工处理`
        : `第 ${attempt} 次请求超时，可重试（预算剩余 ${maxRetries - attempt + 1} 次）`;

  events.push({
    seq: events.length ? events[events.length - 1].seq + 1 : 1,
    region: waves[wave][regionIndex].name,
    assetId,
    attempt,
    outcome,
    detail,
  });

  const finished = state.waves.every((_, wi) => isWaveSettled({ ...state, waves, attempts }, wi, maxRetries));
  const next: SimState = { ...state, waves, attempts, events, finished };
  return { state: next, waveSettled: isWaveSettled(next, wave, maxRetries), wavePassed: isWavePassed(next, wave) };
}

/** 波次门禁：上一波未全部成功时不可进入下一波（W2 自身不阻塞后续） */
export function canEnterWave(state: SimState, wave: number, maxRetries: number): boolean {
  if (wave === 0) return true;
  const prev = wave - 1;
  // 上一波必须全部到达终态且全部成功
  return isWaveSettled(state, prev, maxRetries) && isWavePassed(state, prev);
}

/**
 * 自动模拟一整波：对每个非终态单元按确定性 RNG 落结果，
 * 超时在重试预算内自动重试，直到全部终态。
 */
export function runWaveAuto(state: SimState, wave: number, maxRetries: number, seed: number): SimState {
  const rng = makeRng(seed);
  let current = state;
  for (;;) {
    let acted = false;
    for (let ri = 0; ri < current.waves[wave].length; ri++) {
      for (let ai = 0; ai < current.waveAssetIds[wave].length; ai++) {
        const id = current.waveAssetIds[wave][ai];
        const status = current.waves[wave][ri].statuses[id];
        const attempt = current.attempts[wave][ri][ai];
        const terminal = isTerminalStatus(status, attempt, maxRetries);
        if (terminal) continue;
        // 每次尝试独立掷骰；重试时失败率降低（模拟退避后链路恢复）
        const failProb = attempt === 0 ? 0.35 : 0.12;
        const outcome: Outcome = rng() < failProb ? 'timeout' : 'success';
        current = applyOutcome(current, wave, ri, ai, outcome, maxRetries).state;
        acted = true;
      }
    }
    if (!acted || isWaveSettled(current, wave, maxRetries)) break;
  }
  return current;
}

/** 该波超时终态（重试耗尽）的单元 */
export function stuckCells(state: SimState, wave: number): { region: string; assetId: string }[] {
  const out: { region: string; assetId: string }[] = [];
  for (const r of state.waves[wave]) {
    for (const id of state.waveAssetIds[wave]) {
      if (r.statuses[id] === 'timeout') out.push({ region: r.name, assetId: id });
    }
  }
  return out;
}

export type { SimEvent };
