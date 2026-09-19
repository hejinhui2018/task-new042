import type { Asset, EdgeNode, Route, Selection, StrategyConfig } from '../types';

/**
 * 内置场景：春季活动页换肤
 *
 * 本次改动：
 * - 落地页 /campaign/spring 重新发布（HTML 新版本）；
 * - 春季皮肤 spring-theme.css 升级 v1 → v2；
 * - 主视觉 spring-hero.avif 升级 v1 → v2。
 *
 * 跨路由共享：品牌字体 brand-sans.woff2 与基础组件样式 components-base.css
 * 同时被活动页、首页和品牌页引用；旧版本均保留，可用于回滚。
 */
export const SCENARIO = {
  id: 'spring-2026-reskin',
  title: '春季活动页换肤',
  description:
    '落地页 HTML 重新发布，spring-theme.css 升级 v1 → v2，主视觉 spring-hero.avif 升级 v1 → v2。' +
    '品牌字体与基础组件样式为跨路由共享资源，旧版本保留用于回滚。',
  changes: [
    'html.spring / html.spring-promo：重新发布（r2026.03.12 → r2026.03.19）',
    'spring-theme.css：v1 → v2（可回滚至 v1）',
    'spring-hero.avif：v1 → v2（可回滚至 v1）',
  ],
};

export const ROUTES: Route[] = [
  { id: 'route.spring', path: '/campaign/spring', name: '春季活动落地页', entryAssetId: 'html.spring' },
  { id: 'route.spring-promo', path: '/campaign/spring/promo', name: '春季促销子页', entryAssetId: 'html.spring-promo' },
  { id: 'route.home', path: '/', name: '首页', entryAssetId: 'html.home' },
  { id: 'route.about', path: '/about', name: '品牌页', entryAssetId: 'html.about' },
];

export const ASSETS: Asset[] = [
  {
    id: 'html.spring',
    name: '/campaign/spring (HTML)',
    type: 'html',
    version: 'r2026.03.19',
    rollbackVersion: 'r2026.03.12',
    surrogateKeys: ['asset:html.spring', 'route:spring', 'skin:spring'],
    dependsOn: ['css.spring', 'js.components', 'img.hero'],
    policy: { ttlSeconds: 60, swrSeconds: 0, immutable: false },
  },
  {
    id: 'html.spring-promo',
    name: '/campaign/spring/promo (HTML)',
    type: 'html',
    version: 'r2026.03.19',
    rollbackVersion: 'r2026.03.12',
    surrogateKeys: ['asset:html.spring-promo', 'route:spring-promo', 'skin:spring'],
    dependsOn: ['css.spring', 'js.components'],
    policy: { ttlSeconds: 60, swrSeconds: 300, immutable: false },
  },
  {
    id: 'html.home',
    name: '/ (HTML)',
    type: 'html',
    version: 'r2026.03.10',
    rollbackVersion: 'r2026.03.03',
    surrogateKeys: ['asset:html.home', 'route:home'],
    dependsOn: ['css.base', 'font.brand'],
    policy: { ttlSeconds: 60, swrSeconds: 0, immutable: false },
  },
  {
    id: 'html.about',
    name: '/about (HTML)',
    type: 'html',
    version: 'r2026.03.10',
    surrogateKeys: ['asset:html.about', 'route:about'],
    dependsOn: ['css.base', 'font.brand'],
    policy: { ttlSeconds: 300, swrSeconds: 0, immutable: false },
  },
  {
    id: 'css.spring',
    name: 'spring-theme.css',
    type: 'css',
    version: 'v2',
    rollbackVersion: 'v1',
    surrogateKeys: ['asset:css.spring', 'skin:spring'],
    dependsOn: ['font.brand'],
    policy: { ttlSeconds: 3600, swrSeconds: 0, immutable: false },
  },
  {
    id: 'css.base',
    name: 'components-base.css',
    type: 'css',
    version: 'v8',
    rollbackVersion: 'v7',
    surrogateKeys: ['asset:css.base', 'components:core'],
    dependsOn: ['font.brand'],
    policy: { ttlSeconds: 3600, swrSeconds: 600, immutable: false },
  },
  {
    id: 'js.components',
    name: 'components.js',
    type: 'js',
    version: 'v8',
    surrogateKeys: ['asset:js.components', 'components:core'],
    dependsOn: [],
    policy: { ttlSeconds: 3600, swrSeconds: 0, immutable: false },
  },
  {
    id: 'font.brand',
    name: 'brand-sans.woff2',
    type: 'font',
    version: 'v5',
    rollbackVersion: 'v4',
    surrogateKeys: ['asset:font.brand', 'brand:font'],
    dependsOn: [],
    policy: { ttlSeconds: 86400, swrSeconds: 3600, immutable: false },
  },
  {
    id: 'img.hero',
    name: 'spring-hero.avif',
    type: 'img',
    version: 'v2',
    rollbackVersion: 'v1',
    surrogateKeys: ['asset:img.hero', 'skin:spring'],
    dependsOn: [],
    policy: { ttlSeconds: 86400, swrSeconds: 0, immutable: false },
  },
  {
    id: 'img.logo',
    name: 'logo.[hash].svg',
    type: 'img',
    version: 'v3',
    rollbackVersion: 'v2',
    surrogateKeys: ['asset:img.logo', 'brand:logo'],
    dependsOn: [],
    policy: { ttlSeconds: 31536000, swrSeconds: 0, immutable: true },
  },
];

export const ASSET_MAP: Map<string, Asset> = new Map(ASSETS.map((a) => [a.id, a]));

export const NODES: EdgeNode[] = [
  { id: 'edge-ap-shanghai', name: '上海', region: '华东' },
  { id: 'edge-ap-singapore', name: '新加坡', region: '东南亚' },
  { id: 'edge-eu-frankfurt', name: '法兰克福', region: '欧洲' },
  { id: 'edge-us-virginia', name: '弗吉尼亚', region: '北美' },
];

/** 默认选择：完整的换肤发布 = 两个春季活动路由 + 换肤涉及的两个资源 */
export function defaultSelection(): Selection {
  return {
    routeIds: ['route.spring', 'route.spring-promo'],
    assetIds: ['css.spring', 'img.hero'],
  };
}

export function defaultStrategy(): StrategyConfig {
  return {
    swrHandling: 'defer',
    includeCrossRouteShared: false,
    maxRetries: 2,
  };
}
