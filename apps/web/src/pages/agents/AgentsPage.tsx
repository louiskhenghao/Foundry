import type { AgentSessionRow, AgentsList } from '@foundry/engine/agents-types';
import { ChevronRight, CornerDownRight, Folder, Search, Square } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, type AgentProvider, type GoalRow } from '../../api.ts';
import { ProviderSelector } from '../../components/ProviderSelector.tsx';
import { useLive } from '../../store.ts';
import { ago, Button, cn, ConfirmDialog, Empty, Page } from '../../ui.tsx';
import { ContextGauge } from './ContextGauge.tsx';
import { SessionDetail, SubagentStatus } from './SessionDetail.tsx';
import { goalRelCwd, ProviderBadge, SourceBadge, StatusDot, shortCwd, shortModel } from './rows.tsx';

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
    [s.title, s.foundry?.goalTitle, s.cwd, s.model, s.sessionId].some(value => value?.toLowerCase().includes(q)));
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
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search sessions, goals, models, directories…" className="w-full rounded-lg border border-zinc-800 bg-zinc-950/50 py-2.5 pl-9 pr-3 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
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

const title = (s: AgentSessionRow) => s.title ?? s.foundry?.goalTitle ?? s.sessionId.slice(0, 8);

/** Sessions as cards on phones and a table from tablets up; inside a goal group the goal is the heading, so its column gives way to the session title. */
function SessionList({ rows, inGoal = false, onOpen, onKill }: { rows: AgentSessionRow[]; inGoal?: boolean; onOpen: (sessionId: string, agentId?: string) => void; onKill: (row: AgentSessionRow) => void }) {
  const dir = (s: AgentSessionRow) => (s.cwd ? (inGoal ? goalRelCwd(s.cwd) : shortCwd(s.cwd)) : '—');
  return (
    <>
      {/* phones: card stack */}
      <div className="sm:hidden divide-y divide-zinc-800/70">
        {rows.map((s) => (
          <button key={s.sessionId} onClick={() => onOpen(s.sessionId)} className="w-full text-left py-3 space-y-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot status={s.status} />
              <span className="text-sm text-zinc-100 truncate flex-1">{title(s)}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">{!inGoal && <ProviderBadge provider={s.provider} />}{s.source === 'external' && <SourceBadge row={s} />}{s.status === 'unknown' && <span className="text-[10px] text-sky-400">status unknown</span>}</div>
            <div className="flex items-center gap-3 flex-wrap text-[11px] text-zinc-500">
              {s.model && <span className="mono break-all">{shortModel(s.model)}</span>}
              <ContextGauge used={s.contextUsedTokens} window={s.contextWindowTokens} />
              {s.lastActivityAt && <span>{ago(s.lastActivityAt)}</span>}
              {inGoal && s.cwd && <span className="mono truncate" title={s.cwd}>{dir(s)}</span>}
            </div>
          </button>
        ))}
      </div>

      {/* desktop: table with subagents nested under their parent */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
              <th className="py-2 pr-3 font-medium w-6" />
              <th className="py-2 pr-3 font-medium">Session</th>
              {!inGoal && <th className="py-2 pr-3 font-medium">Opened in</th>}
              <th className="py-2 pr-3 font-medium">Model</th>
              <th className="py-2 pr-3 font-medium">Context</th>
              <th className="py-2 pr-3 font-medium">Activity</th>
              <th className="py-2 pr-3 font-medium">{inGoal ? 'Folder' : 'Directory'}</th>
              <th className="py-2 font-medium w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <Fragment key={s.sessionId}>
                <tr className="border-b border-zinc-900 last:border-b-0 hover:bg-zinc-900/50 cursor-pointer" onClick={() => onOpen(s.sessionId)}>
                  <td className="py-2 pr-3"><StatusDot status={s.status} /></td>
                  <td className={cn('py-2 pr-3', inGoal ? 'max-w-[36rem]' : 'max-w-88')}>
                    <button className="text-zinc-100 truncate block max-w-full text-left hover:text-emerald-300 focus-visible:outline-2 focus-visible:outline-emerald-500" title={s.title ?? s.sessionId} onClick={e => { e.stopPropagation(); onOpen(s.sessionId); }}>{title(s)}</button>
                    {(!inGoal || s.status === 'unknown') && <div className="mt-1 flex items-center gap-2 flex-wrap">{!inGoal && <ProviderBadge provider={s.provider} />}{s.status === 'unknown' && <span className="text-[10px] text-sky-400">status unknown</span>}</div>}
                  </td>
                  {!inGoal && <td className="py-2 pr-3 max-w-40"><SourceBadge row={s} /></td>}
                  <td className="py-2 pr-3 mono text-xs text-zinc-400 whitespace-nowrap">{s.model ? shortModel(s.model) : '—'}</td>
                  <td className="py-2 pr-3"><ContextGauge used={s.contextUsedTokens} window={s.contextWindowTokens} /></td>
                  <td className="py-2 pr-3 text-xs text-zinc-500 whitespace-nowrap" title={s.startedAt ? `started ${ago(s.startedAt)}` : undefined}>
                    {s.lastActivityAt ? ago(s.lastActivityAt) : '—'}
                  </td>
                  <td className="py-2 pr-3 mono text-xs text-zinc-500 max-w-[16rem]"><span className="truncate block" title={s.cwd ?? undefined}>{dir(s)}</span></td>
                  <td className="py-2">
                    {s.source === 'foundry' && s.foundry?.killable && (
                      <Button size="sm" variant="ghost" title="Stop this session" onClick={(e) => { e.stopPropagation(); onKill(s); }}>
                        <Square size={12} className="text-rose-400" />
                      </Button>
                    )}
                  </td>
                </tr>
                {s.subagents.map((a) => (
                  <tr key={`${s.sessionId}/${a.agentId}`} className="border-b border-zinc-900/60 hover:bg-zinc-900/50 cursor-pointer" onClick={() => onOpen(s.sessionId, a.agentId)}>
                    <td className="py-1.5 pr-3" />
                    <td className="py-1.5 pr-3 max-w-88" colSpan={inGoal ? 1 : 2}>
                      <button className="flex items-center gap-1.5 pl-4 text-xs text-zinc-400 min-w-0 max-w-full text-left hover:text-emerald-300 focus-visible:outline-2 focus-visible:outline-emerald-500" onClick={e => { e.stopPropagation(); onOpen(s.sessionId, a.agentId); }}>
                        <CornerDownRight size={12} className="shrink-0 text-zinc-600" />
                        <span className="text-zinc-300 shrink-0">{a.agentType}</span>
                        <span className="truncate">{a.description}</span>
                      </button>
                    </td>
                    <td className="py-1.5 pr-3 text-[11px] whitespace-nowrap" colSpan={2}>
                      <SubagentStatus status={a.status} />
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-zinc-600 whitespace-nowrap" colSpan={3}>{a.lastActivityAt ? ago(a.lastActivityAt) : ''}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
