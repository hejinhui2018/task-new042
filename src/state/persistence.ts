import type { AppState } from './store';
import { createInitialState } from './store';
import { createSimState } from '../lib/simulate';

const STORAGE_KEY = 'cache-sketch:v1';

function strArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : fallback;
}

function strRecord(value: unknown, fallback: Record<string, string>): Record<string, string> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }
  return fallback;
}

function numRecord(value: unknown): Record<string, number> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  }
  return {};
}

/** 读取并校验持久化状态；任何字段异常都回退到默认值，保证刷新后可用 */
export function loadPersisted(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; state?: Partial<AppState> };
    if (parsed?.v !== 1 || !parsed.state || typeof parsed.state !== 'object') return null;
    const base = createInitialState();
    const s = parsed.state;
    return {
      selection: {
        routeIds: strArray(s.selection?.routeIds, base.selection.routeIds),
        assetIds: strArray(s.selection?.assetIds, base.selection.assetIds),
      },
      strategy: {
        swrHandling: s.strategy?.swrHandling === 'purge' ? 'purge' : 'defer',
        includeCrossRouteShared: s.strategy?.includeCrossRouteShared === true,
        maxRetries:
          typeof s.strategy?.maxRetries === 'number' && Number.isFinite(s.strategy.maxRetries)
            ? Math.max(0, Math.min(5, Math.floor(s.strategy.maxRetries)))
            : base.strategy.maxRetries,
      },
      schedule: numRecord(s.schedule),
      sim:
        s.sim && typeof s.sim === 'object' && typeof s.sim.cells === 'object'
          ? { ...createSimState(), ...s.sim }
          : createSimState(),
      baseline:
        s.baseline && typeof s.baseline === 'object' && typeof s.baseline.hash === 'string'
          ? {
              hash: s.baseline.hash,
              classification: strRecord(s.baseline.classification, {}),
              waveOf: numRecord(s.baseline.waveOf),
              label: typeof s.baseline.label === 'string' ? s.baseline.label : '基准',
            }
          : null,
    };
  } catch {
    return null;
  }
}

export function persist(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, state }));
  } catch {
    // 隐私模式等场景下写入失败，忽略即可
  }
}

export function clearPersisted(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
}
