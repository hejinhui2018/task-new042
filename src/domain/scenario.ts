// ─────────────────────────────────────────────────────────────
// 内置场景：春季活动页换肤
//
// 背景：运营要给 /spring 主会场与分会场换肤。新皮肤使用了新的组件包、
// 新脚本与新展示字体（均为内容指纹新 URL），而首页 / 与常规促销页
// /promo 本次不发布，仍引用旧组件包与旧脚本。
//
// 历史上给新旧两代资源打过同一个“宽” surrogate key
// （css-components / js-app / img-hero），按 key 批量 purge 会误伤
// 未发布页面仍在使用的旧指纹资源——这正是“不能安全清除”的来源。
// 字体 font-base 跨所有路由共享，内容不变，验证“不要乱动共享对象”。
// ─────────────────────────────────────────────────────────────
import type { Scenario } from './types';

export const SPRING_SCENARIO: Scenario = {
  id: 'spring-skin',
  name: '春季活动页换肤',
  description:
    '/spring 主会场与分会场换肤：跨路由共享基础字体，新旧组件包/脚本通过宽 surrogate key 重叠，需区分立即清除、延迟刷新与不能安全清除的对象，并可在 v1/v2 间回滚。',
  versions: [
    {
      id: 'v1',
      label: 'v1 · 当前线上',
      routes: [
        { id: 'r-home', path: '/', name: '首页', entryId: 'html-home' },
        { id: 'r-spring', path: '/spring/', name: '春季主会场', entryId: 'html-spring' },
        { id: 'r-spring-sub', path: '/spring/sub.html', name: '春季分会场', entryId: 'html-spring-sub' },
        { id: 'r-promo', path: '/promo/', name: '常规促销页', entryId: 'html-promo' },
      ],
      assets: [
        {
          id: 'html-home',
          url: 'https://cdn.example.com/index.html',
          kind: 'html',
          keys: ['html-home'],
          policy: 'no-cache',
          refs: ['css-comp-v1', 'js-app-v1'],
          note: '首页入口，本次不发布',
        },
        {
          id: 'html-spring',
          url: 'https://cdn.example.com/spring/index.html',
          kind: 'html',
          keys: ['html-spring', 'route-spring'],
          policy: 'no-cache',
          refs: ['css-spring-skin', 'css-comp-v1', 'js-app-v1'],
        },
        {
          id: 'html-spring-sub',
          url: 'https://cdn.example.com/spring/sub.html',
          kind: 'html',
          keys: ['html-spring-sub', 'route-spring'],
          policy: 'no-cache',
          refs: ['css-spring-skin', 'css-comp-v1', 'js-app-v1'],
        },
        {
          id: 'html-promo',
          url: 'https://cdn.example.com/promo/index.html',
          kind: 'html',
          keys: ['html-promo'],
          policy: 'no-cache',
          refs: ['css-comp-v1', 'js-app-v1'],
          note: '常规促销页，本次不发布',
        },
        {
          id: 'css-comp-v1',
          url: 'https://cdn.example.com/static/comp-v1.css',
          kind: 'css',
          keys: ['css-components'],
          policy: 'srl',
          refs: ['font-base'],
          note: '跨路由共享的旧组件样式（宽 key: css-components）',
        },
        {
          id: 'css-spring-skin',
          url: 'https://cdn.example.com/static/spring-skin.css',
          kind: 'css',
          keys: ['css-spring-skin'],
          policy: 'srl',
          refs: ['font-display-v1', 'img-hero-v1'],
          note: '皮肤样式（稳定 URL，内容随换肤更新，SWR）',
        },
        {
          id: 'js-app-v1',
          url: 'https://cdn.example.com/static/app-v1.js',
          kind: 'js',
          keys: ['js-app'],
          policy: 'immutable',
          refs: [],
          note: '旧脚本（宽 key: js-app），首页与促销页仍引用',
        },
        {
          id: 'font-base',
          url: 'https://cdn.example.com/static/fonts/base-v1.woff2',
          kind: 'font',
          keys: ['font-base'],
          policy: 'immutable',
          refs: [],
          note: '跨路由共享基础字体，所有页面通用，内容不变',
        },
        {
          id: 'font-display-v1',
          url: 'https://cdn.example.com/static/fonts/display-v1.woff2',
          kind: 'font',
          keys: ['font-display-v1'],
          policy: 'immutable',
          refs: [],
          note: '旧活动展示字体',
        },
        {
          id: 'img-hero-v1',
          url: 'https://cdn.example.com/static/img/hero-v1.jpg',
          kind: 'img',
          keys: ['img-hero'],
          policy: 'immutable',
          refs: [],
          note: '旧主视觉（宽 key: img-hero）',
        },
      ],
    },
    {
      id: 'v2',
      label: 'v2 · 春季换肤版',
      routes: [
        { id: 'r-home', path: '/', name: '首页', entryId: 'html-home' },
        { id: 'r-spring', path: '/spring/', name: '春季主会场', entryId: 'html-spring' },
        { id: 'r-spring-sub', path: '/spring/sub.html', name: '春季分会场', entryId: 'html-spring-sub' },
        { id: 'r-promo', path: '/promo/', name: '常规促销页', entryId: 'html-promo' },
      ],
      assets: [
        // 未发布页面：原样保留
        {
          id: 'html-home',
          url: 'https://cdn.example.com/index.html',
          kind: 'html',
          keys: ['html-home'],
          policy: 'no-cache',
          refs: ['css-comp-v1', 'js-app-v1'],
          note: '首页入口，本次不发布',
        },
        {
          id: 'html-promo',
          url: 'https://cdn.example.com/promo/index.html',
          kind: 'html',
          keys: ['html-promo'],
          policy: 'no-cache',
          refs: ['css-comp-v1', 'js-app-v1'],
          note: '常规促销页，本次不发布',
        },
        // 换肤的两个入口：引用切换到新指纹资源
        {
          id: 'html-spring',
          url: 'https://cdn.example.com/spring/index.html',
          kind: 'html',
          keys: ['html-spring', 'route-spring'],
          policy: 'no-cache',
          refs: ['css-spring-skin', 'css-spring-comp-v2', 'js-app-v2'],
        },
        {
          id: 'html-spring-sub',
          url: 'https://cdn.example.com/spring/sub.html',
          kind: 'html',
          keys: ['html-spring-sub', 'route-spring'],
          policy: 'no-cache',
          refs: ['css-spring-skin', 'css-spring-comp-v2', 'js-app-v2'],
        },
        // 旧组件包仍被未发布页面引用；新组件包同时打了宽 key
        {
          id: 'css-comp-v1',
          url: 'https://cdn.example.com/static/comp-v1.css',
          kind: 'css',
          keys: ['css-components'],
          policy: 'srl',
          refs: ['font-base'],
          note: '跨路由共享的旧组件样式（宽 key: css-components）',
        },
        {
          id: 'css-spring-comp-v2',
          url: 'https://cdn.example.com/static/comp-v2.css',
          kind: 'css',
          keys: ['css-spring-comp', 'css-components'],
          policy: 'immutable',
          refs: ['font-base'],
          note: '新组件包（指纹新 URL）；误带宽 key css-components',
        },
        {
          id: 'css-spring-skin',
          url: 'https://cdn.example.com/static/spring-skin.css',
          kind: 'css',
          keys: ['css-spring-skin'],
          policy: 'srl',
          refs: ['font-display-v2', 'img-hero-v2'],
          note: '皮肤样式（稳定 URL，内容随换肤更新，SWR）',
        },
        {
          id: 'js-app-v1',
          url: 'https://cdn.example.com/static/app-v1.js',
          kind: 'js',
          keys: ['js-app'],
          policy: 'immutable',
          refs: [],
          note: '旧脚本（宽 key: js-app），首页与促销页仍引用',
        },
        {
          id: 'js-app-v2',
          url: 'https://cdn.example.com/static/app-v2.js',
          kind: 'js',
          keys: ['js-app-v2', 'js-app'],
          policy: 'immutable',
          refs: [],
          note: '新脚本（指纹新 URL）；误带宽 key js-app',
        },
        {
          id: 'font-base',
          url: 'https://cdn.example.com/static/fonts/base-v1.woff2',
          kind: 'font',
          keys: ['font-base'],
          policy: 'immutable',
          refs: [],
          note: '跨路由共享基础字体，新旧版本均引用，内容不变',
        },
        {
          id: 'font-display-v2',
          url: 'https://cdn.example.com/static/fonts/display-v2.woff2',
          kind: 'font',
          keys: ['font-display-v2'],
          policy: 'immutable',
          refs: [],
          note: '新活动展示字体（指纹新 URL）',
        },
        {
          id: 'img-hero-v2',
          url: 'https://cdn.example.com/static/img/hero-v2.jpg',
          kind: 'img',
          keys: ['img-hero-v2', 'img-hero'],
          policy: 'immutable',
          refs: [],
          note: '新主视觉（指纹新 URL；误带宽 key img-hero）',
        },
      ],
    },
  ],
};

export const EDGE_REGIONS = [
  { id: 'cn-east', name: '华东' },
  { id: 'cn-north', name: '华北' },
  { id: 'cn-south', name: '华南' },
  { id: 'apac', name: '亚太' },
  { id: 'eu-us', name: '欧美' },
] as const;
