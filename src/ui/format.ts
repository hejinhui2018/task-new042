// 展示层格式化辅助
import type { CachePolicy, Conclusion, Version } from '../domain/types';

export function assetBasename(url: string): string {
  try {
    return url.split('/').pop() ?? url;
  } catch {
    return url;
  }
}

export function assetLabel(version: Version | undefined, id: string): string {
  if (version) {
    const route = version.routes.find((r) => r.entryId === id);
    if (route) return `${route.path}（${route.name}）`;
    const asset = version.assets.find((a) => a.id === id);
    if (asset) return assetBasename(asset.url);
  }
  return id;
}

export const POLICY_LABEL: Record<CachePolicy, string> = {
  'no-cache': 'no-cache · 立即校验',
  srl: 'stale-while-revalidate',
  immutable: 'immutable · 指纹资源',
};

export const CONCLUSION_META: Record<
  Conclusion,
  { label: string; tone: 'danger' | 'warn' | 'muted'; desc: string }
> = {
  'purge-now': {
    label: '必须立即清除',
    tone: 'danger',
    desc: '入口或不可容忍旧内容的对象：边缘必须立刻硬清除并回源。',
  },
  'stale-refresh': {
    label: '可延迟刷新',
    tone: 'warn',
    desc: 'SWR 窗口内可继续服务旧副本、后台刷新；指纹新资源无需清除，预热即可。',
  },
  'unsafe-keep': {
    label: '不能安全清除',
    tone: 'muted',
    desc: '仍被未发布页面引用，或宽 surrogate key 会误伤旧副本：本次不动。',
  },
};

export const RULE_LABEL: Record<string, string> = {
  'R1-entry-selected': '入口被选中发布',
  'R2-shared-by-untouched': '共享给未发布页面',
  'R3-surrogate-key-collision': '宽 key 碰撞误伤',
  'R4-fingerprinted-immutable': '指纹资源无需清除',
  'R5-stale-while-revalidate': 'SWR 延迟刷新',
  'R6-collateral-safe': '连带清除安全',
};
