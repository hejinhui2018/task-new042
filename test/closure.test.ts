import { describe, expect, it } from 'vitest';
import { SPRING_SCENARIO } from '../src/domain/scenario';
import { dependencyClosure, edgeUniverse, indexAssets } from '../src/domain/graph';

const v1 = SPRING_SCENARIO.versions[0];
const v2 = SPRING_SCENARIO.versions[1];

describe('dependencyClosure 依赖闭包', () => {
  it('从春季两个入口出发得到传递闭包（含字体/图片等间接依赖）', () => {
    const closure = dependencyClosure(v2, ['html-spring', 'html-spring-sub']);
    expect(closure).toEqual(
      [
        'css-spring-comp-v2',
        'css-spring-skin',
        'font-base',
        'font-display-v2',
        'html-spring',
        'html-spring-sub',
        'img-hero-v2',
        'js-app-v2',
      ].sort(),
    );
  });

  it('包含跨多跳的间接依赖：组件 CSS → font-base', () => {
    const closure = new Set(dependencyClosure(v2, ['html-spring']));
    expect(closure.has('font-base')).toBe(true); // html → css-spring-comp-v2 → font-base
  });

  it('输出与种子顺序无关且已排序（稳定输出）', () => {
    const a = dependencyClosure(v2, ['html-spring-sub', 'html-spring']);
    const b = dependencyClosure(v2, ['html-spring', 'html-spring-sub']);
    expect(a).toEqual(b);
    expect(a).toEqual([...a].sort());
  });

  it('未发布页面闭包包含其仍引用的旧资源', () => {
    const untouched = new Set(dependencyClosure(v2, ['html-home', 'html-promo']));
    expect(untouched).toContain('css-comp-v1');
    expect(untouched).toContain('js-app-v1');
    expect(untouched).toContain('font-base');
    expect(untouched).not.toContain('js-app-v2');
  });

  it('edgeUniverse 合并新旧版本同 id 对象并按 id 排序', () => {
    const edge = edgeUniverse([v1, v2]);
    const ids = edge.map((a) => a.id);
    expect(ids).toEqual([...ids].sort());
    // v2 的 html-spring 引用新指纹资源
    expect(edge.find((a) => a.id === 'html-spring')?.refs).toContain('js-app-v2');
  });

  it('反向边正确记录共享字体的引用方', () => {
    const idx = indexAssets(v2.assets);
    expect(idx.referrers.get('font-base')?.sort()).toEqual(['css-comp-v1', 'css-spring-comp-v2']);
  });
});
