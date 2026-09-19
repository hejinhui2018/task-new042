/** 资源类型：入口 HTML / 样式 / 脚本 / 字体 / 图片 */
export type AssetType = 'html' | 'css' | 'js' | 'font' | 'img';

/** 边缘节点缓存策略 */
export interface CachePolicy {
  /** TTL（秒） */
  ttlSeconds: number;
  /** stale-while-revalidate 窗口（秒），0 表示不启用 */
  swrSeconds: number;
  /** immutable（内容哈希寻址），禁止清除 */
  immutable: boolean;
}

/** 一个可缓存对象（页面或静态资源） */
export interface Asset {
  id: string;
  /** 展示名（路径或文件名） */
  name: string;
  type: AssetType;
  /** 当前线上版本 */
  version: string;
  /** 可回滚到的上一版本；缺省表示没有可回滚版本 */
  rollbackVersion?: string;
  /** surrogate keys，第一项约定为 asset:<id> 的精确清除键 */
  surrogateKeys: string[];
  /** 本资源引用（依赖）的其他资源 id，如 HTML → CSS → font */
  dependsOn: string[];
  policy: CachePolicy;
}

/** 一条路由，入口为一个 HTML 资源 */
export interface Route {
  id: string;
  path: string;
  name: string;
  entryAssetId: string;
}

/** 用户选择的本次改动范围 */
export interface Selection {
  /** 本次重新发布的路由（入口 HTML 自动纳入改动） */
  routeIds: string[];
  /** 本次变更的资源 */
  assetIds: string[];
}

/** 失效策略 */
export interface StrategyConfig {
  /** 带 SWR 的间接受影响资源：defer = 延迟刷新；purge = 立即清除 */
  swrHandling: 'defer' | 'purge';
  /** 是否允许清除仍被未选中路由引用的跨路由共享资源 */
  includeCrossRouteShared: boolean;
  /** 单个边缘节点的最大重试次数（首次尝试之后的重试次数） */
  maxRetries: number;
}

/** 边缘节点 */
export interface EdgeNode {
  id: string;
  name: string;
  region: string;
}
