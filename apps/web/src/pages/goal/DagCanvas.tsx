import type { Task } from '@foundry/core/browser';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TaskTags } from '../../components/TaskTags.tsx';
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

const STROKE: Record<string, string> = { done: '#34d399', running: '#60a5fa', observing: '#a78bfa', merging: '#e879f9', blocked: '#fb923c', failed: '#f87171', skipped: '#71717a', ready: '#38bdf8', pending: '#52525b' };

export interface DagTask extends Task {
  depth: number;
  attempts: number;
  maxAttempts: number;
  lastCost: number | null;
  /** Brief mode: no run state yet — show this chip (the Area) instead of the state badge and attempt count */
  plain?: { label: string | null; color: string };
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

  if (!tasks.length) return <div className="text-sm text-zinc-500 py-8 text-center">No tasks yet.</div>;

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
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">Step {depth + 1}</div>
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
                        stroke={STROKE[e.state] ?? '#52525b'}
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
  return (
    <button
      onClick={() => onSelect(selected ? null : t.id)}
      style={style}
      className={cn('dag-node text-left rounded-lg border p-2.5 bg-zinc-950 hover:border-zinc-500 transition', selected ? 'border-emerald-500 ring-1 ring-emerald-500/40' : linked ? 'border-zinc-400 ring-1 ring-zinc-400/30' : 'border-zinc-800', t.state === 'running' && 'ring-1 ring-blue-500/40', dim && 'opacity-40', className)}
    >
      <div className="flex items-center justify-between gap-2">
        {t.plain ? (
          <span className="text-[10px] text-zinc-400 flex items-center gap-1.5 min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.plain.color }} />
            <span className="truncate">{t.plain.label ?? 'unassigned'}</span>
          </span>
        ) : (
          <Badge state={t.state} />
        )}
        <span className="text-[10px] text-zinc-500 mono whitespace-nowrap">
          {t.plain ? t.id : `${t.attempts}/${t.maxAttempts}`}
          {!t.plain && t.lastCost != null && <span className="ml-1">{fmtUsd(t.lastCost)}</span>}
          {t.origin !== 'brief' && <span className="ml-1 text-zinc-600">{t.origin}</span>}
        </span>
      </div>
      <div className="text-[13px] mt-1.5 text-zinc-100 leading-snug">{t.title}</div>
      <div className="mt-1 flex items-center gap-x-1.5 gap-y-1 flex-wrap">
        <TaskTags kind={t.kind} scenario={t.scenario} area={t.plain ? null : t.area} />
        {t.worktreePath && t.state !== 'done' && <span className="text-[10px] text-zinc-500 whitespace-nowrap">own worktree</span>}
      </div>
      {after && after.length > 0 && <div className="text-[10px] text-zinc-500 mt-1 truncate">after: {after.join(', ')}</div>}
    </button>
  );
}
