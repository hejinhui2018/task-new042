import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { App } from '../src/App';

describe('App 冒烟渲染', () => {
  it('默认文档下整页可无异常渲染，并包含三类结论与关键对象', () => {
    // node 环境无 localStorage：loadDoc/loadSim 的 try/catch 会回落到默认值
    const html = renderToString(React.createElement(App));
    expect(html).toContain('CacheSketch');
    expect(html).toContain('春季活动页换肤');
    expect(html).toContain('必须立即清除');
    expect(html).toContain('可延迟刷新');
    expect(html).toContain('不能安全清除');
    // 共享字体与碰撞组件必须出现，且带着规则依据
    expect(html).toContain('font-base');
    expect(html).toContain('css-spring-comp-v2');
    expect(html).toContain('R2-shared-by-untouched');
    expect(html).toContain('R3-surrogate-key-collision');
    // 皮肤资源
    expect(html).toContain('spring-skin.css');
  });
});
