import type { Task } from '@foundry/core/browser';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DelegatedView } from '../../api.ts';
import { TaskTags } from '../../components/TaskTags.tsx';
import { markFill, taskMark } from '../../components/progress.tsx';
import { useElementWidth } from '../../hooks/useElementWidth.ts';
import { Badge, cn, fmtUsd } from '../../ui.tsx';

const MIN_W = 236;
const MAX_W = 480;
/** cards grow with their content; this only keeps near-empty ones from looking squashed */
const MIN_H = 88;
const GX = 72;
const GY = 18;
/** below this container width the graph is rendered as a vertical list */
const LIST_BREAKPOINT = 640;

/**
 * an edge takes the colour of the task it leaves, in the theme's names (as its state badge has them): green once that
 * task is done, blue while it runs or is ready, violet while it is reviewed or merged, yellow when it waits for you, red
 * when it failed, grey before it can start
 */
const STROKE: Record<string, string> = { done: 'var(--color-ok)', running: 'var(--color-work)', observing: 'var(--color-extra)', merging: 'var(--color-extra)', blocked: 'var(--color-you)', failed: 'var(--color-bad)', skipped: 'var(--color-line-strong)', ready: 'var(--color-work)', pending: 'var(--color-line-strong)' };

export interface DagTask extends Task {
  depth: number;
  attempts: number;
  maxAttempts: number;
  /** every attempt and review of the task so far, as in the task drawer */
  totalCost: number | null;
  /** sessions that ended before a cost was reported: `totalCost` leaves them out */
  unmeasured?: number;
  /** the model the latest worker session ran on (short name), once one ran */
  model?: string | null;
  /** wall-clock minutes from its first attempt's start to now or its last session's end; null before it started */
  minutes?: number | null;
  /** Brief mode: no run state yet — show this chip (the Area) instead of the state badge and attempt count */
  plain?: { label: string | null; color: string };
  /** a goal task: where its Delegated goal stands, once it exists */
  delegated?: DelegatedView;
}

/** "3/5 tasks done" of a Delegated goal, from its task counts */
export function delegatedProgress(counts: Record<string, number>): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return total ? `${counts.done ?? 0}/${total} tasks done` : 'no tasks yet';
}

interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  state: string;
  from: string;
  to: string;
}

/**
 * Tasks laid out in columns by depth, with SVG dependency edges. Cards size to their content:
 * columns are normal flex flow, and edge anchors are measured from the DOM after layout
 * (re-measured on resize), so nothing is clipped by a guessed fixed height.
 * Column width stretches to fill the container (so a single task is not a narrow box hugging the left edge);
 * on narrow containers the graph degrades to a vertical list grouped by step.
 */
export function DagCanvas({ tasks, selected, onSelect }: { tasks: DagTask[]; selected: string | null; onSelect: (id: string | null) => void }) {
  const { ref, width: cw } = useElementWidth<HTMLDivElement>();
  const cols = useMemo(() => {
    const m = new Map<number, DagTask[]>();
    for (const t of tasks) m.set(t.depth, [...(m.get(t.depth) ?? []), t]);
    return m;
  }, [tasks]);
  const nCols = cols.size ? Math.max(...cols.keys()) + 1 : 1;
  // fill the available width, but keep nodes between MIN_W and MAX_W
  const nodeW = cw > 0 ? Math.max(MIN_W, Math.min(MAX_W, Math.floor((cw - (nCols - 1) * GX) / nCols))) : MIN_W;
  const listMode = cw > 0 && cw < LIST_BREAKPOINT;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const [edges, setEdges] = useState<Edge[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (listMode) return;
    const measure = () => {
      const stateOf = new Map(tasks.map((t) => [t.id, t.state]));
      const next: Edge[] = [];
      for (const t of tasks)
        for (const d of t.dependsOn) {
          const from = nodeRefs.current.get(d);
          const to = nodeRefs.current.get(t.id);
          if (!from || !to) continue;
          next.push({ x1: from.offsetLeft + from.offsetWidth, y1: from.offsetTop + from.offsetHeight / 2, x2: to.offsetLeft, y2: to.offsetTop + to.offsetHeight / 2, state: stateOf.get(d) ?? 'pending', from: d, to: t.id });
        }
      setEdges(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    for (const el of nodeRefs.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [tasks, nodeW, listMode]);

  if (!tasks.length) return <div className="text-sm text-ink-faint py-8 text-center">No tasks yet.</div>;

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const sorted = [...cols.entries()].sort(([a], [b]) => a - b);

  // focused task (hover wins over selection) and its direct neighbourhood: those cards and edges pop, the rest fade
  const focus = hovered ?? selected;
  let related: Set<string> | null = null;
  if (focus) {
    related = new Set([focus]);
    for (const t of tasks) {
      if (t.id === focus) for (const d of t.dependsOn) related.add(d);
      if (t.dependsOn.includes(focus)) related.add(t.id);
    }
  }

  return (
    <div ref={ref} className="w-full">
      {listMode ? (
        <div className="space-y-4">
          {sorted.map(([depth, ts]) => (
            <div key={depth}>
              <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-faint mb-2">Step {depth + 1}</div>
              <div className="space-y-2">
                {ts.map((t) => (
                  <TaskNode key={t.id} t={t} selected={selected === t.id} onSelect={onSelect} className="w-full" style={{ minHeight: MIN_H }} after={t.dependsOn.map((d) => byId.get(d)?.title ?? d)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-auto pb-2">
          <div ref={wrapRef} className="relative w-max">
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {(() => {
                const active = (e: Edge) => focus != null && (e.from === focus || e.to === focus);
                return [...edges]
                  .sort((a, b) => Number(active(a)) - Number(active(b)))
                  .map((e) => {
                    const c = (e.x2 - e.x1) / 2;
                    return (
                      <path
                        key={`${e.from}-${e.to}`}
                        d={`M ${e.x1} ${e.y1} C ${e.x1 + c} ${e.y1}, ${e.x2 - c} ${e.y2}, ${e.x2} ${e.y2}`}
                        fill="none"
                        // a style, not the stroke attribute: the theme's colours are CSS variables
                        style={{ stroke: STROKE[e.state] ?? 'var(--color-line-strong)' }}
                        strokeWidth={active(e) ? 2.5 : 1.5}
                        strokeOpacity={active(e) ? 1 : focus ? 0.15 : 0.55}
                      />
                    );
                  });
              })()}
            </svg>
            {/* positioned, and after the svg in the DOM: the cards paint over the edges, so lines only show in the gaps */}
            <div className="relative flex items-start" style={{ columnGap: GX }}>
              {sorted.map(([depth, ts]) => (
                <div key={depth} className="flex flex-col" style={{ width: nodeW, rowGap: GY }}>
                  {ts.map((t) => (
                    <div
                      key={t.id}
                      ref={(el) => {
                        if (el) nodeRefs.current.set(t.id, el);
                        else nodeRefs.current.delete(t.id);
                      }}
                      onMouseEnter={() => setHovered(t.id)}
                      onMouseLeave={() => setHovered((h) => (h === t.id ? null : h))}
                    >
                      <TaskNode t={t} selected={selected === t.id} onSelect={onSelect} linked={related != null && related.has(t.id) && t.id !== focus} dim={related != null && !related.has(t.id)} className="w-full" style={{ minHeight: MIN_H }} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskNode({ t, selected, linked, dim, onSelect, className, style, after }: { t: DagTask; selected: boolean; linked?: boolean; dim?: boolean; onSelect: (id: string | null) => void; className?: string; style?: React.CSSProperties; after?: string[] }) {
  const nav = useNavigate();
  const goalTask = t.kind === 'goal' && !t.plain;
  const open = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (t.delegated?.exists) nav(`/goals/${t.delegated.goalId}`);
  };
  const mark = t.plain ? null : taskMark(t.state);
  const waiting = t.state === 'pending' || t.state === 'ready';
  return (
    <button
      onClick={() => onSelect(selected ? null : t.id)}
      style={style}
      // a panel card: the chosen one ringed in the accent, its neighbours outlined; one under way carries a flowing hatch
      className={cn('relative overflow-hidden text-left rounded-lg border bg-panel p-3 shadow-[0_1px_2px_rgb(0_0_0/0.06)] transition-[border-color,box-shadow,opacity]', selected ? 'border-accent ring-2 ring-accent' : linked ? 'border-line-strong ring-1 ring-line-strong' : 'border-line hover:border-line-strong', t.kind === 'goal' && 'border-dashed', dim && 'opacity-40', className)}
    >
      {mark === 'run' && <i aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5 hatch text-ink" />}
      <div className="flex items-center justify-between gap-2">
        {t.plain ? (
          <span className="text-[11px] font-semibold text-ink-soft flex items-center gap-1.5 min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.plain.color }} />
            <span className="truncate">{t.plain.label ?? 'unassigned'}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 min-w-0">
            <i aria-hidden="true" className={cn('block h-3 w-3 shrink-0 rounded-[3px]', markFill[mark!])} />
            <Badge state={t.state} />
          </span>
        )}
        <span className="text-[11px] text-ink-faint mono whitespace-nowrap">
          {t.plain ? t.id : `${t.attempts}/${t.maxAttempts}`}
          {!t.plain && t.totalCost != null && (
            <span className="ml-1.5 font-semibold text-ink-soft" title={t.unmeasured ? `cost of this task so far, all attempts — ${t.unmeasured} session${t.unmeasured === 1 ? '' : 's'} ended before a cost was reported: unknown, not $0, and missing here` : 'cost of this task so far, all attempts'}>
              {fmtUsd(t.totalCost)}
              {t.unmeasured ? <span className="font-bold text-ink">+?</span> : null}
            </span>
          )}
          {t.origin !== 'brief' && <span className="ml-1.5 text-ink-faint">{t.origin}</span>}
        </span>
      </div>
      <div className={cn('mt-2 text-[14px] leading-snug', waiting && !t.plain ? 'font-semibold text-ink-soft' : 'font-bold text-ink')}>{t.title}</div>
      <div className="mt-1.5 flex items-center gap-x-1.5 gap-y-1 flex-wrap">
        <TaskTags kind={t.kind} scenario={t.scenario} area={t.plain ? null : t.area} difficulty={t.difficulty} />
        {t.model && <span className="mono text-[11px] text-ink-faint whitespace-nowrap" title="The model the latest attempt ran on (the difficulty picks it from the preset)">{t.model}</span>}
        {t.worktreePath && t.state !== 'done' && <span className="text-[11px] text-ink-faint whitespace-nowrap">own worktree</span>}
        {!t.parallelizable && !t.plain && !['done', 'skipped', 'failed'].includes(t.state) && (
          <span className="rounded-sm px-1.5 py-px text-[10.5px] font-semibold leading-tight text-ink-soft ring-1 ring-inset ring-line-strong whitespace-nowrap" title="Marked not parallelizable in the Brief: it starts only when no other task of the goal is running. A wait, not a dependency, so no line leads to it.">
            runs alone
          </span>
        )}
      </div>
      {goalTask && (
        // the card of a step done by a Delegated goal: where that goal stands, and the way to it
        <div className="mt-2 text-[11px] flex items-center gap-x-2 gap-y-1 flex-wrap">
          {t.delegated ? (
            t.delegated.exists ? (
              <>
                <Badge state={t.delegated.state ?? 'pending'} />
                <span className="text-ink-soft">{delegatedProgress(t.delegated.taskCounts)}</span>
                {t.delegated.needsYou && <span className="rounded-[4px] bg-you px-1.5 py-px font-bold text-on-you" title={t.delegated.needsYou}>needs you</span>}
                <span role="link" tabIndex={0} className="font-semibold text-work-ink hover:underline cursor-pointer" onClick={open} onKeyDown={(e) => e.key === 'Enter' && open(e)}>
                  Open goal →
                </span>
              </>
            ) : (
              <span className="text-ink-faint">its goal was deleted</span>
            )
          ) : (
            <span className="text-ink-faint">{t.state === 'pending' || t.state === 'ready' ? 'starts as a goal of its own' : 'its goal is being created'}</span>
          )}
        </div>
      )}
      {after && after.length > 0 && <div className="text-[11px] text-ink-faint mt-1.5 truncate">after: {after.join(', ')}</div>}
    </button>
  );
}
