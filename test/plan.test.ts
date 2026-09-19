import { describe, expect, it } from 'vitest';
import { SPRING_SCENARIO } from '../src/domain/scenario';
import { buildPlan, type PlanInput } from '../src/domain/plan';
import { stableStringify } from '../src/domain/canonical';
import type { CachePolicy, DocState, RouteStrategy } from '../src/domain/types';
import { DEFAULT_GLOBAL, defaultDoc } from '../src/state/history';

const SCENARIO = SPRING_SCENARIO;
const v1 = SCENARIO.versions[0];
const v2 = SCENARIO.versions[1];

function springRoutes(): RouteStrategy[] {
  return v1.routes.map((r) => ({
    routeId: r.id,
    selected: r.id === 'r-spring' || r.id === 'r-spring-sub',
    allowStale: false,
  }));
}

function makeInput(doc: Partial<DocState> = {}): PlanInput {
  return {
    target: v2,
    allVersions: SCENARIO.versions,
    routes: doc.routes ?? springRoutes(),
    policyOverrides: doc.policyOverrides ?? {},
    global: doc.global ?? { ...DEFAULT_GLOBAL },
  };
}

function byId(plan: ReturnType<typeof buildPlan>, id: string) {
  const a = plan.assets.find((x) => x.assetId === id);
  if (!a) throw new Error(`plan 中缺少 ${id}`);
  return a;
}

describe('buildPlan 失效分类', () => {
  it('默认换肤发布：2 个入口立即清除、4 个可延迟、5 个不能安全清除', () => {
    const plan = buildPlan(makeInput());
    const counts = { now: 0, stale: 0, unsafe: 0 };
    for (const a of plan.assets) {
      if (a.conclusion === 'purge-now') counts.now++;
      if (a.conclusion === 'stale-refresh') counts.stale++;
      if (a.conclusion === 'unsafe-keep') counts.unsafe++;
    }
    expect(counts).toEqual({ now: 2, stale: 4, unsafe: 5 });
  });

  it('两个春季入口为 purge-now，理由来自 R1 且 via 指向对应路由', () => {
    const plan = buildPlan(makeInput());
    const e1 = byId(plan, 'html-spring');
    const e2 = byId(plan, 'html-spring-sub');
    expect(e1.conclusion).toBe('purge-now');
    expect(e2.conclusion).toBe('purge-now');
    expect(e1.reasons[0].rule).toBe('R1-entry-selected');
    expect(e1.reasons[0].via).toEqual(['r-spring']);
    expect(e2.reasons[0].via).toEqual(['r-spring-sub']);
  });

  it('共享字体 font-base 因 R2（未发布页面仍引用）不能清除，依据指向 css-comp-v1', () => {
    const plan = buildPlan(makeInput());
    const font = byId(plan, 'font-base');
    expect(font.conclusion).toBe('unsafe-keep');
    const r2 = font.reasons.find((r) => r.rule === 'R2-shared-by-untouched');
    expect(r2).toBeDefined();
    expect(r2!.via).toContain('css-comp-v1');
    expect(font.purgeKeys).toEqual([]);
    expect(font.remediation).toContain('保留缓存');
  });

  it('新组件包因宽 key css-components 碰撞（R3）不能按 key 清除，碰撞 key 被剔除', () => {
    const plan = buildPlan(makeInput());
    const comp = byId(plan, 'css-spring-comp-v2');
    expect(comp.conclusion).toBe('unsafe-keep');
    const r3 = comp.reasons.find((r) => r.rule === 'R3-surrogate-key-collision');
    expect(r3).toBeDefined();
    expect(r3!.via).toContain('css-comp-v1');
    expect(comp.purgeKeys).toEqual([]); // 不能产出 css-components
    expect(comp.remediation).toContain('css-components');
  });

  it('新脚本 js-app-v2 因宽 key js-app 误伤 js-app-v1（R3）不能清除', () => {
    const plan = buildPlan(makeInput());
    const js = byId(plan, 'js-app-v2');
    expect(js.conclusion).toBe('unsafe-keep');
    const r3 = js.reasons.find((r) => r.rule === 'R3-surrogate-key-collision');
    expect(r3!.via).toContain('js-app-v1');
  });

  it('旧组件包 css-comp-v1 / 旧脚本 js-app-v1 本身也在范围内且不能清除（R2）', () => {
    const plan = buildPlan(makeInput());
    expect(byId(plan, 'css-comp-v1').conclusion).toBe('unsafe-keep');
    expect(byId(plan, 'js-app-v1').conclusion).toBe('unsafe-keep');
  });

  it('皮肤 CSS 为同 URL 的 SWR 资源：可延迟刷新（R5）并携带窄 key', () => {
    const plan = buildPlan(makeInput());
    const skin = byId(plan, 'css-spring-skin');
    expect(skin.conclusion).toBe('stale-refresh');
    expect(skin.reasons.some((r) => r.rule === 'R5-stale-while-revalidate')).toBe(true);
    expect(skin.purgeKeys).toEqual(['css-spring-skin']);
  });

  it('新主视觉与新展示字体为指纹资源：无需清除（R4），同 key 旧主视觉无引用方时给出 R6 安全连带理由', () => {
    const plan = buildPlan(makeInput());
    const hero = byId(plan, 'img-hero-v2');
    const font = byId(plan, 'font-display-v2');
    expect(hero.conclusion).toBe('stale-refresh');
    expect(font.conclusion).toBe('stale-refresh');
    expect(hero.reasons.some((r) => r.rule === 'R4-fingerprinted-immutable')).toBe(true);
    expect(hero.reasons.some((r) => r.rule === 'R6-collateral-safe')).toBe(true);
  });

  it('关闭 surrogate key（逐 URL 模式）：宽 key 碰撞不再阻断，新指纹资源转为可延迟，但共享字体仍 unsafe', () => {
    const plan = buildPlan(makeInput({ global: { ...DEFAULT_GLOBAL, useSurrogateKeys: false } }));
    expect(byId(plan, 'css-spring-comp-v2').conclusion).toBe('stale-refresh');
    expect(byId(plan, 'js-app-v2').conclusion).toBe('stale-refresh');
    expect(byId(plan, 'font-base').conclusion).toBe('unsafe-keep');
    for (const a of plan.assets) expect(a.purgeKeys).toEqual([]); // 逐 URL
    // 入口与皮肤 CSS 需要逐 URL purge；指纹新资源不 purge
    expect(byId(plan, 'html-spring').purgeUrls).toEqual(['https://cdn.example.com/spring/index.html']);
    expect(byId(plan, 'css-spring-skin').purgeUrls).toHaveLength(1);
    expect(byId(plan, 'js-app-v2').purgeUrls).toEqual([]); // immutable
    expect(plan.allPurgeUrls).toContain('https://cdn.example.com/spring/index.html');
    expect(plan.allPurgeUrls).not.toContain('https://cdn.example.com/static/app-v2.js');
  });

  it('immutable 指纹资源即使在按 key 模式下也不产出 purge key（R4：无需主动清除）', () => {
    const plan = buildPlan(makeInput());
    expect(byId(plan, 'font-display-v2').purgeKeys).toEqual([]);
    expect(byId(plan, 'img-hero-v2').purgeKeys).toEqual([]);
    expect(byId(plan, 'css-spring-comp-v2').purgeKeys).toEqual([]); // unsafe
    // 皮肤 SWR 资源正常产出窄 key
    expect(byId(plan, 'css-spring-skin').purgeKeys).toEqual(['css-spring-skin']);
  });

  it('路由允许软失效时，该入口降级为 stale-refresh', () => {
    const routes = springRoutes().map((r) =>
      r.routeId === 'r-spring' ? { ...r, allowStale: true } : r,
    );
    const plan = buildPlan(makeInput({ routes }));
    expect(byId(plan, 'html-spring').conclusion).toBe('stale-refresh');
    expect(byId(plan, 'html-spring-sub').conclusion).toBe('purge-now');
  });

  it('SWR 容忍窗口为 0 时，皮肤 CSS 升级为立即清除', () => {
    const plan = buildPlan(makeInput({ global: { ...DEFAULT_GLOBAL, staleToleranceSec: 0 } }));
    expect(byId(plan, 'css-spring-skin').conclusion).toBe('purge-now');
  });

  it('四个路由全部发布时没有共享受害者：unsafe-keep 为 0', () => {
    const routes: RouteStrategy[] = v1.routes.map((r) => ({ routeId: r.id, selected: true, allowStale: false }));
    const plan = buildPlan(makeInput({ routes }));
    expect(plan.assets.every((a) => a.conclusion !== 'unsafe-keep')).toBe(true);
    // 旧资源也在闭包内，得到显式结论而非被漏掉
    expect(byId(plan, 'css-comp-v1').conclusion).toBe('stale-refresh');
  });

  it('手动覆盖策略为 no-cache 时，不可变指纹资源升级为立即清除', () => {
    const overrides: Record<string, CachePolicy> = { 'js-app-v2': 'no-cache' };
    // js-app-v2 默认因 R3 unsafe，先关 key 碰撞再观察策略升级
    const plan = buildPlan(
      makeInput({ policyOverrides: overrides, global: { ...DEFAULT_GLOBAL, useSurrogateKeys: false } }),
    );
    expect(byId(plan, 'js-app-v2').conclusion).toBe('purge-now');
  });

  it('每个结论都附带来自依赖的理由链（不能只列文件名）', () => {
    const plan = buildPlan(makeInput());
    for (const a of plan.assets) {
      expect(a.reasons.length).toBeGreaterThan(0);
      for (const r of a.reasons) {
        expect(r.text.length).toBeGreaterThan(10);
        expect(['R1-entry-selected', 'R2-shared-by-untouched', 'R3-surrogate-key-collision', 'R4-fingerprinted-immutable', 'R5-stale-while-revalidate', 'R6-collateral-safe']).toContain(r.rule);
      }
    }
  });

  it('稳定输出：相同输入两次计算结果逐字节一致；路由选择顺序不影响结果', () => {
    const a = buildPlan(makeInput());
    const b = buildPlan(makeInput());
    expect(stableStringify(a)).toBe(stableStringify(b));
    const reversedRoutes = [...springRoutes()].reverse();
    const c = buildPlan(makeInput({ routes: reversedRoutes }));
    expect(stableStringify(c)).toBe(stableStringify(a));
  });
});

describe('buildPlan 波次', () => {
  it('波次顺序固定为 W1 立即清除 → W2 延迟刷新 → W3 不操作，资源 id 有序', () => {
    const plan = buildPlan(makeInput());
    expect(plan.waves.map((w) => w.title)).toEqual([
      'W1 · 立即清除',
      'W2 · 延迟刷新',
      'W3 · 不操作（不能安全清除）',
    ]);
    expect(plan.waves[0].assetIds).toEqual(['html-spring', 'html-spring-sub']);
    expect(plan.waves[1].assetIds).toEqual(['css-spring-skin', 'font-display-v2', 'img-hero-v1', 'img-hero-v2']);
    expect(plan.waves[2].assetIds).toEqual([
      'css-comp-v1',
      'css-spring-comp-v2',
      'font-base',
      'js-app-v1',
      'js-app-v2',
    ]);
    for (const w of plan.waves) {
      expect(w.rationale.length).toBeGreaterThan(10);
      expect(w.assetIds).toEqual([...w.assetIds].sort());
    }
  });

  it('SWR 窗口为 0 时皮肤 CSS 进入 W1，波次成员随之变化', () => {
    const plan = buildPlan(makeInput({ global: { ...DEFAULT_GLOBAL, staleToleranceSec: 0 } }));
    expect(plan.waves[0].assetIds).toContain('css-spring-skin');
    expect(plan.waves[1].assetIds).not.toContain('css-spring-skin');
  });

  it('W3 波次不产出任何可 purge key；allPurgeKeys 有序且不含碰撞 key', () => {
    const plan = buildPlan(makeInput());
    expect(plan.waves[2].purgeKeys).toEqual([]);
    expect(plan.allPurgeKeys).toEqual([...plan.allPurgeKeys].sort());
    expect(plan.allPurgeKeys).not.toContain('css-components');
    expect(plan.allPurgeKeys).not.toContain('js-app');
    expect(plan.allPurgeKeys).toContain('route-spring');
  });
});

describe('defaultDoc 场景默认值', () => {
  it('默认指向 v2 且选中两个春季路由', () => {
    const doc = defaultDoc();
    expect(doc.versionId).toBe('v2');
    expect(doc.routes.find((r) => r.routeId === 'r-spring')?.selected).toBe(true);
    expect(doc.routes.find((r) => r.routeId === 'r-home')?.selected).toBe(false);
  });
});
