import { reportsDollars } from '@foundry/core/browser';
import { type ReactNode, useEffect, useState } from 'react';
import { Ban, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, CornerDownRight, Eye, Folder, Link2, LoaderCircle, Play, Hand, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type GoalRow } from '../api.ts';
import { MiniRail, TaskSquares, countMarks, stageMarks } from '../components/progress.tsx';
import { PROVIDER_STYLE } from '../components/ProviderMark.tsx';
import { SetupBanner } from '../components/SetupBanner.tsx';
import { UsagePausedBanner } from '../components/UsageBanner.tsx';
import { ProviderBadge, shortCwd } from './agents/rows.tsx';
import { boardOf, isFinished, needOf, waited, type Need } from './goal-boards.ts';
import { listEntries, type GoalChain, type ListEntry } from './goal-chains.ts';
import { useLive } from '../store.ts';
import { Button, Empty, PageHeader, ago, cn, fmtUsd, stateLabel } from '../ui.tsx';

/** Trait chip (nature, pace, view mode): quiet, so the state and the signs carry the colour. */
function Chip({ className, children, title }: { className?: string; children: ReactNode; title?: string }) {
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded-sm border border-line-strong/70 px-1.5 py-px text-[10.5px] font-semibold leading-tight text-ink-soft', className)} title={title}>{children}</span>;
}

/**
 * The Goals page as a sign system: what waits for you hangs as yellow signs at the top, each saying in its largest words
 * what to do; the goals at work sit on a quiet board below, each with its stage, tasks, spend and time; finished goals
 * go on a second board, paged.
 */
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
  /** the goal's traits beside its folder: one quiet row everywhere */
  const traits = (g: GoalRow) => (
    <>
      {g.mode === 'simple' && <Chip>simple</Chip>}
      {g.nature !== 'auto' && g.nature !== 'code' && <Chip>{g.nature}</Chip>}
      {g.workflow.pace === 'fast' && <Chip>fast</Chip>}
      {g.workflow.profile && g.workflow.profile !== 'mattpocock' && <Chip>{g.workflow.profile}</Chip>}
      {g.issue && <Chip title={`from issue ${g.issue.repo}#${g.issue.number}: ${g.issue.title}`}>#{g.issue.number}</Chip>}
      {g.schedule && <Chip title={`a run of the schedule ${g.schedule.name}`}>⏰ {g.schedule.name}</Chip>}
    </>
  );
  /** a follow-up whose earlier goal is not shown above it names that goal (a deleted one, or another branch of the chain) */
  const followsTag = (g: GoalRow) =>
    g.follows ? (
      <div className="text-xs text-ink-faint truncate" title={`follows ${g.follows.title}`}>
        ↳ follows {g.follows.title}
      </div>
    ) : null;

  // Delegated goals fold under their main goal; one whose main goal is gone stays in the list on its own, saying so
  const all = goals ?? [];
  const ids = new Set(all.map((g) => g.id));
  const children = new Map<string, GoalRow[]>();
  for (const g of all) {
    if (g.delegatedFrom && ids.has(g.delegatedFrom.goalId)) children.set(g.delegatedFrom.goalId, [...(children.get(g.delegatedFrom.goalId) ?? []), g]);
  }
  const top = all.filter((g) => !(g.delegatedFrom && ids.has(g.delegatedFrom.goalId)));
  // a goal and its follow-ups are one entry, folded like a group on the Agents page
  const entries = listEntries(top);
  const chains = entries.flatMap((e) => (e.kind === 'chain' ? [e.chain] : []));
  const grouped = chains.reduce((n, c) => n + c.members.length - 1, 0);
  const underWay = (g: GoalRow) => !isFinished(g) || g.openEscalations > 0;
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

  // every goal that waits for you hangs as a sign, the longest waiting first; the boards hold the rest
  const signs = all.flatMap((g) => {
    const need = needOf(g);
    return need ? [{ g, need }] : [];
  });
  signs.sort((a, b) => a.g.updatedAt.localeCompare(b.g.updatedAt));
  const working = entries.filter((e) => boardOf(e) === 'working');
  const finished = entries.filter((e) => boardOf(e) === 'finished');
  const workingGoals = all.filter((g) => !isFinished(g) && !needOf(g)).length;

  // the finished board pages; what is under way never does
  const pages = Math.max(1, Math.ceil(finished.length / size));
  const page = Math.min(pages, Math.max(1, Number(params.get('page')) || 1));
  const shown = finished.slice((page - 1) * size, page * size);
  const go = (n: number) => setParams(n > 1 ? { page: String(n) } : {});
  const resize = (n: number) => {
    setSize(n);
    try {
      localStorage.setItem(SIZE_KEY, String(n));
    } catch {}
    go(1);
  };

  /** under a main goal: how many Delegated goals it has (click to fold them out); under an orphaned one: whose it was */
  const delegationTag = (g: GoalRow) => {
    const kids = children.get(g.id);
    if (kids?.length) {
      const open = expanded.has(g.id);
      return (
        // above the row's title link (which covers the row), so it toggles instead of opening the goal
        <button type="button" className="relative z-10 self-start text-xs font-semibold text-extra-ink hover:underline" onClick={() => toggle(g.id)} aria-expanded={open}>
          {open ? '▾' : '▸'} {kids.length} delegated goal{kids.length === 1 ? '' : 's'}
        </button>
      );
    }
    if (g.delegatedFrom) {
      return (
        <div className="text-xs text-ink-faint truncate" title={`delegated from ${g.delegatedFrom.title}`}>
          ↳ delegated from a deleted goal · {g.delegatedFrom.title}
        </div>
      );
    }
    return null;
  };

  /**
   * One goal on a board: its tile, what and where, then the stage and tasks, the spend and time, and when it last moved.
   * On a phone the columns after the title wrap into one line under it. `depth` indents a chain's member or a Delegated goal.
   */
  const row = (g: GoalRow, depth: 0 | 1 | 2, mark: 'delegated' | 'follow-up' | null, note: ReactNode = followsTag(g)) => {
    const total = Object.values(g.taskCounts).reduce((n, v) => n + v, 0);
    const done = g.taskCounts.done ?? 0;
    return (
      <li key={g.id} className={cn(ROW, depth === 1 && 'pl-8 sm:pl-12', depth === 2 && 'pl-14 sm:pl-20')}>
        <Tile g={g} />
        <div className="min-w-0 flex flex-col gap-1">
          {/* the title link covers the whole row */}
          <Link to={href(g)} className="text-[15px] sm:text-base font-bold leading-snug text-ink group-hover:underline decoration-2 underline-offset-[3px] after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-accent">
            {mark === 'delegated' && <CornerDownRight size={13} className="inline mr-1 text-extra-ink" aria-label="delegated goal" />}
            {mark === 'follow-up' && <CornerDownRight size={13} className="inline mr-1 text-work-ink" aria-label="follow-up" />}
            {g.title}
          </Link>
          <div className="flex items-center gap-2 min-w-0 flex-wrap text-xs text-ink-faint">
            <ProviderBadge provider={g.provider} />
            <span className="inline-flex items-center gap-1 min-w-0">
              <Folder size={12} className="shrink-0" aria-hidden="true" />
              <span className="mono truncate max-w-[16rem]" title={g.repoPath}>{shortCwd(g.repoPath)}</span>
            </span>
            {traits(g)}
          </div>
          {note}
          {mark !== 'delegated' && delegationTag(g)}
        </div>
        <div className="col-start-2 md:col-start-auto flex flex-wrap items-start gap-x-6 gap-y-2 md:contents">
          <div className="flex flex-col gap-1.5">
            <MiniRail marks={stageMarks(g, total > 0)} />
            <span className="text-[13px] font-bold leading-none first-letter:uppercase">{stateLabel(g.state)}</span>
            <span className="flex items-center gap-2 text-xs">
              {total ? (
                <>
                  <TaskSquares marks={countMarks(g.taskCounts)} max={10} />
                  <span className="mono text-ink-soft">{done}/{total}</span>
                </>
              ) : (
                <span className="text-ink-faint">no tasks yet</span>
              )}
            </span>
          </div>
          <Budget g={g} />
          <time className="mono text-xs text-ink-faint md:text-right" dateTime={g.updatedAt} title={new Date(g.updatedAt).toLocaleString()}>
            {ago(g.updatedAt)}
          </time>
        </div>
      </li>
    );
  };
  /** a goal's row, then its Delegated goals when they are folded out */
  const withDelegated = (g: GoalRow, depth: 0 | 1, mark: 'follow-up' | null, note?: ReactNode) => [row(g, depth, mark, note), ...(expanded.has(g.id) ? (children.get(g.id) ?? []).map((c) => row(c, depth === 0 ? 1 : 2, 'delegated')) : [])];

  /**
   * A goal and its follow-ups as one entry: the first goal names it, the newest says where the work stands, the spend
   * and time are the chain's. Open, it lists each goal's own row, oldest first.
   */
  const chainItem = (c: GoalChain) => {
    const open = isOpen(c);
    const panel = `chain-${c.id}`;
    const providers = [...new Set(c.members.map((m) => m.provider ?? 'claude'))];
    const withDollars = c.members.filter((m) => reportsDollars(m.provider));
    const minutes = c.members.reduce((n, m) => n + m.budget.elapsedMin, 0);
    const updated = c.members.map((m) => m.updatedAt).sort().pop()!;
    const latest = c.latest;
    const total = Object.values(latest.taskCounts).reduce((n, v) => n + v, 0);
    return (
      <li key={`chain:${c.id}`}>
        <div className={ROW}>
          <span className="grid h-9 w-9 place-items-center rounded-lg ring-[1.5px] ring-inset ring-line-strong text-ink-soft" aria-hidden="true">
            <Link2 size={16} />
          </span>
          <div className="min-w-0 flex flex-col gap-1">
            {/* laid out as a goal's row; the fold button covers the header as a title link covers a row */}
            <button type="button" className="text-left text-[15px] sm:text-base font-bold leading-snug text-ink group-hover:underline decoration-2 underline-offset-[3px] after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-accent" aria-expanded={open} aria-controls={panel} onClick={() => toggleChain(c)} title={open ? 'collapse' : 'expand'}>
              {c.root.title}
            </button>
            <div className="flex items-center gap-2 min-w-0 flex-wrap text-xs text-ink-faint">
              {providers.map((p) => (
                <ProviderBadge key={p} provider={p} />
              ))}
              <span className="inline-flex items-center gap-1 min-w-0">
                <Folder size={12} className="shrink-0" aria-hidden="true" />
                <span className="mono truncate max-w-[16rem]" title={c.root.repoPath}>{shortCwd(c.root.repoPath)}</span>
              </span>
              <Chip className="gap-0.5 text-ink">
                {open ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
                {c.members.length} goals
              </Chip>
            </div>
            {c.root.follows && followsTag(c.root)}
            <div className="text-xs text-ink-soft truncate">
              latest:{' '}
              <Link to={href(latest)} className="relative z-10 font-semibold text-ink hover:underline">
                {latest.title}
              </Link>
            </div>
          </div>
          <div className="col-start-2 md:col-start-auto flex flex-wrap items-start gap-x-6 gap-y-2 md:contents">
            <div className="flex flex-col gap-1.5">
              <MiniRail marks={stageMarks(latest, total > 0)} />
              <span className="text-[13px] font-bold leading-none first-letter:uppercase">{stateLabel(latest.state)}</span>
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <span className="mono">
                {withDollars.length ? (
                  <>
                    <b className="text-[15px] font-semibold text-ink">{fmtUsd(withDollars.reduce((n, m) => n + m.costUsd, 0))}</b>
                    {withDollars.length < c.members.length && <span className="text-ink-faint" title="goals on a coding agent without dollar costs are left out">*</span>}
                  </>
                ) : (
                  <span className="font-sans text-ink-faint">cost unavailable</span>
                )}
              </span>
              <span className="mono text-ink-soft">{minutes.toFixed(0)} min</span>
            </div>
            <time className="mono text-xs text-ink-faint md:text-right" dateTime={updated} title={new Date(updated).toLocaleString()}>
              {ago(updated)}
            </time>
          </div>
        </div>
        {open && (
          <ul id={panel} className="border-t border-line divide-y divide-line bg-inset/60">
            {/* the first goal's follows line is in the header; a follow-up names its goal only when that is not the row above */}
            {c.members.flatMap((m, i) => withDelegated(m, 1, i === 0 ? null : 'follow-up', i === 0 || m.follows?.goalId === c.members[i - 1]!.id ? null : followsTag(m)))}
          </ul>
        )}
      </li>
    );
  };
  const items = (list: ListEntry[]) => list.flatMap((e) => (e.kind === 'chain' ? [chainItem(e.chain)] : withDelegated(e.goal, 0, null)));

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-16">
      <SetupBanner />
      <div className="mb-3">
        <UsagePausedBanner />
      </div>
      <PageHeader
        className="md:mb-10"
        title="Goals"
        summary={
          goals && goals.length > 0 ? (
            <>
              {goals.length} goal{goals.length === 1 ? '' : 's'}
              {signs.length > 0 && (
                <>
                  {' · '}
                  <span className="rounded-[5px] bg-you px-1.5 py-0.5 font-bold text-on-you">{signs.length} need{signs.length === 1 ? 's' : ''} you</span>
                </>
              )}
              {' · '}
              {workingGoals} working · {all.filter(isFinished).length} finished
            </>
          ) : null
        }
        actions={
          chains.length > 1 && (
            <span className="flex items-center gap-2 text-xs text-ink-faint">
              <button type="button" className="hover:text-ink" onClick={() => setAllChains(false)}>expand all</button>
              <span className="text-line-strong">·</span>
              <button type="button" className="hover:text-ink" onClick={() => setAllChains(true)}>collapse all</button>
            </span>
          )
        }
      />
      {!goals ? (
        <Empty>Loading…</Empty>
      ) : goals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong px-6 py-14 text-center">
          <p className="text-lg font-bold">No goals yet.</p>
          <p className="mt-1 text-sm text-ink-faint">Press New goal in the top bar, say what you want done, and pick the project folder.</p>
        </div>
      ) : (
        <>
          {signs.length > 0 && (
            <section aria-labelledby="needs-you" className="mb-12">
              <h2 id="needs-you" className="inline-flex items-center gap-2.5 rounded-t-md bg-ink px-3.5 py-2 text-[12.5px] font-extrabold uppercase tracking-[0.12em] text-on-ink">
                Needs you
                <b className="mono grid h-5 min-w-5 place-items-center rounded-[5px] bg-you px-1.5 text-xs tracking-normal text-on-you">{signs.length}</b>
              </h2>
              <div className="grid gap-x-6 gap-y-8 border-t-4 border-ink pt-7 md:grid-cols-2">
                {signs.map(({ g, need }, i) => (
                  <Sign key={g.id} g={g} need={need} delay={i * 120} />
                ))}
              </div>
            </section>
          )}

          <Board id="working" icon={<Play size={14} aria-hidden="true" />} title="Working" count={working.length} note={working.length ? 'nothing needed from you here' : null}>
            {working.length ? items(working) : <li className="px-5 py-6 text-sm text-ink-faint">Nothing is under way.</li>}
          </Board>

          {finished.length > 0 && (
            <Board id="finished" icon={<Check size={14} aria-hidden="true" />} title="Finished" count={finished.length} note={null}>
              {items(shown)}
            </Board>
          )}
          {/* how many there are, how many per page, and where you are */}
          <nav className="mt-3 flex items-center justify-between gap-x-3 gap-y-2 flex-wrap text-xs text-ink-faint" aria-label="Goal pages">
            <span className="flex items-center gap-2">
              <span className="tabular-nums">
                {finished.length ? `${(page - 1) * size + 1}–${Math.min(page * size, finished.length)} of ${finished.length} finished` : `${entries.length} goals`}
                {grouped > 0 && <span> · {grouped} follow-up{grouped === 1 ? '' : 's'} grouped</span>}
                {top.length < all.length && <span> · {all.length - top.length} delegated</span>}
              </span>
              <label className="flex items-center gap-1">
                <span className="sr-only">Finished goals per page</span>
                <select value={size} onChange={(e) => resize(Number(e.target.value))} className="rounded-sm border border-line bg-panel px-1.5 py-0.5 text-xs text-ink-soft">
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

/** a board row's grid: tile, goal, then stage, spend and time, updated (from md up; a phone wraps them under the title) */
const ROW = 'group relative grid grid-cols-[2.25rem_minmax(0,1fr)] md:grid-cols-[2.25rem_minmax(0,1fr)_10rem_9rem_4.5rem] items-start gap-x-4 gap-y-3 px-4 md:px-5 py-4 transition-colors hover:bg-inset before:absolute before:inset-y-0 before:left-0 before:w-1 before:origin-top before:scale-y-0 before:bg-ink before:transition-transform hover:before:scale-y-100';

function Board({ id, icon, title, count, note, children }: { id: string; icon: ReactNode; title: string; count: number; note: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10 first:mt-0">
      <h2 id={id} className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] font-extrabold uppercase tracking-[0.12em] text-ink">
        {icon}
        {title}
        <b className="mono text-[13px] tracking-normal">{count}</b>
        {note && <span className="w-full sm:w-auto sm:ml-auto text-[13px] font-semibold normal-case tracking-normal text-ink-faint">{note}</span>}
      </h2>
      <div className="overflow-hidden rounded-xl bg-panel shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.06)]">
        <div aria-hidden="true" className="hidden md:grid grid-cols-[2.25rem_minmax(0,1fr)_10rem_9rem_4.5rem] gap-x-4 border-b border-line bg-inset px-5 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-faint">
          <span />
          <span>Goal</span>
          <span>Stage · tasks</span>
          <span>Spent · time</span>
          <span className="text-right">Updated</span>
        </div>
        <ul className="divide-y divide-line">{children}</ul>
      </div>
    </section>
  );
}

/** the tile at the start of a row: what kind of moment the goal is in, in the shape of the rest of the system */
function Tile({ g }: { g: GoalRow }) {
  const [Icon, look]: [typeof Play, string] =
    g.state === 'running' ? [Play, 'bg-ink text-on-ink']
    : g.state === 'goal_review' ? [Eye, 'ring-2 ring-inset ring-ink text-ink']
    : g.state === 'clarifying' || g.state === 'draft' ? [LoaderCircle, 'ring-2 ring-inset ring-ink text-ink']
    : g.state === 'failed' ? [X, 'bg-bad text-on-bad']
    : g.state === 'cancelled' ? [Ban, 'ring-1 ring-inset ring-line-strong text-ink-faint']
    : isFinished(g) ? [Check, 'bg-inset ring-1 ring-inset ring-line-strong text-ink']
    : [Hand, 'bg-you text-on-you'];
  return (
    <span className={cn('grid h-9 w-9 place-items-center rounded-lg', look)} aria-hidden="true">
      <Icon size={16} strokeWidth={2.25} />
    </span>
  );
}

/** spend and time against their limits: the figure, the limit, and a thin bar */
function Budget({ g }: { g: GoalRow }) {
  const line = (value: ReactNode, limit: string | null, pct: number | null, label: string) => (
    <span className="flex flex-col gap-1">
      <span className="flex items-baseline gap-1 whitespace-nowrap text-xs">
        <b className="mono text-[15px] font-semibold text-ink">{value}</b>
        {limit && <span className="mono text-ink-faint">/ {limit}</span>}
      </span>
      {pct != null && (
        <span className="block h-1 w-28 overflow-hidden rounded-xs bg-line" role="img" aria-label={label}>
          <i className={cn('block h-full rounded-xs', pct > 90 ? 'bg-bad' : pct > 70 ? 'bg-you' : 'bg-ink')} style={{ width: `${Math.max(2, pct)}%` }} />
        </span>
      )}
    </span>
  );
  const cost = g.budgets.maxCostUsd;
  const min = g.budgets.maxDurationMin;
  const pct = (v: number, max: number | null) => (max ? Math.min(100, (v / max) * 100) : null);
  return (
    <div className="flex flex-col gap-2.5">
      {reportsDollars(g.provider) ? line(fmtUsd(g.costUsd), cost == null ? 'no limit' : fmtUsd(cost), pct(g.costUsd, cost), `${fmtUsd(g.costUsd)} spent`) : <span className="text-xs text-ink-faint">cost unavailable</span>}
      {line(`${g.budget.elapsedMin.toFixed(0)} min`, min == null ? 'no limit' : String(min), pct(g.budget.elapsedMin, min), `${g.budget.elapsedMin.toFixed(0)} minutes worked`)}
    </div>
  );
}

/** the wayfinding arrow: a thick shaft and 45-degree barbs */
const ARROW = 'M2.5 10.2h12.2L8.9 4.4l2.6-2.6L21.7 12 11.5 22.2l-2.6-2.6 5.8-5.8H2.5z';

/**
 * A goal that waits for you, as a yellow sign hung from the rail above it: the action in its largest words, the goal under
 * it, how long it has waited, one sentence on what is needed, and the goal's coding agent, tasks, spend and time.
 */
function Sign({ g, need, delay }: { g: GoalRow; need: Need; delay: number }) {
  const total = Object.values(g.taskCounts).reduce((n, v) => n + v, 0);
  const provider = g.provider ? PROVIDER_STYLE[g.provider] : null;
  return (
    // the sign hangs in once; the link inside it swings under the pointer
    <div className="sign-in" style={{ animationDelay: `${delay}ms` }}>
    <Link
      to={need.href}
      className="sign group relative grid grid-cols-[2.875rem_minmax(0,1fr)] sm:grid-cols-[4rem_minmax(0,1fr)_auto] gap-x-3.5 sm:gap-x-[18px] rounded-[10px] bg-you p-4 sm:p-[18px] sm:pr-5 text-on-you focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-ink before:absolute before:-top-[26px] before:left-[18%] before:h-[26px] before:w-1 before:rounded-b-sm before:bg-ink before:content-[''] after:absolute after:-top-[26px] after:right-[18%] after:h-[26px] after:w-1 after:rounded-b-sm after:bg-ink after:content-['']"
    >
      <span className="grid h-[2.875rem] w-[2.875rem] sm:h-16 sm:w-16 place-items-center rounded-[9px] bg-on-you">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="sign-arrow h-7 w-7 sm:h-[38px] sm:w-[38px] fill-you">
          <path d={ARROW} />
        </svg>
      </span>
      <span className="flex min-h-[2.875rem] sm:min-h-16 min-w-0 flex-col justify-center gap-1">
        <span className="text-2xl sm:text-[1.75rem] lg:text-3xl font-extrabold leading-[1.04] tracking-[-0.03em]">{need.action}</span>
        <span className="text-base sm:text-[17px] font-bold leading-tight">{g.title}</span>
      </span>
      <span className="col-start-2 sm:col-start-auto mt-2.5 sm:mt-0 inline-flex items-center gap-1.5 self-start justify-self-start rounded-md bg-on-you px-2 py-1 text-you mono text-[12.5px] font-bold whitespace-nowrap">
        <Clock size={13} aria-hidden="true" />
        waiting {waited(g.updatedAt)}
      </span>
      <span className="col-span-2 sm:col-span-2 sm:col-start-2 mt-2.5 max-w-[54ch] text-[15px] leading-normal">{need.say}</span>
      <span className="col-span-2 sm:col-span-2 sm:col-start-2 mt-3 flex flex-wrap items-center gap-x-[18px] gap-y-1.5 border-t-[1.5px] border-on-you/25 pt-2.5 text-[13px] font-semibold">
        {provider && (
          <span className="inline-flex items-center gap-1.5">
            <provider.Icon size={13} aria-hidden="true" />
            {provider.label}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          {total ? (
            <>
              <SignSquares counts={g.taskCounts} />
              <span className="mono">{g.taskCounts.done ?? 0}/{total} tasks</span>
            </>
          ) : (
            <span>no tasks yet</span>
          )}
        </span>
        <span className="mono">{reportsDollars(g.provider) ? fmtUsd(g.costUsd) : 'cost unavailable'}</span>
        <span className="mono">{g.budget.elapsedMin.toFixed(0)} min</span>
      </span>
    </Link>
    </div>
  );
}

/** task squares drawn in the sign's own ink: on yellow, done is solid and the rest is outlined */
function SignSquares({ counts }: { counts: Record<string, number> }) {
  return (
    <span className="inline-flex gap-[3px]" aria-hidden="true">
      {countMarks(counts)
        .slice(0, 10)
        .map((m, i) => (
          <i key={i} className={cn('block h-3 w-3 rounded-[3px] ring-[1.5px] ring-inset ring-on-you', m === 'done' && 'bg-on-you', m === 'run' && 'hatch text-on-you')} />
        ))}
    </span>
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
