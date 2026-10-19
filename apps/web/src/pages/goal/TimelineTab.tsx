import type { GoalTimeline, SpanKind, TimelineRow, TimelineSpan } from '@foundry/core/browser';
import { Minus, Plus } from 'lucide-react';
import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.ts';
import { useLive } from '../../store.ts';
import { Button, Card, cn, fmtUsd } from '../../ui.tsx';
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
/** a folded stretch is hatched faintly across every row */
const FOLDED = { backgroundImage: 'repeating-linear-gradient(90deg, rgba(113,113,122,0.18) 0 2px, transparent 2px 6px)' };
const ZOOMS = [1, 2, 4, 8, 16] as const;

/** a duration the way a person says it: 40s, 12m, 1h 05m */
export function fmtDur(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** minutes from the start at which the axis is marked: a round step, at most `max` marks */
export function axisMarks(totalMs: number, max = 8): number[] {
  const min = totalMs / 60_000;
  const step = axisStep(totalMs, max);
  const out: number[] = [];
  for (let m = 0; m <= min; m += step) out.push(m);
  return out;
}
const axisStep = (totalMs: number, max: number) => [1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 720, 1440].find((s) => totalMs / 60_000 / s <= max) ?? 2880;

/** a stretch of the axis: drawn to scale, or folded into a short marked gap because nothing happened in it */
export interface AxisSegment {
  start: number;
  end: number;
  folded: boolean;
}

/** a quiet stretch at least this long (and this share of the whole) is folded */
const FOLD_MIN_MS = 20 * 60_000;
const FOLD_SHARE = 0.04;
/** a folded stretch is drawn as wide as this share of the time drawn to scale */
const FOLD_WIDTH = 0.05;

/**
 * The axis of a timeline: a stretch in which nothing ran (no session, no wait for the person, no Delegated goal; only a
 * goal's own Running bar) folds into a short gap, so a goal of a day keeps its steps readable; the rest is to scale.
 */
export function axisSegments(t: GoalTimeline): AxisSegment[] {
  const t0 = Date.parse(t.start);
  const t1 = Math.max(t0 + 1, Date.parse(t.end));
  const busy = t.rows
    .flatMap((r) => r.spans.filter((s) => !(s.kind === 'run' && (r.kind === 'goal' || r.kind === 'delegated'))).map((s) => [Date.parse(s.start), Date.parse(s.end)] as const))
    .sort((a, b) => a[0] - b[0]);
  const quiet = Math.max(FOLD_MIN_MS, (t1 - t0) * FOLD_SHARE);
  const out: AxisSegment[] = [];
  let from = t0;
  let reach = t0;
  const fold = (a: number, b: number) => {
    if (a > from) out.push({ start: from, end: a, folded: false });
    out.push({ start: a, end: b, folded: true });
    from = b;
  };
  for (const [a, b] of busy) {
    if (a - reach >= quiet) fold(reach, a);
    reach = Math.max(reach, b);
  }
  if (t1 - reach >= quiet) fold(reach, t1);
  if (t1 > from) out.push({ start: from, end: t1, folded: false });
  return out;
}

/** where a moment falls on the axis, as a share of its width in %, the folded stretches drawn narrow */
export function axisScale(segs: AxisSegment[]): (t: number) => number {
  const drawn = segs.filter((s) => !s.folded).reduce((n, s) => n + (s.end - s.start), 0) || 1;
  const width = (s: AxisSegment) => (s.folded ? Math.max(1, drawn * FOLD_WIDTH) : s.end - s.start);
  const all = segs.reduce((n, s) => n + width(s), 0) || 1;
  return (t: number) => {
    let acc = 0;
    for (const s of segs) {
      if (t <= s.end) return ((acc + (s.end > s.start ? (Math.max(t, s.start) - s.start) / (s.end - s.start) : 0) * width(s)) / all) * 100;
      acc += width(s);
    }
    return 100;
  };
}

const spanMs = (s: TimelineSpan) => Date.parse(s.end) - Date.parse(s.start);
const clock = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** The Timeline tab: loads the goal's timeline, and again whenever the goal moves on. */
export function TimelineTab({ goalId, onOpenTask }: { goalId: string; onOpenTask?: (taskId: string) => void }) {
  const version = useLive((s) => s.goalVersion[goalId] ?? 0);
  const [t, setT] = useState<GoalTimeline | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    // a burst of events (a task landing) asks once
    const h = setTimeout(() => void api.timeline(goalId).then(setT, (e) => setErr(e.message)), 300);
    return () => clearTimeout(h);
  }, [goalId, version]);
  if (!t) return <Card title="Timeline">{err ? <div className="text-sm text-rose-300">{err}</div> : <div className="text-sm text-zinc-500">Loading…</div>}</Card>;
  return <TimelineView t={t} onOpenTask={onOpenTask} />;
}

type Ctx = { row: TimelineRow; span: TimelineSpan | null; x: number; y: number };

/**
 * Where a goal's time went: the totals and the longest steps, then every step on one time axis, the goal and its
 * Delegated goals together, so the one that took longest shows at a glance. A stretch in which nothing ran folds; the
 * zoom widens the chart (it scrolls sideways, the rows' names stay); a bar or a row's name opens what it was, and its
 * task.
 */
export function TimelineView({ t, onOpenTask }: { t: GoalTimeline; onOpenTask?: (taskId: string) => void }) {
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const segs = axisSegments(t);
  const x = axisScale(segs);
  const t0 = Date.parse(t.start);
  const drawn = segs.filter((s) => !s.folded).reduce((n, s) => n + (s.end - s.start), 0);
  const step = axisStep(drawn || 1, 8 * zoom) * 60_000;
  // the marks fall on round times since the start, only where the axis is to scale
  const marks = segs.filter((s) => !s.folded).flatMap((s) => {
    const out: number[] = [];
    for (let m = Math.ceil((s.start - t0) / step) * step; t0 + m <= s.end; m += step) out.push(m);
    return out;
  });
  const sessions = (['work', 'review', 'clarify', 'merge', 'other'] as const).filter((k) => t.totals[k] > 0);
  const used = new Set(t.rows.flatMap((r) => r.spans.map((s) => s.kind)));
  const open = (e: MouseEvent, row: TimelineRow, span: TimelineSpan | null) => setCtx({ row, span, x: e.clientX, y: e.clientY });
  const zi = ZOOMS.indexOf(zoom);
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
      <Card
        title="Timeline"
        actions={
          <span className="flex items-center gap-1 text-[11px] text-zinc-400">
            <Button size="sm" variant="ghost" className="px-1.5" disabled={zi === 0} onClick={() => setZoom(ZOOMS[zi - 1]!)} aria-label="zoom out" title="Zoom out">
              <Minus size={12} />
            </Button>
            <button type="button" className="mono w-10 text-center hover:text-zinc-100" onClick={() => setZoom(1)} title="Fit the whole goal in the width">
              {zoom === 1 ? 'fit' : `×${zoom}`}
            </button>
            <Button size="sm" variant="ghost" className="px-1.5" disabled={zi === ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[zi + 1]!)} aria-label="zoom in" title="Zoom in (the chart scrolls sideways)">
              <Plus size={12} />
            </Button>
          </span>
        }
      >
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-400 mb-3">
          {(Object.keys(KIND) as SpanKind[]).filter((k) => used.has(k)).map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className={cn('h-2 w-3 rounded-sm', KIND[k].color)} style={k === 'waiting' ? STRIPES : undefined} />
              {KIND[k].label}
            </span>
          ))}
          {segs.some((s) => s.folded) && (
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-3 rounded-sm" style={FOLDED} />
              nothing ran (folded)
            </span>
          )}
        </div>
        <div className="flex">
          {/* the rows' names stay while the chart scrolls sideways */}
          <div className="w-32 sm:w-56 shrink-0 pr-3">
            <div className="h-5 border-b border-zinc-800" />
            {t.rows.map((r) => {
              const head = r.kind === 'goal' || r.kind === 'delegated';
              return (
                <button key={r.id} type="button" onClick={(e) => open(e, r, null)} className={cn('block h-7 w-full truncate border-b border-zinc-800/50 text-left text-xs hover:text-zinc-50', head ? 'font-medium text-zinc-100' : r.kind === 'sessions' ? 'italic text-zinc-400' : 'text-zinc-300')} style={{ paddingLeft: `${r.level * 0.9}rem` }} title={r.label}>
                  {r.kind === 'delegated' ? '↳ ' : ''}
                  {r.label}
                </button>
              );
            })}
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <div className="min-w-[440px]" style={{ width: `${zoom * 100}%` }}>
              <div className="relative h-5 border-b border-zinc-800">
                {marks.map((m) => (
                  <span key={m} className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px] tabular-nums text-zinc-500" style={{ left: `${Math.min(99, x(t0 + m))}%` }}>
                    {m === 0 ? '0' : fmtDur(m)}
                  </span>
                ))}
                {segs.filter((s) => s.folded).map((s) => (
                  <span key={s.start} className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px] text-zinc-500" style={{ left: `${(x(s.start) + x(s.end)) / 2}%` }} title={`nothing ran for ${fmtDur(s.end - s.start)}`}>
                    ⋯ {fmtDur(s.end - s.start)}
                  </span>
                ))}
              </div>
              {t.rows.map((r) => {
                const head = r.kind === 'goal' || r.kind === 'delegated';
                return (
                  <div key={r.id} className={cn('relative h-7 border-b border-zinc-800/50', head && 'bg-zinc-800/20')}>
                    {segs.filter((s) => s.folded).map((s) => (
                      <span key={s.start} className="absolute inset-y-0" style={{ left: `${x(s.start)}%`, width: `${x(s.end) - x(s.start)}%`, ...FOLDED }} />
                    ))}
                    {r.spans.map((s, i) => {
                      const left = x(Date.parse(s.start));
                      const width = Math.max(0.35, x(Date.parse(s.end)) - left);
                      const thin = s.kind === 'run' && head;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={(e) => open(e, r, s)}
                          className={cn('absolute rounded-sm hover:brightness-125', KIND[s.kind].color, thin ? 'top-3 h-1 opacity-60' : 'top-1.5 h-4', s.open && 'ring-1 ring-emerald-300/70')}
                          style={{ left: `${left}%`, width: `${width}%`, ...(s.kind === 'waiting' ? STRIPES : {}) }}
                          title={`${s.label} · ${fmtDur(spanMs(s))}${s.costUsd ? ` · ${fmtUsd(s.costUsd)}` : ''}${s.open ? ' · still going' : ''}`}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Card>
      {ctx && <SpanDetails ctx={ctx} goalId={t.goalId} onOpenTask={onOpenTask} onClose={() => setCtx(null)} />}
    </div>
  );
}

/** what a clicked bar (or row) was, and where to go from it: its task, or the Delegated goal that did it */
function SpanDetails({ ctx, goalId, onOpenTask, onClose }: { ctx: Ctx; goalId: string; onOpenTask?: (taskId: string) => void; onClose: () => void }) {
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // after the click that opened it has finished
    const h = setTimeout(() => document.addEventListener('mousedown', away), 0);
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(h);
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  const { row, span } = ctx;
  const otherGoal = row.goalId !== goalId;
  const go = (to: string) => (onClose(), nav(to));
  const below = ctx.y < window.innerHeight * 0.6;
  return (
    <div ref={ref} className="fixed z-[65] w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs shadow-xl space-y-2" style={{ left: Math.max(8, Math.min(ctx.x - 24, window.innerWidth - 296)), ...(below ? { top: ctx.y + 12 } : { bottom: window.innerHeight - ctx.y + 12 }) }} role="dialog" aria-label="step details">
      <div>
        <div className="flex items-center gap-1.5 font-medium text-zinc-100">
          {span && <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', KIND[span.kind].color)} />}
          <span className="min-w-0 truncate">{span?.label ?? row.label}</span>
        </div>
        {span && span.label !== row.label && <div className="text-zinc-500 truncate">{row.label}</div>}
      </div>
      {span && (
        <div className="text-zinc-400">
          {clock(span.start)} → {span.open ? 'now' : clock(span.end)} · <span className="text-zinc-200">{fmtDur(spanMs(span))}</span>
          {span.costUsd ? <> · {fmtUsd(span.costUsd)}</> : null}
          {span.open && <span className="text-emerald-300"> · still going</span>}
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-0.5">
        {row.taskId && (
          <Button size="sm" variant="primary" onClick={() => (otherGoal || !onOpenTask ? go(`/goals/${row.goalId}?task=${row.taskId}#tasks`) : (onClose(), onOpenTask(row.taskId!)))}>
            Open task
          </Button>
        )}
        {row.delegatedGoalId && (
          <Button size="sm" onClick={() => go(`/goals/${row.delegatedGoalId}#timeline`)}>
            Open delegated goal
          </Button>
        )}
        {!row.taskId && otherGoal && (
          <Button size="sm" onClick={() => go(`/goals/${row.goalId}#timeline`)}>
            Open delegated goal
          </Button>
        )}
      </div>
    </div>
  );
}
