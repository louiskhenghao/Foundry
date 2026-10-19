import type { GoalTimeline, SpanKind, TimelineRow, TimelineSpan } from '@foundry/core/browser';
import { Minus, Plus } from 'lucide-react';
import { type Dispatch, type MouseEvent, type PointerEvent, type ReactNode, type SetStateAction, type UIEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
/** below this many pixels a minute a goal's steps are too thin to read or tap: the chart slides instead of fitting */
const READABLE_PPM = 4;
/** the zoom steps, in pixels a minute */
const PPM = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128];
/** indents of a row's name by its level: less on a phone, where the names column is narrow */
const INDENT = ['', 'pl-2 sm:pl-3.5', 'pl-4 sm:pl-7', 'pl-6 sm:pl-10'];

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
/** the round steps the axis is marked at, in minutes */
const AXIS_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 720, 1440];
const axisStep = (totalMs: number, max: number) => AXIS_STEPS.find((s) => totalMs / 60_000 / s <= max) ?? 2880;

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

/** the axis's length in minutes, a folded stretch counted at the width it is drawn */
export function axisMinutes(segs: AxisSegment[]): number {
  const drawn = segs.filter((s) => !s.folded).reduce((n, s) => n + (s.end - s.start), 0) || 1;
  return segs.reduce((n, s) => n + (s.folded ? Math.max(1, drawn * FOLD_WIDTH) : s.end - s.start), 0) / 60_000;
}

/**
 * How wide the chart is drawn, for an axis of `minutes` in a window `room` pixels wide. `fit` puts the whole goal in the
 * window; a number is pixels a minute, the chart sliding sideways when that is wider; unset, it fits unless that is too
 * tight to read (a long goal, a phone), and then slides at a readable scale.
 */
export function chartWidth(minutes: number, room: number, ppm: number | 'fit' | null): { ppm: number; px: number; fit: boolean } {
  const fits = room / Math.max(minutes, 1e-6);
  const px = Math.max(room, minutes * (ppm === 'fit' ? fits : (ppm ?? Math.max(fits, READABLE_PPM))));
  return { ppm: px / Math.max(minutes, 1e-6), px, fit: px <= room + 0.5 };
}
/** the next zoom step in, none past the last */
export const zoomIn = (ppm: number): number | null => PPM.find((p) => p > ppm * 1.01) ?? null;
/** the next zoom step out; once that would be narrower than the window, the whole goal fits it */
export function zoomOut(ppm: number, fits: number): number | 'fit' {
  const p = [...PPM].reverse().find((x) => x < ppm * 0.99);
  return p == null || p <= fits ? 'fit' : p;
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
/** the chart's window: how wide it is and how far the track is slid */
type Port = { room: number; left: number };

/**
 * The track's scroll handler. It reads the position while the event lasts: React runs a state update later, once it has
 * set the event's currentTarget back to null, and reading it there threw and took the page down.
 */
export const onTrackScroll = (set: Dispatch<SetStateAction<Port>>) => (e: UIEvent<HTMLElement>) => {
  const left = e.currentTarget.scrollLeft;
  set((p) => ({ ...p, left }));
};

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Where a goal's time went: the totals and the longest steps, then every step on one time axis, the goal and its
 * Delegated goals together, laid out like a Gantt chart: the rows' names stay on the left, and beside them the chart is
 * a track that slides sideways, with a rail under it showing the whole goal and framing the part in view. It fits the
 * width unless that is too tight to read; a stretch in which nothing ran folds; a bar or a row's name opens what it was,
 * and its task.
 */
export function TimelineView({ t, onOpenTask }: { t: GoalTimeline; onOpenTask?: (taskId: string) => void }) {
  const [ppm, setPpm] = useState<number | 'fit' | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const track = useRef<HTMLDivElement>(null);
  // the chart's window: how wide it is and how far the track is slid (0 until measured in the page)
  const [port, setPort] = useState<Port>({ room: 0, left: 0 });
  const segs = axisSegments(t);
  const x = axisScale(segs);
  const minutes = axisMinutes(segs);
  const t0 = Date.parse(t.start);
  const drawn = segs.filter((s) => !s.folded).reduce((n, s) => n + (s.end - s.start), 0);
  const chart = port.room > 0 ? chartWidth(minutes, port.room, ppm) : null;
  // marks at least 64px apart once the window is measured; before that (and on a server) at most 8
  const step = (chart ? (AXIS_STEPS.find((s) => s * chart.ppm >= 64) ?? 2880) : axisStep(drawn || 1, 8)) * 60_000;
  // the marks fall on round times since the start, only where the axis is to scale
  const marks = segs.filter((s) => !s.folded).flatMap((s) => {
    const out: number[] = [];
    for (let m = Math.ceil((s.start - t0) / step) * step; t0 + m <= s.end; m += step) out.push(m);
    return out;
  });
  const sessions = (['work', 'review', 'clarify', 'merge', 'other'] as const).filter((k) => t.totals[k] > 0);
  const used = new Set(t.rows.flatMap((r) => r.spans.map((s) => s.kind)));
  const open = (e: MouseEvent, row: TimelineRow, span: TimelineSpan | null) => setCtx({ row, span, x: e.clientX, y: e.clientY });
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => setPort({ room: el.clientWidth, left: el.scrollLeft });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // a zoom keeps the moment in the middle of the window where it is; a goal still working opens on now, at the end
  const centre = useRef<number | null>(null);
  const opened = useRef(false);
  useIsoLayoutEffect(() => {
    const el = track.current;
    if (!el || !chart) return;
    if (centre.current != null) el.scrollLeft = centre.current * chart.px - el.clientWidth / 2;
    else if (!opened.current && t.live) el.scrollLeft = el.scrollWidth;
    centre.current = null;
    opened.current = true;
  }, [chart?.px]);
  const zoom = (next: number | 'fit') => {
    const el = track.current;
    if (el && chart && chartWidth(minutes, port.room, next).px !== chart.px) centre.current = (el.scrollLeft + el.clientWidth / 2) / chart.px;
    setPpm(next);
  };
  const slide = (at: number) => {
    const el = track.current;
    if (el && chart) el.scrollLeft = Math.max(0, at) * chart.px;
  };
  const zoomedIn = chart ? zoomIn(chart.ppm) : null;
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
        {/* the chart's toolbar: what the colours mean, and the zoom */}
        <div className="mb-3 flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-400">
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
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-zinc-400">
            <Button size="sm" variant="ghost" className="px-1.5" disabled={!chart || chart.fit} onClick={() => chart && zoom(zoomOut(chart.ppm, port.room / minutes))} aria-label="zoom out" title="Zoom out">
              <Minus size={12} />
            </Button>
            <button type="button" className={cn('mono w-10 text-center hover:text-zinc-100', chart?.fit && 'text-emerald-300')} onClick={() => zoom('fit')} title="Fit the whole goal in the width">
              fit
            </button>
            <Button size="sm" variant="ghost" className="px-1.5" disabled={!!chart && zoomedIn == null} onClick={() => zoomedIn != null && zoom(zoomedIn)} aria-label="zoom in" title="Zoom in (the chart slides sideways)">
              <Plus size={12} />
            </Button>
          </span>
        </div>
        <div className="flex">
          {/* the rows' names stay while the chart slides; a phone gives every button 32px, so every row is 32px there */}
          <div className="w-28 sm:w-56 shrink-0 pr-2 sm:pr-3">
            <div className="h-5 border-b border-zinc-800" />
            {t.rows.map((r) => {
              const head = r.kind === 'goal' || r.kind === 'delegated';
              return (
                <button key={r.id} type="button" onClick={(e) => open(e, r, null)} className={cn('block h-8 sm:h-7 w-full truncate border-b border-zinc-800/50 text-left text-[11px] sm:text-xs hover:text-zinc-50', INDENT[Math.min(r.level, 3)], head ? 'font-medium text-zinc-100' : r.kind === 'sessions' ? 'italic text-zinc-400' : 'text-zinc-300')} title={r.label}>
                  {r.kind === 'delegated' ? '↳ ' : ''}
                  {r.label}
                </button>
              );
            })}
          </div>
          {/* the track: it slides under a finger or a trackpad, and with the rail below; its own scrollbar is the rail */}
          <div ref={track} onScroll={onTrackScroll(setPort)} className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div style={{ width: chart ? `${chart.px}px` : '100%' }}>
              <div className="relative h-5 border-b border-zinc-800">
                {marks.map((m) => {
                  // centred on its time, but the first and last mark stay inside the chart, which clips what sticks out
                  const at = x(t0 + m);
                  return (
                    <span key={m} className={cn('absolute top-0 whitespace-nowrap text-[10px] tabular-nums text-zinc-500', at < 3 ? '' : at > 97 ? '-translate-x-full' : '-translate-x-1/2')} style={{ left: `${at}%` }}>
                      {m === 0 ? '0' : fmtDur(m)}
                    </span>
                  );
                })}
                {segs.filter((s) => s.folded).map((s) => (
                  <span key={s.start} className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px] text-zinc-500" style={{ left: `${(x(s.start) + x(s.end)) / 2}%` }} title={`nothing ran for ${fmtDur(s.end - s.start)}`}>
                    ⋯ {fmtDur(s.end - s.start)}
                  </span>
                ))}
              </div>
              <div className="relative">
                {/* the grid: a line down from every mark */}
                {marks.map((m) => (
                  <span key={m} className="pointer-events-none absolute inset-y-0 w-px bg-zinc-800/60" style={{ left: `${x(t0 + m)}%` }} />
                ))}
                {t.rows.map((r) => {
                  const head = r.kind === 'goal' || r.kind === 'delegated';
                  return (
                    <div key={r.id} className={cn('relative h-8 sm:h-7 border-b border-zinc-800/50', head && 'bg-zinc-800/20')}>
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
                            className={cn('absolute rounded-sm hover:brightness-125', KIND[s.kind].color, thin ? 'top-3.5 sm:top-3 h-1 opacity-60' : 'top-2 sm:top-1.5 h-4', s.open && 'ring-1 ring-emerald-300/70')}
                            // minHeight: a phone's 32px button height would make every bar as tall as its row
                            style={{ left: `${left}%`, width: `${width}%`, minHeight: 0, ...(s.kind === 'waiting' ? STRIPES : {}) }}
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
        </div>
        {chart && !chart.fit && (
          <div className="flex items-center mt-2">
            <div className="w-28 sm:w-56 shrink-0 pr-2 sm:pr-3 text-[10px] text-zinc-500">the whole goal</div>
            <Rail share={port.room / chart.px} at={port.left / chart.px} onMove={slide}>
              {segs.filter((s) => s.folded).map((s) => (
                <span key={s.start} className="absolute inset-y-0" style={{ left: `${x(s.start)}%`, width: `${x(s.end) - x(s.start)}%`, ...FOLDED }} />
              ))}
              {t.rows.map((r, i) =>
                r.spans
                  .filter((s) => !(s.kind === 'run' && (r.kind === 'goal' || r.kind === 'delegated')))
                  .map((s, j) => {
                    const left = x(Date.parse(s.start));
                    return <span key={`${i}-${j}`} className={cn('absolute h-0.5 rounded-full', KIND[s.kind].color)} style={{ left: `${left}%`, width: `${Math.max(0.4, x(Date.parse(s.end)) - left)}%`, top: `${3 + (i / Math.max(1, t.rows.length)) * 21}px` }} />;
                  }),
              )}
            </Rail>
          </div>
        )}
      </Card>
      {ctx && <SpanDetails ctx={ctx} goalId={t.goalId} onOpenTask={onOpenTask} onClose={() => setCtx(null)} />}
    </div>
  );
}

/**
 * The slide rail under a chart wider than its window: the whole goal in miniature (`children`), the part in view framed.
 * Drag the frame, or press anywhere on the rail, and the chart slides there. `share` is the window's share of the chart,
 * `at` where the window starts, both 0 to 1.
 */
function Rail({ share, at, onMove, children }: { share: number; at: number; onMove: (at: number) => void; children: ReactNode }) {
  const rail = useRef<HTMLDivElement>(null);
  // where on the frame it was taken, as a share of the rail; null when not held
  const held = useRef<number | null>(null);
  const pos = (e: PointerEvent) => {
    const r = rail.current!.getBoundingClientRect();
    return (e.clientX - r.left) / r.width;
  };
  const end = () => (held.current = null);
  return (
    <div
      ref={rail}
      role="scrollbar"
      aria-orientation="horizontal"
      aria-label="Slide along the timeline"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((at / Math.max(1e-6, 1 - share)) * 100)}
      className="relative h-7 min-w-0 flex-1 cursor-pointer touch-none select-none overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/40"
      onPointerDown={(e) => {
        const p = pos(e);
        held.current = p >= at && p <= at + share ? p - at : share / 2;
        e.currentTarget.setPointerCapture(e.pointerId);
        onMove(p - held.current);
      }}
      onPointerMove={(e) => held.current != null && onMove(pos(e) - held.current)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {children}
      <div className="pointer-events-none absolute inset-y-0 rounded-md border-2 border-emerald-400/70 bg-emerald-400/10" style={{ left: `${at * 100}%`, width: `${share * 100}%` }} />
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
