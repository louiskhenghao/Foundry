import type { AgyQuotaBucket, UsageSummary } from '@foundry/engine/usage-types';
import { Card, cn } from '../ui.tsx';

type Quota = NonNullable<UsageSummary['agyQuota']>;

/** The Antigravity account's quota as agy reports it: one weekly limit per group of models, use outside Foundry included. */
export function AgyQuotaCard({ quota }: { quota?: Quota | null }) {
  return <Card title="Antigravity account quota" actions={quota && <span className="text-xs text-ink-faint">checked {new Date(quota.checkedAt).toLocaleString()}</span>}>
    {!quota ? <p className="text-xs text-ink-soft">Account quota has not been read yet. Refresh quota to read it from agy without running a model.</p> : quota.state !== 'available' ? <p className="text-xs text-ink-soft">{quota.error ?? 'agy reported no quota.'}</p> : <div className="space-y-3">
      <p className="text-xs text-ink-faint">The models of a group share one limit, use outside Foundry included. agy counts it by what the tokens cost, so short tasks and cheaper models make it last longer. A goal runs on one model: only its group's limit stops it.</p>
      <div className={cn('grid grid-cols-1 gap-3', quota.groups.length > 1 && 'md:grid-cols-2')}>{quota.groups.map((group) => <section key={group.name} className="rounded-lg border border-line bg-sunken p-3 min-w-0 space-y-3">
        <div><h3 className="text-sm font-bold text-ink break-words">{group.name}</h3>{group.description && <div className="text-[11px] text-ink-faint">{group.description}</div>}</div>
        {group.buckets.length ? group.buckets.map((bucket) => <Bucket key={bucket.id || bucket.name} bucket={bucket} />) : <p className="text-xs text-ink-faint">No limits were returned for this group.</p>}
      </section>)}</div>
    </div>}
  </Card>;
}

/**
 * what is left of a limit: a blue bar (information from the account), yellow once under a tenth, as the top bar's dot —
 * and so is the figure beside it; an unknown one stays plain
 */
function Bucket({ bucket }: { bucket: AgyQuotaBucket }) {
  const percentage = bucket.remainingFraction == null ? null : Math.round(bucket.remainingFraction * 1000) / 10;
  const reset = bucket.resetTime ? new Date(bucket.resetTime) : null;
  const resetText = reset && Number.isFinite(reset.getTime()) ? reset.toLocaleString() : null;
  const low = percentage != null && percentage < 10;
  return <div className="space-y-1.5">
    <div className="flex items-start justify-between gap-2 text-xs"><span className="min-w-0 break-words text-ink-soft">{bucket.name}</span><span className={cn('mono font-semibold shrink-0', percentage == null ? 'text-ink-faint' : low ? 'text-you-ink' : 'text-ink')}>{percentage == null ? 'unknown' : `${percentage.toLocaleString()}% remaining`}</span></div>
    <div className="h-1.5 rounded-xs bg-line overflow-hidden" role={percentage == null ? undefined : 'meter'} aria-label={`${bucket.name} remaining${percentage == null ? ' unknown' : ''}`} aria-valuemin={percentage == null ? undefined : 0} aria-valuemax={percentage == null ? undefined : 100} aria-valuenow={percentage ?? undefined} aria-valuetext={percentage == null ? 'unknown' : `${percentage}% remaining`}><div className={cn('h-full', low ? 'bg-you' : 'bg-work')} style={{ width: `${percentage ?? 0}%` }} /></div>
    <p className="text-[11px] text-ink-faint">{resetText ? `Resets ${resetText}` : 'Reset time unavailable'}</p>
  </div>;
}
