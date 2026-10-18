import type { GoalTimeline, SpanKind, TimelineRow, TimelineSpan } from '@foundry/core/browser';
import { useEffect, useState } from 'react';
import { api } from '../../api.ts';
import { useLive } from '../../store.ts';
import { Card, cn, fmtUsd } from '../../ui.tsx';
import { HelpLink } from '../HelpPage.tsx';

/** what each kind of bar means, and its colour */
const KIND: Record<SpanKind, { label: string; color: string }> = {
  clarify: { label: 'Clarify', color: 'bg-violet-500' },
  waiting: { label: 'Waiting for you', color: 'bg-amber-400' },
  work: { label: 'Work', color: 'bg-emerald-500' },
  review: { label: 'Reviews', color: 'bg-sky-500' },
  merge: { label: 'Landing', color: 'bg-fuchsia-500' },
  delivery: { label: 'Delivery', color: 'bg-teal-400' },
  other: { label: 'Other sessions', color: 'bg-zinc-400' },
  run: { label: 'Running', color: 'bg-zinc-600' },
};
/** waits are striped: time nothing moved on */
const STRIPES = { backgroundImage: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.18) 0 4px, transparent 4px 8px)' };

/** a duration the way a person says it: 40s, 12m, 1h 05m */
export function fmtDur(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** minutes from the start at which the axis is marked: a round step, at most 8 marks */
export function axisMarks(totalMs: number): number[] {
  const min = totalMs / 60_000;
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 720, 1440].find((s) => min / s <= 8) ?? 2880;
  const out: number[] = [];
  for (let m = 0; m <= min; m += step) out.push(m);
  return out;
}

const spanMs = (s: TimelineSpan) => Date.parse(s.end) - Date.parse(s.start);
const clock = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** The Timeline tab: loads the goal's timeline, and again whenever the goal moves on. */
export function TimelineTab({ goalId }: { goalId: string }) {
  const version = useLive((s) => s.goalVersion[goalId] ?? 0);
  const [t, setT] = useState<GoalTimeline | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    // a burst of events (a task landing) asks once
    const h = setTimeout(() => void api.timeline(goalId).then(setT, (e) => setErr(e.message)), 300);
    return () => clearTimeout(h);
  }, [goalId, version]);
  if (!t) return <Card title="Timeline">{err ? <div className="text-sm text-rose-300">{err}</div> : <div className="text-sm text-zinc-500">Loading…</div>}</Card>;
  return <TimelineView t={t} />;
}

/**
 * Where a goal's time went: the totals and the longest steps, then every step on one time axis, the goal and its
 * Delegated goals together, so the one that took longest shows at a glance.
 */
export function TimelineView({ t }: { t: GoalTimeline }) {
  const t0 = Date.parse(t.start);
  const total = Math.max(1, Date.parse(t.end) - t0);
  const sessions = (['work', 'review', 'clarify', 'merge', 'other'] as const).filter((k) => t.totals[k] > 0);
  const used = new Set(t.rows.flatMap((r) => r.spans.map((s) => s.kind)));
  return (
    <div className="space-y-4">
      <Card title={<>Where the time went<HelpLink to="while-it-runs#timeline" className="ml-1.5" /></>}>
        <div className="text-sm text-zinc-200">
          {fmtDur(t.totals.wall)} from start to {t.live ? 'now' : 'the end'}
          {t.totals.waiting > 0 && <span className="text-amber-300"> · {fmtDur(t.totals.waiting)} waiting for you</span>}
          {t.totals.delivery > 0 && <span className="text-zinc-400"> · {fmtDur(t.totals.delivery)} delivering</span>}
        </div>
        <div className="text-[11px] text-zinc-500 mt-0.5">Started {clock(t.start)}{t.live ? ' · still working' : ` · ended ${clock(t.end)}`}</div>
        {sessions.length > 0 && (
          <div className="mt-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {sessions.map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5 text-zinc-300">
                  <span className={cn('h-2.5 w-2.5 rounded-sm', KIND[k].color)} />
                  {KIND[k].label} <span className="tabular-nums text-zinc-400">{fmtDur(t.totals[k])}</span>
                </span>
              ))}
            </div>
            <div className="text-[11px] text-zinc-500 mt-1">Time in sessions. They run side by side, so together they can take longer than the goal did.</div>
          </div>
        )}
        {t.longest.length > 0 && (
          <div className="mt-3">
            <div className="text-xs font-medium text-zinc-300 mb-1">The longest steps</div>
            <ol className="space-y-0.5 text-xs">
              {t.longest.map((l, i) => (
                <li key={i} className="flex items-center gap-2 min-w-0">
                  <span className={cn('h-2.5 w-2.5 rounded-sm shrink-0', KIND[l.span.kind].color)} />
                  <span className="tabular-nums text-zinc-400 w-14 shrink-0">{fmtDur(l.ms)}</span>
                  <span className="truncate text-zinc-200" title={`${l.span.label} · ${l.row}`}>
                    {l.span.label}
                    {l.row !== l.span.label && !l.span.label.endsWith(l.row) && <span className="text-zinc-500"> · {l.row}</span>}
                  </span>
                  {l.span.open && <span className="text-[10px] text-emerald-300 shrink-0">still going</span>}
                </li>
              ))}
            </ol>
          </div>
        )}
      </Card>
      <Card title="Timeline">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-400 mb-3">
          {(Object.keys(KIND) as SpanKind[]).filter((k) => used.has(k)).map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className={cn('h-2 w-3 rounded-sm', KIND[k].color)} style={k === 'waiting' ? STRIPES : undefined} />
              {KIND[k].label}
            </span>
          ))}
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[14rem_minmax(0,1fr)] gap-x-3">
              <div />
              <div className="relative h-5 border-b border-zinc-800">
                {axisMarks(total).map((m) => (
                  <span key={m} className="absolute top-0 -translate-x-1/2 text-[10px] tabular-nums text-zinc-500" style={{ left: `${Math.min(100, ((m * 60_000) / total) * 100)}%` }}>
                    {m === 0 ? '0' : fmtDur(m * 60_000)}
                  </span>
                ))}
              </div>
              {t.rows.map((r) => (
                <Row key={r.id} row={r} t0={t0} total={total} />
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Row({ row, t0, total }: { row: TimelineRow; t0: number; total: number }) {
  const head = row.kind === 'goal' || row.kind === 'delegated';
  return (
    <>
      <div className={cn('min-w-0 truncate py-1 text-xs', head ? 'font-medium text-zinc-100' : row.kind === 'sessions' ? 'italic text-zinc-400' : 'text-zinc-300')} style={{ paddingLeft: `${row.level * 0.9}rem` }} title={row.label}>
        {row.kind === 'delegated' ? '↳ ' : ''}
        {row.label}
      </div>
      <div className={cn('relative h-7 border-b border-zinc-800/50', head && 'bg-zinc-800/20')}>
        {row.spans.map((s, i) => {
          const left = ((Date.parse(s.start) - t0) / total) * 100;
          const width = Math.max(0.35, (spanMs(s) / total) * 100);
          const thin = s.kind === 'run' && head;
          return (
            <span
              key={i}
              className={cn('absolute rounded-sm', KIND[s.kind].color, thin ? 'top-3 h-1 opacity-60' : 'top-1.5 h-4', s.open && 'ring-1 ring-emerald-300/70')}
              style={{ left: `${left}%`, width: `${width}%`, ...(s.kind === 'waiting' ? STRIPES : {}) }}
              title={`${s.label} · ${fmtDur(spanMs(s))}${s.costUsd ? ` · ${fmtUsd(s.costUsd)}` : ''}${s.open ? ' · still going' : ''}`}
            />
          );
        })}
      </div>
    </>
  );
}
