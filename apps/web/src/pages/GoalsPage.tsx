import { FOLLOWABLE_STATES, reportsDollars } from '@foundry/core/browser';
import { type ReactNode, useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, CornerDownRight, Folder } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type GoalRow } from '../api.ts';
import { SetupBanner } from '../components/SetupBanner.tsx';
import { UsagePausedBanner } from '../components/UsageBanner.tsx';
import { ProviderBadge, shortCwd } from './agents/rows.tsx';
import { listEntries, type GoalChain } from './goal-chains.ts';
import { useLive } from '../store.ts';
import { Badge, Button, Empty, ago, cn, fmtLimitMin, fmtLimitUsd, fmtUsd } from '../ui.tsx';

/** Trait chip (nature, pace, view mode): same height and type size as the state badge, pill-shaped to read as secondary. */
function Chip({ className, children, title }: { className?: string; children: ReactNode; title?: string }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] leading-none ${className ?? ''}`} title={title}>{children}</span>;
}

export function GoalsPage() {
  const [goals, setGoals] = useState<GoalRow[] | null>(null);
  const version = useLive((s) => s.globalVersion);
  const [params, setParams] = useSearchParams();
  const [size, setSize] = useState(savedSize);
  // main goals whose Delegated goals are shown under them (folded by default)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // follow-up chains folded (true) or opened (false) by hand, by their first goal; the others open while a goal in them is under way
  const [folded, setFolded] = useState<Record<string, boolean>>(readFolded);
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
      {g.workflow.profile && g.workflow.profile !== 'mattpocock' && <Chip className="border-violet-800 text-violet-300">{g.workflow.profile}</Chip>}
      {g.issue && <Chip className="border-sky-900 text-sky-300" title={`from issue ${g.issue.repo}#${g.issue.number}: ${g.issue.title}`}>#{g.issue.number}</Chip>}
      {g.schedule && <Chip className="border-amber-900 text-amber-300" title={`a run of the schedule ${g.schedule.name}`}>⏰ {g.schedule.name}</Chip>}
      {g.openEscalations > 0 && <span className="text-orange-400 text-xs whitespace-nowrap">⚠ {g.openEscalations}</span>}
    </span>
  );
  /** a follow-up whose earlier goal is not shown above it names that goal (a deleted one, or another branch of the chain) */
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
    !reportsDollars(g.provider) ? <span className="font-sans text-zinc-400">cost unavailable</span> : <>{fmtUsd(g.costUsd)} <span className="text-zinc-500">/ {fmtLimitUsd(g.budgets.maxCostUsd)}</span></>;

  // Delegated goals fold under their main goal; one whose main goal is gone stays in the list on its own, saying so
  const ids = new Set((goals ?? []).map((g) => g.id));
  const children = new Map<string, GoalRow[]>();
  for (const g of goals ?? []) {
    if (g.delegatedFrom && ids.has(g.delegatedFrom.goalId)) children.set(g.delegatedFrom.goalId, [...(children.get(g.delegatedFrom.goalId) ?? []), g]);
  }
  const top = (goals ?? []).filter((g) => !(g.delegatedFrom && ids.has(g.delegatedFrom.goalId)));
  // a goal and its follow-ups are one entry, folded like a group on the Agents page; the list pages through entries
  const entries = listEntries(top);
  const chains = entries.flatMap((e) => (e.kind === 'chain' ? [e.chain] : []));
  const grouped = chains.reduce((n, c) => n + c.members.length - 1, 0);
  const underWay = (g: GoalRow) => !FOLLOWABLE_STATES.includes(g.state) || g.openEscalations > 0;
  const isOpen = (c: GoalChain) => (folded[c.id] != null ? !folded[c.id] : c.members.some(underWay));
  const remember = (next: Record<string, boolean>) => {
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify(next));
    } catch {}
    return next;
  };
  const toggleChain = (c: GoalChain) => setFolded((f) => remember({ ...f, [c.id]: isOpen(c) }));
  const setAllChains = (fold: boolean) => setFolded((f) => remember({ ...f, ...Object.fromEntries(chains.map((c) => [c.id, fold])) }));
  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  /** under a main goal: how many Delegated goals it has (click to fold them out); under an orphaned one: whose it was */
  const delegationTag = (g: GoalRow) => {
    const kids = children.get(g.id);
    if (kids?.length) {
      const open = expanded.has(g.id);
      return (
        // above the row's title link (which covers the row), so it toggles instead of opening the goal
        <button type="button" className="relative z-10 text-[11px] text-fuchsia-300 hover:underline" onClick={() => toggle(g.id)} aria-expanded={open}>
          {open ? '▾' : '▸'} {kids.length} delegated goal{kids.length === 1 ? '' : 's'}
        </button>
      );
    }
    if (g.delegatedFrom) {
      return (
        <div className="text-[11px] text-zinc-500 truncate max-w-[70vw] sm:max-w-[40vw]" title={`delegated from ${g.delegatedFrom.title}`}>
          ↳ delegated from a deleted goal · {g.delegatedFrom.title}
        </div>
      );
    }
    return null;
  };

  const pages = Math.max(1, Math.ceil(entries.length / size));
  const page = Math.min(pages, Math.max(1, Number(params.get('page')) || 1));
  const shown = entries.slice((page - 1) * size, page * size);
  const go = (n: number) => setParams(n > 1 ? { page: String(n) } : {});
  const resize = (n: number) => {
    setSize(n);
    try {
      localStorage.setItem(SIZE_KEY, String(n));
    } catch {}
    go(1);
  };

  /**
   * one row per goal, related facts stacked: what and where · state and progress · spend · when. `depth` indents it: a
   * goal of a follow-up chain, or a Delegated goal, under its chain or its main goal; `mark` says which.
   */
  const row = (g: GoalRow, depth: 0 | 1 | 2, mark: 'delegated' | 'follow-up' | null, note: ReactNode = followsTag(g)) => (
    <li key={g.id} className={cn('relative grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)] md:grid-cols-[minmax(0,1fr)_minmax(0,15rem)_9rem_6.5rem] gap-x-4 gap-y-2 px-3 sm:px-4 py-3 hover:bg-zinc-900/60', depth === 1 && 'pl-8 sm:pl-10 bg-zinc-950/40', depth === 2 && 'pl-12 sm:pl-16 bg-zinc-950/60')}>
      <div className="min-w-0">
        {/* the title link covers the whole row */}
        <Link to={href(g)} className="text-sm text-zinc-100 leading-snug hover:underline after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-emerald-500">
          {mark === 'delegated' && <CornerDownRight size={12} className="inline mr-1 text-fuchsia-300" aria-label="delegated goal" />}
          {mark === 'follow-up' && <CornerDownRight size={12} className="inline mr-1 text-sky-300" aria-label="follow-up" />}
          {g.title}
        </Link>
        <div className="mt-1 flex items-center gap-2 min-w-0 text-[11px] text-zinc-500">
          <ProviderBadge provider={g.provider} />
          <Folder size={11} className="shrink-0" aria-hidden="true" />
          <span className="mono truncate" title={g.repoPath}>{shortCwd(g.repoPath)}</span>
        </div>
        {note}
        {mark !== 'delegated' && delegationTag(g)}
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
  );
  /** a goal's row, then its Delegated goals when they are folded out */
  const withDelegated = (g: GoalRow, depth: 0 | 1, mark: 'follow-up' | null, note?: ReactNode) => [row(g, depth, mark, note), ...(expanded.has(g.id) ? (children.get(g.id) ?? []).map((c) => row(c, depth === 0 ? 1 : 2, 'delegated')) : [])];

  /**
   * A goal and its follow-ups as one entry, folded like a group on the Agents page: the first goal names it, the newest
   * says where the work stands, the spend and time are the chain's. Open, it lists each goal's own row, oldest first.
   */
  const chainItem = (c: GoalChain) => {
    const open = isOpen(c);
    const panel = `chain-${c.id}`;
    const providers = [...new Set(c.members.map((m) => m.provider ?? 'claude'))];
    const withDollars = c.members.filter((m) => reportsDollars(m.provider));
    const minutes = c.members.reduce((n, m) => n + m.budget.elapsedMin, 0);
    const updated = c.members.map((m) => m.updatedAt).sort().pop()!;
    const spent = withDollars.length ? (
      <>
        {fmtUsd(withDollars.reduce((n, m) => n + m.costUsd, 0))}
        {withDollars.length < c.members.length && <span className="text-zinc-500" title="goals on a coding agent without dollar costs are left out">*</span>}
      </>
    ) : (
      <span className="font-sans text-zinc-400">cost unavailable</span>
    );
    return (
      <li key={`chain:${c.id}`}>
        <div className="relative grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)] md:grid-cols-[minmax(0,1fr)_minmax(0,15rem)_9rem_6.5rem] gap-x-4 gap-y-2 px-3 sm:px-4 py-3 hover:bg-zinc-900/60">
          <div className="min-w-0">
            {/* laid out as a goal's row, so the list reads one way; the fold button covers the header as a title link covers a row */}
            <button type="button" className="text-left text-sm text-zinc-100 leading-snug after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-emerald-500" aria-expanded={open} aria-controls={panel} onClick={() => toggleChain(c)} title={open ? 'collapse' : 'expand'}>
              {c.root.title}
            </button>
            <div className="mt-1 flex items-center gap-2 min-w-0 text-[11px] text-zinc-500">
              {providers.map((p) => <ProviderBadge key={p} provider={p} />)}
              <Folder size={11} className="shrink-0" aria-hidden="true" />
              <span className="mono truncate" title={c.root.repoPath}>{shortCwd(c.root.repoPath)}</span>
            </div>
            {c.root.follows && followsTag(c.root)}
            {/* where a main goal says how many Delegated goals it folds: the chain's count, with its fold arrow */}
            <div className="mt-1.5">
              <Chip className="gap-0.5 border-sky-800 text-sky-300">
                {open ? <ChevronDown size={10} aria-hidden="true" /> : <ChevronRight size={10} aria-hidden="true" />}
                {c.members.length} goals
              </Chip>
            </div>
          </div>
          <div className="min-w-0 space-y-1.5">
            {stateCell(c.latest)}
            <div className="text-[11px] text-zinc-400 truncate" title={c.latest.title}>
              latest:{' '}
              <Link to={href(c.latest)} className="relative z-10 text-zinc-300 hover:underline">
                {c.latest.title}
              </Link>
            </div>
          </div>
          <div className="hidden md:block text-xs space-y-1.5">
            <div className="mono whitespace-nowrap">{spent}</div>
            <div className="text-[11px] text-zinc-500 whitespace-nowrap">{minutes.toFixed(0)} min</div>
          </div>
          <div className="hidden md:block text-xs text-zinc-500 text-right space-y-1.5">
            <div className="whitespace-nowrap" title={new Date(updated).toLocaleString()}>{ago(updated)}</div>
            <div className="text-[11px] whitespace-nowrap" title={new Date(c.root.createdAt).toLocaleString()}>created {new Date(c.root.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
          </div>
          <div className="md:hidden sm:col-span-2 flex items-center gap-3 flex-wrap text-[11px] text-zinc-500">
            <span className="mono">{spent}</span>
            <span>{minutes.toFixed(0)} min</span>
            <span>{ago(updated)}</span>
          </div>
        </div>
        {open && (
          <ul id={panel} className="border-t border-zinc-800/70 divide-y divide-zinc-800/70">
            {/* the first goal's follows line is in the header; a follow-up names its goal only when that is not the row above */}
            {c.members.flatMap((m, i) => withDelegated(m, 1, i === 0 ? null : 'follow-up', i === 0 || m.follows?.goalId === c.members[i - 1]!.id ? null : followsTag(m)))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6">
      <SetupBanner />
      <div className="mb-3">
        <UsagePausedBanner />
      </div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-lg font-semibold">Goals</h1>
        <span className="flex items-center gap-3">
          {chains.length > 1 && (
            <span className="flex items-center gap-2 text-xs text-zinc-500">
              <button type="button" className="hover:text-zinc-200" onClick={() => setAllChains(false)}>expand all</button>
              <span className="text-zinc-700">·</span>
              <button type="button" className="hover:text-zinc-200" onClick={() => setAllChains(true)}>collapse all</button>
            </span>
          )}
          <Link to="/goals/new">
            <Button variant="primary">New goal</Button>
          </Link>
        </span>
      </div>
      {!goals ? (
        <Empty>Loading…</Empty>
      ) : goals.length === 0 ? (
        <Empty>No goals yet. Create one to start.</Empty>
      ) : (
        <>
          <ul className="surface-card rounded-lg border border-zinc-800 divide-y divide-zinc-800">
            {shown.flatMap((e) => (e.kind === 'chain' ? [chainItem(e.chain)] : withDelegated(e.goal, 0, null)))}
          </ul>
          {/* always shown: how many there are, how many per page, and where you are */}
          <nav className="mt-3 flex items-center justify-between gap-x-3 gap-y-2 flex-wrap text-xs text-zinc-500" aria-label="Goal pages">
            <span className="flex items-center gap-2">
              <span className="tabular-nums">
                {(page - 1) * size + 1}–{Math.min(page * size, entries.length)} of {entries.length} goals
                {grouped > 0 && <span className="text-zinc-600"> · {grouped} follow-up{grouped === 1 ? '' : 's'} grouped</span>}
                {top.length < goals.length && <span className="text-zinc-600"> · {goals.length - top.length} delegated</span>}
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
const FOLDED_KEY = 'foundry.goals.foldedChains';
function readFolded(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
function savedSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return PAGE_SIZES.includes(n) ? n : 10;
  } catch {
    return 10;
  }
}
