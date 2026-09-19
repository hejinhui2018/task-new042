import { describe, expect, it } from 'vitest';
import { ASSETS, ROUTES, defaultSelection, defaultStrategy } from '../data/scenario';
import { computePlan, type Plan } from '../lib/plan';
import type { Selection, StrategyConfig } from '../types';

const ids = (list: Array<{ assetId: string }>) => list.map((c) => c.assetId).sort();

function planWith(selection: Selection, strategy: StrategyConfig = defaultStrategy()): Plan {
  return computePlan(ROUTES, ASSETS, selection, strategy);
}

function waveOf(plan: Plan, assetId: string): number {
  for (const wave of plan.waves) {
    if (wave.assetIds.includes(assetId)) return wave.index;
  }
  return -1;
}

/** 完整换肤发布 + 变更跨路由共享字体 */
const FONT_SELECTION: Selection = {
  routeIds: ['route.spring', 'route.spring-promo'],
  assetIds: ['css.spring', 'img.hero', 'font.brand'],
};

describe('失效范围分类', () => {
  it('默认换肤场景：完整发布的对象全部立即清除', () => {
    const plan = planWith(defaultSelection());
    expect(ids(plan.purgeNow)).toEqual(['css.spring', 'html.spring', 'html.spring-promo', 'img.hero']);
    expect(plan.defer).toEqual([]);
    expect(plan.unsafe).toEqual([]);
    // 每个资源都被恰好分类一次
    const all = [...ids(plan.purgeNow), ...ids(plan.defer), ...ids(plan.unsafe), ...plan.unaffected];
    expect(all.sort()).toEqual(ASSETS.map((a) => a.id).sort());
  });

  it('每个结论都附带至少一条可追溯的依据', () => {
    const plan = planWith(FONT_SELECTION);
    for (const c of [...plan.purgeNow, ...plan.defer, ...plan.unsafe]) {
      expect(c.reasons.length).toBeGreaterThan(0);
      for (const reason of c.reasons) {
        expect(reason.message.length).toBeGreaterThan(0);
      }
    }
    // 延迟刷新的共享样式必须能追溯到依赖链
    const base = plan.defer.find((c) => c.assetId === 'css.base')!;
    const depReason = base.reasons.find((r) => r.rule === 'depends-on-changed');
    expect(depReason?.chain).toEqual(['font.brand', 'css.base']);
    expect(base.reasons.some((r) => r.rule === 'swr-defer')).toBe(true);
  });

  it('跨路由共享字体变更：默认策略下不能安全清除', () => {
    const plan = planWith(FONT_SELECTION);
    // 字体本身仍被首页/品牌页引用 → 不能安全清除；两个页面的 HTML 同理
    expect(ids(plan.unsafe)).toEqual(['font.brand', 'html.about', 'html.home']);
    const font = plan.unsafe.find((c) => c.assetId === 'font.brand')!;
    const cross = font.reasons.find((r) => r.rule === 'cross-route-shared');
    expect(cross?.routes).toEqual(['route.about', 'route.home']);
    // 带 SWR 的共享样式 → 延迟刷新
    expect(ids(plan.defer)).toEqual(['css.base']);
    // 改动范围内的对象 → 立即清除
    expect(ids(plan.purgeNow)).toEqual(['css.spring', 'html.spring', 'html.spring-promo', 'img.hero']);
  });

  it('允许清除跨路由共享资源后，字体进入立即清除', () => {
    const plan = planWith(FONT_SELECTION, {
      swrHandling: 'defer',
      includeCrossRouteShared: true,
      maxRetries: 2,
    });
    expect(ids(plan.purgeNow)).toContain('font.brand');
    expect(ids(plan.unsafe)).toEqual([]);
  });

  it('SWR 策略改为立即清除：共享样式变为不能安全清除，允许跨路由后变为立即清除', () => {
    const strict = planWith(FONT_SELECTION, {
      swrHandling: 'purge',
      includeCrossRouteShared: false,
      maxRetries: 2,
    });
    expect(ids(strict.defer)).toEqual([]);
    expect(ids(strict.unsafe)).toContain('css.base');

    const allowed = planWith(FONT_SELECTION, {
      swrHandling: 'purge',
      includeCrossRouteShared: true,
      maxRetries: 2,
    });
    expect(ids(allowed.purgeNow)).toContain('css.base');
    expect(ids(allowed.unsafe)).toEqual([]);
  });

  it('只选一个春季路由时，共享的皮肤 CSS 不能安全清除', () => {
    const plan = planWith({ routeIds: ['route.spring'], assetIds: ['css.spring', 'img.hero'] });
    // css.spring 仍被未选中的促销子页引用
    expect(ids(plan.unsafe)).toEqual(['css.spring']);
    const css = plan.unsafe[0];
    const cross = css.reasons.find((r) => r.rule === 'cross-route-shared');
    expect(cross?.routes).toEqual(['route.spring-promo']);
    // 子页 HTML 带 SWR → 延迟刷新
    expect(ids(plan.defer)).toEqual(['html.spring-promo']);
  });

  it('immutable 资源不能安全清除', () => {
    const plan = planWith({ routeIds: [], assetIds: ['img.logo'] });
    expect(ids(plan.unsafe)).toEqual(['img.logo']);
    const logo = plan.unsafe[0];
    expect(logo.reasons.some((r) => r.rule === 'immutable')).toBe(true);
  });

  it('surrogate key 连带：共享 components:core 的样式被同批波及', () => {
    const plan = planWith({ routeIds: [], assetIds: ['js.components'] });
    const base = plan.defer.find((c) => c.assetId === 'css.base');
    expect(base).toBeDefined();
    const keyReason = base!.reasons.find((r) => r.rule === 'surrogate-key');
    expect(keyReason?.key).toBe('components:core');
    expect(keyReason?.message).toContain('js.components');
  });
});

describe('波次顺序', () => {
  it('依赖方在前、被依赖的共享资源在后', () => {
    const plan = planWith(FONT_SELECTION, {
      swrHandling: 'defer',
      includeCrossRouteShared: true,
      maxRetries: 2,
    });
    // 入口 HTML 在波次 1，样式/图片在波次 2，字体在最末波次
    expect(waveOf(plan, 'html.spring')).toBeLessThan(waveOf(plan, 'css.spring'));
    expect(waveOf(plan, 'css.spring')).toBeLessThan(waveOf(plan, 'font.brand'));
    expect(waveOf(plan, 'html.spring')).toBe(0);
    expect(waveOf(plan, 'font.brand')).toBe(2);
  });

  it('默认场景：入口第一波，样式与图片第二波', () => {
    const plan = planWith(defaultSelection());
    expect(plan.waves).toEqual([
      { index: 0, assetIds: ['html.spring', 'html.spring-promo'] },
      { index: 1, assetIds: ['css.spring', 'img.hero'] },
    ]);
  });

  it('同一波内按资源 id 字典序排序', () => {
    const plan = planWith(FONT_SELECTION, {
      swrHandling: 'defer',
      includeCrossRouteShared: true,
      maxRetries: 2,
    });
    for (const wave of plan.waves) {
      expect([...wave.assetIds].sort()).toEqual(wave.assetIds);
    }
  });

  it('无立即清除资源时不产生波次', () => {
    const plan = planWith({ routeIds: [], assetIds: ['js.components'] });
    expect(plan.waves).toEqual([]);
  });
});
