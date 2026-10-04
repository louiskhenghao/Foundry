import type { AgentSessionRow, AgentsList } from '@foundry/engine/agents-types';
import { ChevronRight, CornerDownRight, Folder, Search, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, type AgentProvider, type GoalRow } from '../../api.ts';
import { ProviderSelector } from '../../components/ProviderSelector.tsx';
import { useLive } from '../../store.ts';
import { ago, Button, cn, ConfirmDialog, Empty, Page } from '../../ui.tsx';
import { ContextGauge } from './ContextGauge.tsx';
import { SessionDetail, SubagentStatus } from './SessionDetail.tsx';
import { AttemptChip, ProviderBadge, ranFor, SourceBadge, StatusDot, shortCwd, shortModel } from './rows.tsx';

/** Foundry agent sessions, grouped by goal, and external native sessions; outside sessions are only observed. */
export function AgentsPage() {
  const version = useLive((s) => s.globalVersion);
  const [list, setList] = useState<AgentsList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [killRow, setKillRow] = useState<AgentSessionRow | null>(null);
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  const [killing, setKilling] = useState(false);
  const [provider, setProvider] = useState<AgentProvider | 'all'>('all');
  const [query, setQuery] = useState('');
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    let alive = true;
    const load = () => api.agents().then((value) => { if (alive) { setList(value); setError(null); } }).catch((e) => { if (alive) setError(e.message); });
    const t = setTimeout(() => { load(); api.goals().then((value) => { if (alive) setGoals(value); }).catch(() => {}); }, 150);
    const i = setInterval(load, 5_000);
    return () => {
      alive = false;
      clearTimeout(t);
      clearInterval(i);
    };
  }, [version]);

  // #<sessionId> or #<sessionId>/<agentId> selects the detail view (hash, per the app's sub-view convention)
  const [selId, selAgent] = loc.hash.slice(1).split('/');
  const openSession = (sessionId: string, agentId?: string) => nav({ hash: agentId ? `${sessionId}/${agentId}` : sessionId }, { replace: false });
  const selected = selId ? list?.sessions.find((s) => s.sessionId === selId) : null;

  const doKill = () => {
    if (!killRow || killRow.source !== 'foundry' || !killRow.foundry?.killable) return;
    setKilling(true);
    api
      .killAgent(killRow.sessionId)
      .then(() => api.agents().then(setList).catch(() => {}))
      .catch((e) => setError(e.message))
      .finally(() => {
        setKilling(false);
        setKillRow(null);
      });
  };

  const warnings = <>{error && <div role="alert" className="text-xs text-rose-300 mb-3">{error}</div>}{list?.warnings?.map((warning, index) => <div key={index} className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200 mb-3">{warning}</div>)}</>;
  if (selId) {
    return (
      <Page width="lg">
        {warnings}
        {selected ? <SessionDetail row={selected} agentId={selAgent ?? null} onOpen={openSession} onBack={() => nav({ hash: '' }, { replace: false })} /> : <Empty>{list ? 'This session is no longer in the last-24h window.' : 'Loading…'}</Empty>}
      </Page>
    );
  }

  const sessions = list?.sessions ?? [];
  const q = query.trim().toLowerCase();
  const matching = sessions.filter(s => (provider === 'all' || s.provider === provider) &&
    [s.title, s.foundry?.goalTitle, s.foundry?.taskTitle, s.cwd, s.model, s.sessionId].some(value => value?.toLowerCase().includes(q)));
  const counts = { all: sessions.length, claude: sessions.filter(s => s.provider === 'claude').length, codex: sessions.filter(s => s.provider === 'codex').length };
  // Foundry sessions grouped by goal, in order of their latest session; then everything the user opened themselves
  const goalGroups: GoalGroup[] = [];
  for (const s of matching.filter((r) => r.source === 'foundry')) {
    const id = s.foundry?.goalId ?? '';
    let g = goalGroups.find((x) => x.id === id);
    if (!g) goalGroups.push((g = { id, title: s.foundry?.goalTitle ?? null, goal: goals.find((x) => x.id === id) ?? null, rows: [] }));
    g.rows.push(s);
  }
  const external = matching.filter((s) => s.source === 'external');
  // a group the user never toggled starts open while it has a live session (or is the only one); searching opens all
  const isOpen = (g: GoalGroup) => !!q || (collapsed[g.id] != null ? !collapsed[g.id] : goalGroups.length === 1 || g.rows.some((r) => r.status === 'busy' || r.status === 'idle'));
  const toggle = (g: GoalGroup) => setCollapsed((c) => {
    const next = { ...c, [g.id]: isOpen(g) };
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  const kill = (s: AgentSessionRow) => setKillRow(s);

  return (
    <Page width="lg">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <h1 className="text-lg font-semibold text-zinc-100">Agents</h1>
        {list && (
          <span className="text-xs text-zinc-500">
            {list.summary.busy} working · {list.summary.idle} idle · {list.summary.finished} finished{(list.summary.unknown ?? 0) > 0 && <> · {list.summary.unknown} unknown</>} (24h)
          </span>
        )}
      </div>
      <p className="text-xs text-zinc-500 mb-4 max-w-2xl">
        Claude Code and Codex, together. Browse Foundry agents and your external sessions from the last 24 hours. External Codex process status is unknown; opening a conversation only reads its history.
      </p>
      <div className="flex items-end justify-between gap-3 flex-wrap mb-5">
        <ProviderSelector allowAll value={provider} onChange={setProvider} counts={list ? counts : undefined} />
        <label className="relative flex-1 min-w-48 max-w-xs">
          <span className="sr-only">Search sessions</span>
          <Search size={14} className="absolute left-3 top-3 text-zinc-500" aria-hidden="true" />
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search sessions, goals, tasks, models, directories…" className="w-full rounded-lg border border-zinc-800 bg-zinc-950/50 py-2.5 pl-9 pr-3 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
        </label>
      </div>
      {warnings}
      {list && <div className="mb-3 text-xs text-zinc-500" aria-live="polite">Showing {matching.length} of {sessions.length} sessions · refreshes automatically</div>}
      {!list && <Empty>{error ? 'Session list unavailable; retrying…' : 'Loading…'}</Empty>}
      {list && matching.length === 0 && <Empty>{sessions.length === 0 ? 'No agent sessions in the last 24 hours.' : 'No sessions match this coding agent and search. Try All agents or clear the search.'}</Empty>}

      {goalGroups.length > 0 && (
        <section className="mb-6">
          <GroupHeading accent="bg-violet-400" label="Foundry agents" hint={`${goalGroups.reduce((n, g) => n + g.rows.length, 0)} sessions in ${goalGroups.length} goal${goalGroups.length === 1 ? '' : 's'} · Running sessions can be stopped here.`} />
          <div className="space-y-2">
            {goalGroups.map((g) => {
              const open = isOpen(g);
              const busy = g.rows.filter((r) => r.status === 'busy').length;
              const last = g.rows.map((r) => r.lastActivityAt).filter(Boolean).sort().pop();
              const dir = g.goal?.repoPath ?? g.rows.find((r) => r.cwd)?.cwd?.replace(/\/\.foundry\/.*$/, '') ?? null;
              const panel = `agents-goal-${g.id || 'none'}`;
              return (
                <div key={g.id} className="rounded-lg border border-zinc-800 surface-card">
                  <div className="flex items-center gap-2 px-3 py-2.5 min-w-0">
                    <button className="flex items-center gap-2 min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-emerald-500 rounded" aria-expanded={open} aria-controls={panel} onClick={() => toggle(g)}>
                      <ChevronRight size={14} className={cn('shrink-0 text-zinc-500 transition-transform', open && 'rotate-90')} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-violet-200 truncate">{g.title ?? g.goal?.title ?? 'Goal no longer exists'}</span>
                          <ProviderBadge provider={g.goal?.provider ?? g.rows[0]!.provider} />
                        </span>
                        <span className="mt-0.5 flex flex-wrap sm:flex-nowrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-zinc-500 min-w-0">
                          {dir && <span className="flex items-center gap-1.5 min-w-0 max-w-full"><Folder size={11} className="shrink-0" aria-hidden="true" /><span className="mono truncate" title={dir}>{shortCwd(dir)}</span><span className="hidden sm:inline text-zinc-700">·</span></span>}
                          <span className="whitespace-nowrap">{g.rows.length} session{g.rows.length === 1 ? '' : 's'}{busy > 0 && <span className="text-emerald-400"> · {busy} working</span>}{last && <> · {ago(last)}</>}</span>
                        </span>
                      </span>
                    </button>
                    {g.goal && <Link to={`/goals/${g.id}`} className="shrink-0 text-[11px] text-zinc-500 hover:text-emerald-300 px-1.5 py-1 rounded focus-visible:outline-2 focus-visible:outline-emerald-500" aria-label="Open goal"><span className="hidden sm:inline">Open goal </span>→</Link>}
                  </div>
                  {open && <div id={panel} className="border-t border-zinc-800 px-3"><SessionList rows={g.rows} inGoal onOpen={openSession} onKill={kill} /></div>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {external.length > 0 && (
        <section className="mb-6">
          <GroupHeading accent="bg-sky-400" label="Your sessions" hint={`${external.length} · From your terminal or editor. History is read-only.`} />
          <div className="rounded-lg border border-zinc-800 px-3 surface-card"><SessionList rows={external} onOpen={openSession} onKill={kill} /></div>
        </section>
      )}

      <ConfirmDialog open={!!killRow} danger busy={killing} title="Stop this session?" confirmLabel="Stop session" onConfirm={doKill} onClose={() => setKillRow(null)}>
        The running agent process for {killRow?.foundry?.goalTitle ? <b>{killRow.foundry.goalTitle}</b> : 'this task'} is killed. The engine may retry the task per its normal policy.
      </ConfirmDialog>
    </Page>
  );
}

const COLLAPSED_KEY = 'foundry.agents.collapsed';
function readCollapsed(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}'); } catch { return {}; }
}

type GoalGroup = { id: string; title: string | null; goal: GoalRow | null; rows: AgentSessionRow[] };

function GroupHeading({ accent, label, hint }: { accent: string; label: string; hint: string }) {
  return (
    <div className="flex items-baseline gap-2 flex-wrap mb-2">
      <span className={cn('h-2 w-2 rounded-full self-center shrink-0', accent)} />
      <h2 className="text-sm font-medium text-zinc-200">{label}</h2>
      <span className="text-[11px] text-zinc-600">{hint}</span>
    </div>
  );
}

/** Foundry rows lead with their task (their first prompt is boilerplate); outside sessions with their own title. */
const title = (s: AgentSessionRow) => s.foundry?.taskTitle ?? s.title ?? s.foundry?.goalTitle ?? s.sessionId.slice(0, 8);

/**
 * Sessions as stacked rows instead of a wide table: what it is (title, task kind or folder), what runs it
 * (coding agent, model, context) and when (activity, where it was opened or how long it ran). Inside a goal
 * group the goal and its coding agent are in the heading, so rows skip them.
 */
function SessionList({ rows, inGoal = false, onOpen, onKill }: { rows: AgentSessionRow[]; inGoal?: boolean; onOpen: (sessionId: string, agentId?: string) => void; onKill: (row: AgentSessionRow) => void }) {
  return (
    <ul className="divide-y divide-zinc-800/70">
      {rows.map((s) => (
        <li key={s.sessionId}>
          <div role="button" tabIndex={0} onClick={() => onOpen(s.sessionId)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(s.sessionId); }} className={cn(ROW, 'py-2.5 cursor-pointer hover:bg-zinc-900/50 focus-visible:outline-2 focus-visible:outline-emerald-500 rounded')}>
            <span className="pt-1.5"><StatusDot status={s.status} /></span>
            <div className="min-w-0">
              <div className="text-sm text-zinc-100 truncate" title={s.foundry ? (s.title ?? undefined) : s.sessionId}>{title(s)}</div>
              <div className="mt-1 flex items-center gap-2 min-w-0 text-[11px] text-zinc-500">
                {s.foundry ? <AttemptChip kind={s.foundry.kind} attempt={s.foundry.attempt} /> : null}
                {s.foundry && s.foundry.taskTitle && s.title && s.title.replace(/^#+\s*/, '') !== s.foundry.taskTitle && <span className="truncate" title={s.title}>{s.title.replace(/^#+\s*/, '')}</span>}
                {!s.foundry && s.cwd && <span className="mono truncate" title={s.cwd}>{shortCwd(s.cwd)}{s.gitBranch ? <span className="text-zinc-600"> · {s.gitBranch}</span> : null}</span>}
                {s.status === 'unknown' && <span className="text-sky-400 whitespace-nowrap">status unknown</span>}
              </div>
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-1.5 min-w-0">
                {!inGoal && <ProviderBadge provider={s.provider} compact />}
                <span className="mono text-xs text-zinc-300 truncate">{s.model ? shortModel(s.model) : '—'}</span>
              </div>
              <ContextGauge used={s.contextUsedTokens} window={s.contextWindowTokens} />
            </div>
            <div className="text-xs text-zinc-500 space-y-1 sm:text-right">
              <div className="whitespace-nowrap" title={s.startedAt ? `started ${ago(s.startedAt)}` : undefined}>{s.lastActivityAt ? ago(s.lastActivityAt) : '—'}</div>
              <div className="flex sm:justify-end">{s.source === 'external' ? <SourceBadge row={s} /> : <span className="text-[11px] whitespace-nowrap">{ranFor(s.startedAt, s.endedAt ?? s.lastActivityAt) ?? ''}</span>}</div>
            </div>
            <div className="w-8 flex justify-end">
              {s.source === 'foundry' && s.foundry?.killable && (
                <Button size="sm" variant="ghost" title="Stop this session" onClick={(e) => { e.stopPropagation(); onKill(s); }}>
                  <Square size={12} className="text-rose-400" />
                </Button>
              )}
            </div>
          </div>
          {s.subagents.length > 0 && (
            <ul className="pb-2">
              {s.subagents.map((a) => (
                <li key={a.agentId}>
                  <div role="button" tabIndex={0} onClick={() => onOpen(s.sessionId, a.agentId)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(s.sessionId, a.agentId); }} className={cn(ROW, 'py-1.5 cursor-pointer hover:bg-zinc-900/50 focus-visible:outline-2 focus-visible:outline-emerald-500 rounded')}>
                    <span />
                    <div className="flex items-start gap-1.5 min-w-0 pl-3 border-l border-zinc-800">
                      <CornerDownRight size={12} className="shrink-0 mt-0.5 text-zinc-600" aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="text-xs text-zinc-300 truncate" title={a.description}>{a.description || a.agentType}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px]"><span className="rounded border border-zinc-700 px-1 py-px text-[10px] text-zinc-400">{a.agentType}</span><SubagentStatus status={a.status} /></div>
                      </div>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <span className="mono text-[11px] text-zinc-400 truncate block">{a.model ? shortModel(a.model) : ''}</span>
                      <ContextGauge used={a.contextUsedTokens ?? null} window={a.contextWindowTokens ?? null} />
                    </div>
                    <div className="text-[11px] text-zinc-500 space-y-1 sm:text-right">
                      <div className="whitespace-nowrap">{a.lastActivityAt ? ago(a.lastActivityAt) : ''}</div>
                      <div className="whitespace-nowrap">{ranFor(a.startedAt, a.lastActivityAt) ?? ''}</div>
                    </div>
                    <span />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/** one grid for sessions and their subagents, so the columns line up; phones stack it */
const ROW = 'grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_12rem_7rem_2rem] gap-x-3 gap-y-1.5 items-start px-1 [&>*:nth-child(n+3)]:col-start-2 sm:[&>*:nth-child(n+3)]:col-start-auto';
