import { describe, expect, it } from 'vitest';
import { ASSETS, ROUTES, defaultSelection, defaultStrategy } from '../data/scenario';
import { computePlan, planHash, serializePlan } from '../lib/plan';
import type { Asset, Route, Selection } from '../types';

/** 确定性伪随机洗牌（测试自身也要可重复） */
function shuffled<T>(arr: readonly T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe('稳定输出', () => {
  const selection = defaultSelection();
  const strategy = defaultStrategy();

  it('输入数组顺序不影响序列化结果与哈希', () => {
    const base = computePlan(ROUTES, ASSETS, selection, strategy);
    for (const seed of [1, 7, 42, 2026]) {
      const plan = computePlan(
        shuffled(ROUTES, seed) as Route[],
        shuffled(ASSETS, seed) as Asset[],
        {
          routeIds: shuffled(selection.routeIds, seed),
          assetIds: shuffled(selection.assetIds, seed + 1),
        } as Selection,
        strategy,
      );
      expect(serializePlan(plan)).toBe(serializePlan(base));
      expect(planHash(plan)).toBe(planHash(base));
    }
  });

  it('同样的输入重复计算结果一致（无时间戳/随机量）', () => {
    const a = computePlan(ROUTES, ASSETS, selection, strategy);
    const b = computePlan(ROUTES, ASSETS, selection, strategy);
    expect(serializePlan(a)).toBe(serializePlan(b));
    expect(planHash(a)).toBe(planHash(b));
  });

  it('哈希为 8 位十六进制字符串', () => {
    const hash = planHash(computePlan(ROUTES, ASSETS, selection, strategy));
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('策略变化会改变哈希', () => {
    // 该选择下 css.base 因 SWR 策略不同而分类不同，计划必然变化
    const fontSelection: Selection = {
      routeIds: ['route.spring', 'route.spring-promo'],
      assetIds: ['css.spring', 'img.hero', 'font.brand'],
    };
    const base = planHash(computePlan(ROUTES, ASSETS, fontSelection, strategy));
    const other = planHash(
      computePlan(ROUTES, ASSETS, fontSelection, { ...strategy, swrHandling: 'purge' }),
    );
    expect(other).not.toBe(base);
  });

  it('选择变化会改变哈希', () => {
    const base = planHash(computePlan(ROUTES, ASSETS, selection, strategy));
    const other = planHash(
      computePlan(ROUTES, ASSETS, { ...selection, assetIds: [...selection.assetIds, 'font.brand'] }, strategy),
    );
    expect(other).not.toBe(base);
  });

  it('序列化结果中的波次与资源列表均有序', () => {
    const plan = computePlan(
      ROUTES,
      ASSETS,
      { routeIds: ['route.spring'], assetIds: ['css.spring', 'img.hero', 'font.brand'] },
      { swrHandling: 'purge', includeCrossRouteShared: true, maxRetries: 2 },
    );
    const parsed = JSON.parse(serializePlan(plan)) as {
      waves: Array<{ index: number; assets: string[] }>;
      purgeNow: Array<{ id: string }>;
    };
    expect(parsed.waves.map((w) => w.index)).toEqual(
      [...parsed.waves.map((w) => w.index)].sort((a, b) => a - b),
    );
    for (const wave of parsed.waves) {
      expect([...wave.assets].sort()).toEqual(wave.assets);
    }
    expect(parsed.purgeNow.map((c) => c.id)).toEqual(parsed.purgeNow.map((c) => c.id).sort());
  });
});
