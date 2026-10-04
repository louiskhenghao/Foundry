import type { UsageSummary } from '@foundry/engine/usage-types';
import { codexQuotaWindows } from '@foundry/engine/quota-windows';
import { Badge, Card, cn } from '../ui.tsx';

type Quota = NonNullable<UsageSummary['codexQuota']>;
type Window = Extract<Quota, { state: 'available' }>['buckets'][number]['primary'];

/** Percentages and reset times are observations; only the explicit allowance field describes availability. */
export function CodexQuotaCard({ quota }: { quota?: Quota }) {
  const allowance = quota?.state === 'available' ? quota.ordinaryUsageAllowed : null;
  return <Card title="Codex account quota" actions={quota && <span className="text-[11px] text-zinc-500">checked {new Date(quota.checkedAt).toLocaleString()}</span>}>
    {!quota ? <p className="text-xs text-zinc-400">Account quota has not been read yet. Refresh quota to check it without running inference.</p> : quota.state !== 'available' ? <p className={cn('text-xs', quota.state === 'error' ? 'text-rose-300' : 'text-zinc-400')}>{quota.message}</p> : <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs flex-wrap"><span className="text-zinc-400">Reported ordinary usage allowance</span><Badge state={allowance === null ? 'pending' : allowance ? 'pass' : 'warn'}>{allowance === null ? 'unknown' : allowance ? 'allowed' : 'blocked'}</Badge></div>
      <p className="text-xs text-zinc-500">Only limits reported for the signed-in account are shown, including use outside Foundry. Accounts may have different windows. Percentages and reset times do not confirm whether a new session can run. Refreshing reads account metadata without running inference.</p>
      {quota.buckets.length === 0 ? <p className="text-xs text-zinc-400">No quota windows were returned for this account.</p> : <div className={cn('grid grid-cols-1 gap-3', quota.buckets.length > 1 && 'md:grid-cols-2')}>{quota.buckets.map((bucket) => <section key={bucket.id} className="rounded-lg border border-zinc-800 p-3 min-w-0 space-y-3">
        <div><h3 className="text-sm font-medium text-zinc-200 break-words">{bucket.label || bucket.id}</h3>{bucket.label && bucket.label !== bucket.id && <div className="mono text-[10px] text-zinc-500 break-all">{bucket.id}</div>}</div>
        {bucket.primary || bucket.secondary ? codexQuotaWindows(bucket).map(({ slot, window, label }) => <QuotaWindow key={slot} label={label} window={window} />) : <p className="text-xs text-zinc-500">No quota windows were returned for this group.</p>}
      </section>)}</div>}
    </div>}
  </Card>;
}

function QuotaWindow({ label, window }: { label: string; window: Window }) {
  if (!window) return null;
  const percentage = window.usedPercent != null && Number.isFinite(window.usedPercent) ? 100 - Math.max(0, Math.min(100, window.usedPercent)) : null;
  const reset = window.resetsAt == null ? null : new Date(window.resetsAt * 1000);
  const resetText = reset && Number.isFinite(reset.getTime()) ? reset.toLocaleString() : null;
  return <div className="space-y-1.5">
    <div className="flex items-start justify-between gap-2 text-xs"><span className="text-zinc-400">{label}</span><span className="mono text-zinc-200 shrink-0">{percentage == null ? 'unknown' : `${percentage.toLocaleString(undefined, { maximumFractionDigits: 1 })}% remaining`}</span></div>
    <div className="h-1.5 rounded bg-zinc-800 overflow-hidden" role={percentage == null ? undefined : 'meter'} aria-label={`${label} remaining${percentage == null ? ' unknown' : ''}`} aria-valuemin={percentage == null ? undefined : 0} aria-valuemax={percentage == null ? undefined : 100} aria-valuenow={percentage == null ? undefined : Math.max(0, Math.min(100, percentage))} aria-valuetext={percentage == null ? 'unknown' : `${percentage}% remaining`}><div className="h-full bg-sky-400" style={{ width: `${Math.max(0, Math.min(100, percentage ?? 0))}%` }} /></div>
    <p className="text-[11px] text-zinc-500">{resetText ? `Reported reset: ${resetText}` : 'Reset time unavailable'}</p>
  </div>;
}
