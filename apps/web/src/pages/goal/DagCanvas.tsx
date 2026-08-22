import type { Task } from '@ai-engine/core/browser';
import { useMemo } from 'react';
import { useElementWidth } from '../../hooks/useElementWidth.ts';
import { Badge, cn, fmtUsd } from '../../ui.tsx';

const MIN_W = 236;
const MAX_W = 480;
const H = 92;
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
}

/**
 * Tasks laid out in columns by depth, with SVG dependency edges.
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

  const layout = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    let maxRows = 0;
    for (const [d, ts] of cols) {
      maxRows = Math.max(maxRows, ts.length);
      ts.forEach((t, i) => pos.set(t.id, { x: d * (nodeW + GX), y: i * (H + GY) }));
    }
    const width = nCols * (nodeW + GX) - GX;
    const height = Math.max(1, maxRows) * (H + GY) - GY;
    const edges = tasks.flatMap((t) => t.dependsOn.map((d) => ({ from: pos.get(d), to: pos.get(t.id), state: tasks.find((x) => x.id === d)?.state ?? 'pending' })).filter((e) => e.from && e.to)) as { from: { x: number; y: number }; to: { x: number; y: number }; state: string }[];
    return { pos, width, height, edges };
  }, [tasks, cols, nodeW, nCols]);

  if (!tasks.length) return <div className="text-sm text-zinc-500 py-8 text-center">No tasks yet.</div>;

  const listMode = cw > 0 && cw < LIST_BREAKPOINT;
  const byId = new Map(tasks.map((t) => [t.id, t]));

  return (
    <div ref={ref} className="w-full">
      {listMode ? (
        <div className="space-y-4">
          {[...cols.entries()]
            .sort(([a], [b]) => a - b)
            .map(([depth, ts]) => (
              <div key={depth}>
                <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">Step {depth + 1}</div>
                <div className="space-y-2">
                  {ts.map((t) => (
                    <TaskNode key={t.id} t={t} selected={selected === t.id} onSelect={onSelect} className="w-full" style={{ minHeight: H }} after={t.dependsOn.map((d) => byId.get(d)?.title ?? d)} />
                  ))}
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div className="overflow-auto pb-2">
          <div className="relative" style={{ width: layout.width, height: layout.height }}>
            <svg className="absolute inset-0 pointer-events-none" width={layout.width} height={layout.height}>
              {layout.edges.map((e, i) => {
                const x1 = e.from.x + nodeW;
                const y1 = e.from.y + H / 2;
                const x2 = e.to.x;
                const y2 = e.to.y + H / 2;
                const c = (x2 - x1) / 2;
                return <path key={i} d={`M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`} fill="none" stroke={STROKE[e.state] ?? '#52525b'} strokeWidth={1.5} strokeOpacity={0.8} />;
              })}
            </svg>
            {tasks.map((t) => {
              const p = layout.pos.get(t.id)!;
              return <TaskNode key={t.id} t={t} selected={selected === t.id} onSelect={onSelect} className="absolute" style={{ left: p.x, top: p.y, width: nodeW, height: H }} />;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskNode({ t, selected, onSelect, className, style, after }: { t: DagTask; selected: boolean; onSelect: (id: string | null) => void; className?: string; style?: React.CSSProperties; after?: string[] }) {
  return (
    <button
      onClick={() => onSelect(selected ? null : t.id)}
      style={style}
      className={cn('text-left rounded-lg border p-2.5 bg-zinc-950/80 hover:border-zinc-500 transition', selected ? 'border-emerald-500 ring-1 ring-emerald-500/40' : 'border-zinc-800', t.state === 'running' && 'ring-1 ring-blue-500/40', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <Badge state={t.state} />
        <span className="text-[10px] text-zinc-500 mono">
          {t.attempts}/{t.maxAttempts}
          {t.origin !== 'brief' && <span className="ml-1 text-zinc-600">{t.origin}</span>}
        </span>
      </div>
      <div className="text-[13px] mt-1.5 text-zinc-100 line-clamp-2 leading-snug">{t.title}</div>
      <div className="text-[10px] text-zinc-500 mt-1 flex gap-2 flex-wrap">
        {t.worktreePath && <span>own worktree</span>}
        {t.lastCost != null && <span>{fmtUsd(t.lastCost)}</span>}
        {after && after.length > 0 && <span className="truncate">after: {after.join(', ')}</span>}
      </div>
    </button>
  );
}
