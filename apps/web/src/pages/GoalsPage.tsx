import { type ReactNode, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Folder } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type GoalRow } from '../api.ts';
import { SetupBanner } from '../components/SetupBanner.tsx';
import { UsagePausedBanner } from '../components/UsageBanner.tsx';
import { ProviderBadge, shortCwd } from './agents/rows.tsx';
import { useLive } from '../store.ts';
import { Badge, Button, Empty, ago, fmtLimitMin, fmtLimitUsd, fmtUsd } from '../ui.tsx';

/** Trait chip (nature, pace, view mode): same height and type size as the state badge, pill-shaped to read as secondary. */
function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] leading-none ${className ?? ''}`}>{children}</span>;
}

export function GoalsPage() {
  const [goals, setGoals] = useState<GoalRow[] | null>(null);
  const version = useLive((s) => s.globalVersion);
  const [params, setParams] = useSearchParams();
  const [size, setSize] = useState(savedSize);
  useEffect(() => {
    const t = setTimeout(() => api.goals().then(setGoals).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [version]);

  const href = (g: GoalRow) => (g.state === 'awaiting_brief_approval' ? `/goals/${g.id}/brief` : `/goals/${g.id}`);
  /** state badge + the goal's trait chips, one consistent row (same height, same gaps) everywhere */
  const stateCell = (g: GoalRow, wrap = false) => (
    <span className={`inline-flex items-center gap-1.5 ${wrap ? 'flex-wrap justify-end' : ''}`}>
      <Badge state={g.state} />
      {g.mode === 'simple' && <Chip className="border-zinc-700 text-zinc-400">simple</Chip>}
      {g.nature !== 'auto' && g.nature !== 'code' && <Chip className="border-sky-800 text-sky-300">{g.nature}</Chip>}
      {g.workflow.pace === 'fast' && <Chip className="border-amber-800 text-amber-300">fast</Chip>}
      {g.openEscalations > 0 && <span className="text-orange-400 text-xs whitespace-nowrap">⚠ {g.openEscalations}</span>}
    </span>
  );
  /** the list stays flat by time; a Follow-up names the goal it follows */
  const followsTag = (g: GoalRow) =>
    g.follows ? (
      <div className="text-[11px] text-zinc-500 truncate max-w-[70vw] sm:max-w-[40vw]" title={`follows ${g.follows.title}`}>
        ↳ follows {g.follows.title}
      </div>
    ) : null;
  const taskSummary = (g: GoalRow) =>
    Object.entries(g.taskCounts)
      .map(([k, v]) => `${v} ${k}`)
      .join(' · ') || 'no tasks yet';
  const cost = (g: GoalRow) =>
    g.provider === 'codex' ? <span className="font-sans text-zinc-400">cost unavailable</span> : <>{fmtUsd(g.costUsd)} <span className="text-zinc-500">/ {fmtLimitUsd(g.budgets.maxCostUsd)}</span></>;

  const pages = Math.max(1, Math.ceil((goals?.length ?? 0) / size));
  const page = Math.min(pages, Math.max(1, Number(params.get('page')) || 1));
  const shown = goals?.slice((page - 1) * size, page * size) ?? [];
  const go = (n: number) => setParams(n > 1 ? { page: String(n) } : {});
  const resize = (n: number) => {
    setSize(n);
    try {
      localStorage.setItem(SIZE_KEY, String(n));
    } catch {}
    go(1);
  };

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6">
      <SetupBanner />
      <div className="mb-3">
        <UsagePausedBanner />
      </div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Goals</h1>
        <Link to="/goals/new">
          <Button variant="primary">New goal</Button>
        </Link>
      </div>
      {!goals ? (
        <Empty>Loading…</Empty>
      ) : goals.length === 0 ? (
        <Empty>No goals yet. Create one to start.</Empty>
      ) : (
        <>
          {/* one row per goal, related facts stacked: what and where · state and progress · spend · when */}
          <ul className="surface-card rounded-lg border border-zinc-800 divide-y divide-zinc-800">
            {shown.map((g) => (
              <li key={g.id} className="relative grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)] md:grid-cols-[minmax(0,1fr)_minmax(0,15rem)_9rem_6.5rem] gap-x-4 gap-y-2 px-3 sm:px-4 py-3 hover:bg-zinc-900/60">
                <div className="min-w-0">
                  {/* the title link covers the whole row */}
                  <Link to={href(g)} className="text-sm text-zinc-100 leading-snug hover:underline after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-emerald-500">{g.title}</Link>
                  <div className="mt-1 flex items-center gap-2 min-w-0 text-[11px] text-zinc-500">
                    <ProviderBadge provider={g.provider} />
                    <Folder size={11} className="shrink-0" aria-hidden="true" />
                    <span className="mono truncate" title={g.repoPath}>{shortCwd(g.repoPath)}</span>
                  </div>
                  {followsTag(g)}
                </div>
                <div className="min-w-0 space-y-1.5">
                  {stateCell(g)}
                  <div className="text-[11px] text-zinc-400 truncate" title={taskSummary(g)}>{taskSummary(g)}</div>
                </div>
                <div className="hidden md:block text-xs space-y-1.5">
                  <div className="mono whitespace-nowrap">{cost(g)}</div>
                  <div className="text-[11px] text-zinc-500 whitespace-nowrap">{g.budget.elapsedMin.toFixed(0)} / {fmtLimitMin(g.budgets.maxDurationMin)}</div>
                </div>
                <div className="hidden md:block text-xs text-zinc-500 text-right space-y-1.5">
                  <div className="whitespace-nowrap" title={new Date(g.updatedAt).toLocaleString()}>{ago(g.updatedAt)}</div>
                  <div className="text-[11px] whitespace-nowrap" title={new Date(g.createdAt).toLocaleString()}>created {new Date(g.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                </div>
                {/* below md the spend and time fold into one line */}
                <div className="md:hidden sm:col-span-2 flex items-center gap-3 flex-wrap text-[11px] text-zinc-500">
                  <span className="mono">{cost(g)}</span>
                  <span>{g.budget.elapsedMin.toFixed(0)} / {fmtLimitMin(g.budgets.maxDurationMin)}</span>
                  <span>{ago(g.updatedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
          {/* always shown: how many there are, how many per page, and where you are */}
          <nav className="mt-3 flex items-center justify-between gap-x-3 gap-y-2 flex-wrap text-xs text-zinc-500" aria-label="Goal pages">
            <span className="flex items-center gap-2">
              <span className="tabular-nums">
                {(page - 1) * size + 1}–{Math.min(page * size, goals.length)} of {goals.length} goals
              </span>
              <label className="flex items-center gap-1">
                <span className="sr-only">Goals per page</span>
                <select value={size} onChange={(e) => resize(Number(e.target.value))} className="rounded border border-zinc-800 bg-zinc-950/50 px-1.5 py-0.5 text-xs text-zinc-300">
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n} per page
                    </option>
                  ))}
                </select>
              </label>
            </span>
            {pages > 1 && (
              <span className="flex items-center gap-1">
                <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => go(page - 1)} aria-label="Previous page"><ChevronLeft size={14} /></Button>
                <span className="tabular-nums px-1">Page {page} of {pages}</span>
                <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => go(page + 1)} aria-label="Next page"><ChevronRight size={14} /></Button>
              </span>
            )}
          </nav>
        </>
      )}
    </div>
  );
}

const PAGE_SIZES = [10, 20, 50];
const SIZE_KEY = 'foundry.goals.pageSize';
function savedSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return PAGE_SIZES.includes(n) ? n : 10;
  } catch {
    return 10;
  }
}
