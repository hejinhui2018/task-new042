import type { Reason, ReasonRule } from '../lib/plan';

const RULE_META: Record<ReasonRule, { icon: string; label: string }> = {
  changed: { icon: '✏️', label: '改动' },
  'route-entry': { icon: '🚪', label: '入口' },
  'depends-on-changed': { icon: '🔗', label: '依赖' },
  'surrogate-key': { icon: '🏷️', label: '键' },
  'swr-defer': { icon: '⏳', label: 'SWR' },
  'cross-route-shared': { icon: '🚫', label: '跨路由' },
  immutable: { icon: '🔒', label: 'immutable' },
};

/** 渲染一条结论的全部依据：每条结论都能追溯到具体规则与依赖链 */
export function ReasonList({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="reasons">
      {reasons.map((reason, i) => (
        <li key={i} className={`reason rule-${reason.rule}`}>
          <span className="reason-icon" title={RULE_META[reason.rule].label}>
            {RULE_META[reason.rule].icon}
          </span>
          <span className="reason-message">{reason.message}</span>
        </li>
      ))}
    </ul>
  );
}
