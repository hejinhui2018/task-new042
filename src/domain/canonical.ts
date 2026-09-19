// ─────────────────────────────────────────────────────────────
// 稳定序列化：对象键递归排序后输出，保证相同语义数据得到逐字节一致的字符串。
// 供规划摘要、测试快照与 localStorage 持久化使用。
// ─────────────────────────────────────────────────────────────

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

/** djb2 哈希 → 8 位十六进制，作为规划指纹（非密码学用途） */
export function shortHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 规划指纹：只取结论与 purge 范围，忽略展示性字段 */
export function planFingerprint(plan: {
  assets: { assetId: string; conclusion: string; purgeKeys: string[]; purgeUrls: string[] }[];
}): string {
  const minimal = {
    assets: [...plan.assets]
      .map((a) => ({ id: a.assetId, c: a.conclusion, k: [...a.purgeKeys].sort(), u: [...a.purgeUrls].sort() }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
  return shortHash(stableStringify(minimal));
}
