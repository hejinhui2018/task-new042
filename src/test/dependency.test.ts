import { describe, expect, it } from 'vitest';
import { ASSETS } from '../data/scenario';
import { buildDependentsMap, reverseClosure } from '../lib/dependency';
import type { Asset } from '../types';

describe('反向依赖闭包', () => {
  it('字体变更应波及所有（传递）依赖它的样式与页面', () => {
    const closure = reverseClosure(ASSETS, ['font.brand']);
    const affected = [...closure.keys()].sort();
    expect(affected).toEqual([
      'css.base',
      'css.spring',
      'html.about',
      'html.home',
      'html.spring',
      'html.spring-promo',
    ]);
  });

  it('每个结论都能追溯到从变更源出发的依赖链', () => {
    const closure = reverseClosure(ASSETS, ['font.brand']);

    // html.spring 经由 css.spring 依赖字体
    const springChains = closure.get('html.spring');
    expect(springChains).toHaveLength(1);
    expect(springChains![0]).toEqual(['font.brand', 'css.spring', 'html.spring']);

    // html.home 直接依赖字体（最短链）
    const homeChains = closure.get('html.home');
    expect(homeChains).toHaveLength(1);
    expect(homeChains![0]).toEqual(['font.brand', 'html.home']);

    // 每条链都以变更源开头、以目标结尾
    for (const [target, chains] of closure) {
      for (const chain of chains) {
        expect(chain[0]).toBe('font.brand');
        expect(chain[chain.length - 1]).toBe(target);
      }
    }
  });

  it('多个变更源时各自记录链', () => {
    const closure = reverseClosure(ASSETS, ['css.spring', 'font.brand']);
    // html.spring 同时被两个源波及：css.spring（直接）与 font.brand（经由 css.spring）
    const chains = closure.get('html.spring')!;
    expect(chains.length).toBe(2);
    expect(chains.map((c) => c[0]).sort()).toEqual(['css.spring', 'font.brand']);
  });

  it('变更资源自身不出现在闭包结果中', () => {
    const closure = reverseClosure(ASSETS, ['css.spring']);
    expect(closure.has('css.spring')).toBe(false);
    expect([...closure.keys()].sort()).toEqual(['html.spring', 'html.spring-promo']);
  });

  it('空变更集合产生空闭包', () => {
    expect(reverseClosure(ASSETS, []).size).toBe(0);
  });

  it('循环依赖不会死循环', () => {
    const cyclic: Asset[] = [
      {
        id: 'a',
        name: 'a',
        type: 'js',
        version: '1',
        surrogateKeys: [],
        dependsOn: ['b'],
        policy: { ttlSeconds: 0, swrSeconds: 0, immutable: false },
      },
      {
        id: 'b',
        name: 'b',
        type: 'js',
        version: '1',
        surrogateKeys: [],
        dependsOn: ['a'],
        policy: { ttlSeconds: 0, swrSeconds: 0, immutable: false },
      },
    ];
    const closure = reverseClosure(cyclic, ['a']);
    expect([...closure.keys()]).toEqual(['b']);
    expect(closure.get('b')![0]).toEqual(['a', 'b']);
  });

  it('反向邻接表按字典序排序（遍历顺序确定）', () => {
    const map = buildDependentsMap(ASSETS);
    for (const list of map.values()) {
      expect([...list].sort()).toEqual(list);
    }
  });
});
