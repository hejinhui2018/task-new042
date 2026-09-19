// ─────────────────────────────────────────────────────────────
// CacheSketch 领域类型
// 全部为纯数据、可 JSON 序列化，便于撤销/重做与刷新恢复。
// ─────────────────────────────────────────────────────────────

/** 资源类型 */
export type NodeKind =
  | 'html' // 入口 HTML
  | 'css' // 组件样式 / 皮肤样式
  | 'js' // 脚本
  | 'font' // 字体（跨路由共享）
  | 'img'; // 图片等其他资源

/** 资源的缓存策略 */
export type CachePolicy =
  | 'no-cache' // 每次回源校验（must-revalidate，内容变了必须立即生效）
  | 'srl' // stale-while-revalidate：可先服务旧副本，后台异步刷新
  | 'immutable'; // 内容指纹资源，不清除，只更新引用方

/** 一个可缓存对象（CDN 上的一条 URL） */
export interface AssetNode {
  id: string;
  url: string;
  kind: NodeKind;
  /** 命中的 surrogate key 列表（Fastly 风格标签，按 key 批量失效） */
  keys: string[];
  policy: CachePolicy;
  /**
   * 引用边：本资源引用了哪些资源（HTML→CSS/JS、CSS→font/img、JS chunk→chunk）。
   * 引用方内容变化会带动被引用资源的 key 一并被 purge（见 graph.ts 规则）。
   */
  refs: string[];
  /** 备注，例如“跨路由共享字体” */
  note?: string;
}

/** 一次路由/页面 */
export interface RouteNode {
  id: string;
  path: string;
  name: string;
  /** 入口 HTML 资源 id */
  entryId: string;
}

/** 版本（用于回滚）：v1 当前线上、v2 换肤后 */
export interface Version {
  id: string;
  label: string;
  assets: AssetNode[];
  routes: RouteNode[];
}

/** 内置场景 */
export interface Scenario {
  id: string;
  name: string;
  description: string;
  /** 可回滚版本，首个视为当前线上版本 */
  versions: Version[];
}

/** 单条路由策略（用户可调整） */
export interface RouteStrategy {
  routeId: string;
  /** 本次是否改动该路由 */
  selected: boolean;
  /** 该路由入口是否允许 SWR 延迟刷新（HTML 默认不允许） */
  allowStale: boolean;
}

/** 全局策略（用户可调整） */
export interface GlobalStrategy {
  /** 是否允许按 surrogate key 批量失效（关闭后只能逐 URL） */
  useSurrogateKeys: boolean;
  /** 无指纹的 SWR 资源最长容忍延迟（秒），仅作展示与判断阈值 */
  staleToleranceSec: number;
  /** 边缘节点单波超时（毫秒），模拟用 */
  edgeTimeoutMs: number;
  /** 超时后最大重试次数 */
  maxRetries: number;
}

// ── 规划结论 ──

export type Conclusion =
  | 'purge-now' // 必须立即清除
  | 'stale-refresh' // 可延迟刷新（SWR 窗口内）
  | 'unsafe-keep'; // 不能安全清除（共享，仍被未改动页面引用）

export interface Reason {
  /** 机器可读规则码 */
  rule: string;
  /** 人话说明 */
  text: string;
  /** 支撑该结论的依赖对象 id（引用方/共享方/指纹资源等） */
  via: string[];
}

export interface PlannedAsset {
  assetId: string;
  url: string;
  kind: NodeKind;
  keys: string[];
  policy: CachePolicy;
  conclusion: Conclusion;
  /** 结论的完整推理链，按规则触发顺序排列 */
  reasons: Reason[];
  /** 本次将被 purge 的 surrogate key（immutable 资源为空；逐 URL 模式也为空） */
  purgeKeys: string[];
  /** 关闭 surrogate key 批量模式时，需逐 URL purge 的地址 */
  purgeUrls: string[];
  /** unsafe-keep 时的建议处置方式 */
  remediation?: string;
}

/** 执行波次 */
export interface Wave {
  index: number;
  title: string;
  assetIds: string[];
  /** 该波次要 purge 的 key 并集 */
  purgeKeys: string[];
  /** 波次设计依据 */
  rationale: string;
}

export interface InvalidationPlan {
  waves: Wave[];
  assets: PlannedAsset[];
  /** 本次会被 purge 的全部 key */
  allPurgeKeys: string[];
  /** 逐 URL 模式下本次会被 purge 的全部 URL */
  allPurgeUrls: string[];
}

// ── 边缘模拟 ──

export type RegionStatus =
  | 'pending'
  | 'success'
  | 'timeout';

export interface RegionState {
  id: string;
  name: string;
  /** 该区域服务的资源 id → 状态 */
  statuses: Record<string, RegionStatus>;
}

export interface SimEvent {
  seq: number;
  region: string;
  assetId: string;
  attempt: number;
  outcome: 'success' | 'timeout';
  detail: string;
}

export interface SimState {
  /** 每个可执行波次：每个区域对每个资源的状态（W3 unsafe 不参与） */
  waves: RegionState[][];
  /** 与 waves 对齐：每波资源 id 顺序 */
  waveAssetIds: string[][];
  /** attempts[wave][regionIndex][assetIndex] = 已尝试次数 */
  attempts: number[][][];
  events: SimEvent[];
  finished: boolean;
}

// ── 前后对比 ──

export interface PlanDiff {
  onlyBefore: string[];
  onlyAfter: string[];
  changedConclusion: {
    assetId: string;
    before: Conclusion;
    after: Conclusion;
  }[];
}

/** 撤销/重做栈中保存的文档 */
export interface DocState {
  versionId: string;
  routes: RouteStrategy[];
  policyOverrides: Record<string, CachePolicy>;
  global: GlobalStrategy;
}
