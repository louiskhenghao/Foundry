import { PROVIDER_LABEL, reportsDollars, unmeasuredSessions } from '@foundry/core/browser';
import type { ReactNode } from 'react';
import type { GoalDetail } from '../../api.ts';
import { CutSessionsDot } from '../../components/CutSessionsDot.tsx';
import { Card, cn, fmtUsd } from '../../ui.tsx';

/** a share of a limit, as a percentage; null when there is no limit */
const share = (value: number, max: number | null) => (max ? (value / max) * 100 : null);

/**
 * A ruler under a figure: ticks across it (every fifth or eighth), the share used filled in ink (yellow past 70 %, red
 * past 90 %), and the estimate as a mark that stands above and below it.
 */
function Ruler({ pct, ticks, est, label }: { pct: number; ticks: number; est?: number | null; label: string }) {
  const step = `${100 / ticks}%`;
  return (
    <div
      role="img"
      aria-label={label}
      className="relative mt-2 h-4 rounded-sm bg-sunken ring-1 ring-inset ring-line"
      style={{ backgroundImage: `repeating-linear-gradient(90deg, transparent 0 calc(${step} - 1px), var(--color-line-strong) calc(${step} - 1px) ${step})` }}
    >
      <i className={cn('absolute inset-y-0 left-0 rounded-l-sm', pct > 90 ? 'bg-bad' : pct > 70 ? 'bg-you' : 'bg-ink')} style={{ width: `${Math.max(1, Math.min(100, pct))}%` }} />
      {est != null && <span aria-hidden="true" className="absolute -inset-y-[5px] -ml-[1.5px] w-[3px] rounded-[2px] bg-ink" style={{ left: `${Math.min(100, est)}%` }} />}
    </div>
  );
}

/** one figure of the card: its label, the value large with its limit, the ruler, and the scale under it */
function Gauge({ label, value, of, note, children }: { label: string; value: string; of: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs font-extrabold caps text-ink-faint">{label}</span>
        <span className="flex items-baseline gap-1.5 text-sm text-ink-faint">
          <b className="mono text-[26px] font-bold leading-none tracking-[-0.02em] text-ink">{value}</b>
          {of}
          {note}
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * Budget & time (the goal's Overview): what the goal has spent against its budget and how long Foundry has worked against
 * its limit, each as a large figure over a ruler, the time's ruler marked with the Brief's estimate.
 */
export function BudgetCard({ d }: { d: GoalDetail }) {
  const g = d.goal;
  const brief = d.brief?.brief ?? null;
  const dollars = reportsDollars(g.provider);
  const unmeasured = unmeasuredSessions(d.attempts);
  const cost = g.budgets.maxCostUsd;
  const limit = g.budgets.maxDurationMin;
  const elapsed = d.budget.elapsedMin;
  const est = brief?.timeEstimateMin ?? null;
  const estimate = brief ? `${dollars ? `${fmtUsd(brief.costEstimateUsd)} · ` : ''}${brief.timeEstimateMin} min` : null;
  return (
    <Card title="Budget & time">
      <div className="space-y-5">
        {dollars ? (
          <Gauge label="Spent" value={fmtUsd(g.costUsd)} of={cost == null ? 'no limit' : `of ${fmtUsd(cost)}`} note={unmeasured > 0 ? <CutSessionsDot n={unmeasured} est={d.costEstimate} /> : null}>
            {cost != null && (
              <>
                <Ruler pct={share(g.costUsd, cost)!} ticks={5} label={`${fmtUsd(g.costUsd)} of ${fmtUsd(cost)}`} />
                <div className="mono mt-1.5 flex justify-between text-[11.5px] text-ink-faint" aria-hidden="true">
                  <span>$0</span>
                  <span>{fmtUsd(cost).replace(/\.00$/, '')}</span>
                </div>
              </>
            )}
          </Gauge>
        ) : (
          <p className="text-sm text-ink-soft">{PROVIDER_LABEL[g.provider ?? 'claude']} · dollar cost unavailable</p>
        )}
        <div title="Time Foundry has worked on this goal, Clarify included. Waiting for you (interview answers, Brief approval, Inbox, a milestone pause) does not count.">
          <Gauge label="Time" value={`${elapsed.toFixed(0)} min`} of={limit == null ? 'no limit' : `of ${limit}`}>
            {limit != null && (
              <>
                <Ruler pct={share(elapsed, limit)!} ticks={8} est={est != null ? share(est, limit) : null} label={`${elapsed.toFixed(0)} of ${limit} minutes${est != null ? `, estimate ${est}` : ''}`} />
                <div className="mono relative mt-1.5 flex justify-between text-[11.5px] text-ink-faint" aria-hidden="true">
                  <span>0</span>
                  {est != null && est < limit && (
                    // the estimate's label under its mark, kept clear of the two ends
                    <span className="absolute top-0 -translate-x-1/2 font-bold text-ink" style={{ left: `${Math.min(88, Math.max(12, share(est, limit)!))}%` }}>
                      est. {est}
                    </span>
                  )}
                  <span>{limit} min</span>
                </div>
              </>
            )}
          </Gauge>
        </div>
        {/* the estimate under the figures: in the card's head it wrapped onto a line of its own in a narrow column */}
        {estimate && (
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line pt-3 text-xs text-ink-faint">
            The Brief's estimate <b className="mono text-[13px] font-semibold text-ink-soft">{estimate}</b>
          </p>
        )}
      </div>
    </Card>
  );
}
