import { Gauge } from 'lucide-react';
import type { UsageSummary } from '@foundry/engine/usage-types';
import { codexQuotaWindows } from '@foundry/engine/quota-windows';
import { Badge, Card, EmptyState, cn } from '../ui.tsx';

type Quota = NonNullable<UsageSummary['codexQuota']>;
type Window = Extract<Quota, { state: 'available' }>['buckets'][number]['primary'];

/** Percentages and reset times are observations; only the explicit allowance field describes availability. */
export function CodexQuotaCard({ quota }: { quota?: Quota }) {
  const allowance = quota?.state === 'available' ? quota.ordinaryUsageAllowed : null;
  return <Card title="Codex account quota" actions={quota && <span className="text-xs text-ink-faint">checked {new Date(quota.checkedAt).toLocaleString()}</span>}>
    {!quota ? <p className="text-xs text-ink-soft">Account quota has not been read yet. Refresh quota to check it without running inference.</p> : quota.state !== 'available' ? <p className={cn('text-xs', quota.state === 'error' ? 'text-bad-ink' : 'text-ink-soft')}>{quota.message}</p> : <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs flex-wrap"><span className="text-ink-soft">Reported ordinary usage allowance</span><Badge state={allowance === null ? 'pending' : allowance ? 'pass' : 'warn'}>{allowance === null ? 'unknown' : allowance ? 'allowed' : 'blocked'}</Badge></div>
      <p className="text-xs text-ink-faint">Only limits reported for the signed-in account are shown, including use outside Foundry. Accounts may have different windows. Percentages and reset times do not confirm whether a new session can run. Refreshing reads account metadata without running inference.</p>
      {quota.buckets.length === 0 ? <EmptyState size="card" icon={Gauge} title="No quota windows were returned for this account" /> : <div className={cn('grid grid-cols-1 gap-3', quota.buckets.length > 1 && 'md:grid-cols-2')}>{quota.buckets.map((bucket) => <section key={bucket.id} className="rounded-lg border border-line bg-sunken p-3 min-w-0 space-y-3">
        <div><h3 className="text-sm font-bold text-ink break-words">{bucket.label || bucket.id}</h3>{bucket.label && bucket.label !== bucket.id && <div className="mono text-[11px] text-ink-faint break-all">{bucket.id}</div>}</div>
        {bucket.primary || bucket.secondary ? codexQuotaWindows(bucket).map(({ slot, window, label }) => <QuotaWindow key={slot} label={label} window={window} />) : <p className="text-xs text-ink-faint">No quota windows were returned for this group.</p>}
      </section>)}</div>}
    </div>}
  </Card>;
}

/** what is left of a window: the blue bar the guide describes, the work colour (information from the account) */
function QuotaWindow({ label, window }: { label: string; window: Window }) {
  if (!window) return null;
  const percentage = window.usedPercent != null && Number.isFinite(window.usedPercent) ? 100 - Math.max(0, Math.min(100, window.usedPercent)) : null;
  const reset = window.resetsAt == null ? null : new Date(window.resetsAt * 1000);
  const resetText = reset && Number.isFinite(reset.getTime()) ? reset.toLocaleString() : null;
  return <div className="space-y-1.5">
    <div className="flex items-start justify-between gap-2 text-xs"><span className="text-ink-soft">{label}</span><span className="mono font-semibold text-ink shrink-0">{percentage == null ? 'unknown' : `${percentage.toLocaleString(undefined, { maximumFractionDigits: 1 })}% remaining`}</span></div>
    <div className="h-1.5 rounded-xs bg-line overflow-hidden" role={percentage == null ? undefined : 'meter'} aria-label={`${label} remaining${percentage == null ? ' unknown' : ''}`} aria-valuemin={percentage == null ? undefined : 0} aria-valuemax={percentage == null ? undefined : 100} aria-valuenow={percentage == null ? undefined : Math.max(0, Math.min(100, percentage))} aria-valuetext={percentage == null ? 'unknown' : `${percentage}% remaining`}><div className="h-full bg-work" style={{ width: `${Math.max(0, Math.min(100, percentage ?? 0))}%` }} /></div>
    <p className="text-[11px] text-ink-faint">{resetText ? `Reported reset: ${resetText}` : 'Reset time unavailable'}</p>
  </div>;
}
