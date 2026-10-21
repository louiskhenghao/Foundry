import { AGENT_PROVIDERS, PROVIDER_LABEL } from '@foundry/core/browser';
import type { AgentSessionRow, AgentsList } from '@foundry/engine/agents-types';
import { ChevronDown, ChevronRight, CornerDownRight, Folder, Search, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, type AgentProvider, type GoalRow } from '../../api.ts';
import { useLive } from '../../store.ts';
import { ago, Badge, Button, Card, cn, ConfirmDialog, Empty, Input, Page, useAffix } from '../../ui.tsx';
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
  const [liveOnly, setLiveOnly] = useState(false);
  const [showSide, setShowSide] = useState(false);
  const affix = useAffix<HTMLDivElement>();
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
  const live = (s: AgentSessionRow) => s.status === 'busy' || s.status === 'idle';
  const matching = sessions.filter(s => (provider === 'all' || s.provider === provider) && (!liveOnly || live(s)) &&
    [s.title, s.foundry?.goalTitle, s.foundry?.taskTitle, s.cwd, s.model, s.sessionId].some(value => value?.toLowerCase().includes(q)));
  const counts = { all: sessions.length, ...Object.fromEntries(AGENT_PROVIDERS.map((p) => [p, sessions.filter(s => s.provider === p).length])) } as Record<AgentProvider | 'all', number>;
  // Foundry sessions grouped by goal, in order of their latest session; then the person's own, one card per folder
  const goalGroups: SessionGroup[] = [];
  for (const s of matching.filter((r) => r.source === 'foundry')) {
    const id = s.foundry?.goalId ?? '';
    let g = goalGroups.find((x) => x.id === id);
    if (!g) goalGroups.push((g = { id, kind: 'goal', title: s.foundry?.goalTitle ?? null, goal: goals.find((x) => x.id === id) ?? null, dir: null, rows: [] }));
    g.rows.push(s);
  }
  for (const g of goalGroups) g.dir = g.goal?.repoPath ?? g.rows.find((r) => r.cwd)?.cwd?.replace(/\/\.foundry\/.*$/, '') ?? null;
  const folderGroups: SessionGroup[] = [];
  for (const s of matching.filter((r) => r.source === 'external')) {
    const dir = s.cwd ?? '';
    const id = `dir:${dir}`;
    let g = folderGroups.find((x) => x.id === id);
    if (!g) folderGroups.push((g = { id, kind: 'folder', title: dir ? (dir.split('/').filter(Boolean).pop() ?? dir) : 'No folder', goal: null, dir: dir || null, rows: [] }));
    g.rows.push(s);
  }
  const all = [...goalGroups, ...folderGroups];
  // a group the user never toggled starts open while it has a live session (or is the only one); searching opens all
  const isOpen = (g: SessionGroup) => !!q || (collapsed[g.id] != null ? !collapsed[g.id] : all.length === 1 || g.rows.some(live));
  const remember = (next: Record<string, boolean>) => {
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  };
  const toggle = (g: SessionGroup) => setCollapsed((c) => remember({ ...c, [g.id]: isOpen(g) }));
  const setAll = (fold: boolean) => setCollapsed((c) => remember({ ...c, ...Object.fromEntries(all.map((g) => [g.id, fold])) }));
  const kill = (s: AgentSessionRow) => setKillRow(s);
  const sum = list?.summary;

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-semibold text-zinc-100">Agents</h1>
        {sum && (
          <span className="text-xs text-zinc-500">
            <span className={cn(sum.busy ? 'text-emerald-300' : 'text-zinc-500')}>{sum.busy} working</span> · {sum.idle} idle · {sum.finished} finished{(sum.unknown ?? 0) > 0 && <> · {sum.unknown} unknown</>} (24h)
          </span>
        )}
        <span className="ml-auto text-[11px] text-zinc-500">refreshes every 5 s</span>
      </div>
      <p className="text-xs text-zinc-500 -mt-2">Every coding agent, together: the sessions Foundry runs for your goals, and the ones you opened yourself, from the last 24 hours. Foundry's can be stopped here; yours are read-only, and an external Codex session's live state is unknown.</p>

      <div className="flex items-center gap-2 flex-wrap">
        {(['all', ...AGENT_PROVIDERS] as const).map((p) => (
          <button key={p} onClick={() => setProvider(p)} className={cn('rounded-md border px-2 py-1 text-xs', provider === p ? 'border-emerald-500 text-emerald-300' : 'border-zinc-800 text-zinc-400')}>
            {p === 'all' ? 'all' : PROVIDER_LABEL[p]} <span className="text-zinc-600">{list ? counts[p] : ''}</span>
          </button>
        ))}
        <label className="flex items-center gap-1 text-xs text-zinc-400" title="working or waiting for input">
          <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} /> live only
        </label>
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={13} className="absolute left-2 top-2 text-zinc-500" aria-hidden="true" />
          <Input type="search" className="pl-7 py-1 text-xs" placeholder="search sessions, goals, tasks, models, folders" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search sessions" />
        </div>
        {all.length > 1 && (
          <span className="flex items-center gap-2 text-xs text-zinc-500">
            <button type="button" className="hover:text-zinc-200" onClick={() => setAll(false)}>expand all</button>
            <span className="text-zinc-700">·</span>
            <button type="button" className="hover:text-zinc-200" onClick={() => setAll(true)}>collapse all</button>
          </span>
        )}
        <button className="lg:hidden text-xs underline text-zinc-400" onClick={() => setShowSide(!showSide)}>
          {showSide ? 'hide overview' : 'overview'}
        </button>
      </div>
      {warnings}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          {list && <div className="text-xs text-zinc-500" aria-live="polite">Showing {matching.length} of {sessions.length} sessions</div>}
          {!list && <Empty>{error ? 'Session list unavailable; retrying…' : 'Loading…'}</Empty>}
          {list && matching.length === 0 && <Empty>{sessions.length === 0 ? 'No agent sessions in the last 24 hours.' : 'No sessions match. Pick all, untick live only, or clear the search.'}</Empty>}
          {goalGroups.length > 0 && (
            <div className="space-y-2">
              <SectionLabel label="Foundry agents" count={goalGroups.reduce((n, g) => n + g.rows.length, 0)} />
              {goalGroups.map((g) => <GroupCard key={g.id} g={g} open={isOpen(g)} onToggle={() => toggle(g)} onOpen={openSession} onKill={kill} />)}
            </div>
          )}
          {folderGroups.length > 0 && (
            <div className="space-y-2">
              <SectionLabel label="Your sessions" count={folderGroups.reduce((n, g) => n + g.rows.length, 0)} />
              {folderGroups.map((g) => <GroupCard key={g.id} g={g} open={isOpen(g)} onToggle={() => toggle(g)} onOpen={openSession} onKill={kill} />)}
            </div>
          )}
        </div>
        <div ref={affix.ref} className={cn(showSide ? 'block' : 'hidden lg:block', affix.className)}>{list && <Overview sessions={sessions} />}</div>
      </div>

      <ConfirmDialog open={!!killRow} danger busy={killing} title="Stop this session?" confirmLabel="Stop session" onConfirm={doKill} onClose={() => setKillRow(null)}>
        The running agent process for {killRow?.foundry?.goalTitle ? <b>{killRow.foundry.goalTitle}</b> : 'this task'} is killed. The engine may retry the task per its normal policy.
      </ConfirmDialog>
    </div>
  );
}

const COLLAPSED_KEY = 'foundry.agents.collapsed';
const SUBS_KEY = 'foundry.agents.subagents';
function readSubs(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(SUBS_KEY) ?? '{}'); } catch { return {}; }
}
function readCollapsed(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}'); } catch { return {}; }
}

/** one card: a goal's sessions (Foundry's), or the sessions the person opened in one folder */
type SessionGroup = { id: string; kind: 'goal' | 'folder'; title: string | null; goal: GoalRow | null; dir: string | null; rows: AgentSessionRow[] };

function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="text-[10px] text-zinc-600">{count}</span>
      <span className="flex-1 h-px bg-zinc-800/70" />
    </div>
  );
}

/** a goal's or a folder's sessions: header (fold, badge, name, coding agent, counts, folder), rows zebra striped under it */
function GroupCard({ g, open, onToggle, onOpen, onKill }: { g: SessionGroup; open: boolean; onToggle: () => void; onOpen: (sessionId: string, agentId?: string) => void; onKill: (row: AgentSessionRow) => void }) {
  const busy = g.rows.filter((r) => r.status === 'busy').length;
  const idle = g.rows.filter((r) => r.status === 'idle').length;
  const last = g.rows.map((r) => r.lastActivityAt).filter(Boolean).sort().pop();
  const panel = `agents-${g.id || 'none'}`;
  const providers = [...new Set(g.rows.map((r) => r.provider))];
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60">
      <header className="px-3 sm:px-4 py-2.5 space-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <button className="flex items-center gap-2 min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-emerald-500 rounded" aria-expanded={open} aria-controls={panel} onClick={onToggle} title={open ? 'collapse' : 'expand'}>
            {open ? <ChevronDown size={14} className="text-zinc-500 shrink-0" /> : <ChevronRight size={14} className="text-zinc-500 shrink-0" />}
            <Badge state={g.kind === 'goal' ? 'foundry' : 'user'} className="shrink-0">{g.kind === 'goal' ? 'Foundry' : 'Yours'}</Badge>
            <span className="text-sm font-semibold text-zinc-100 truncate">{g.title ?? (g.kind === 'goal' ? 'Goal no longer exists' : 'No folder')}</span>
            {providers.map((p) => <ProviderBadge key={p ?? 'none'} provider={p} />)}
          </button>
          {g.goal && <Link to={`/goals/${g.id}`} className="shrink-0 text-[11px] text-zinc-500 hover:text-emerald-300" aria-label="Open goal"><span className="hidden sm:inline">Open goal </span>→</Link>}
          <span className="hidden sm:inline shrink-0 text-[11px] text-zinc-500 whitespace-nowrap">
            {g.rows.length} session{g.rows.length === 1 ? '' : 's'}
            {busy > 0 && <span className="text-emerald-400"> · {busy} working</span>}
            {idle > 0 && <> · {idle} idle</>}
            {last && <> · {ago(last)}</>}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-zinc-500 min-w-0 pl-6">
          {g.dir && <span className="flex items-center gap-1.5 min-w-0"><Folder size={11} className="shrink-0" aria-hidden="true" /><span className="mono truncate" title={g.dir}>{shortCwd(g.dir)}</span></span>}
          <span className="sm:hidden whitespace-nowrap">{g.rows.length} session{g.rows.length === 1 ? '' : 's'}{busy > 0 && <span className="text-emerald-400"> · {busy} working</span>}</span>
        </div>
      </header>
      {open && <div id={panel} className="border-t border-zinc-800 pb-1"><SessionList rows={g.rows} inGoal={g.kind === 'goal'} onOpen={onOpen} onKill={onKill} /></div>}
    </section>
  );
}

/** the side panel: the sessions by state, by coding agent and by model */
function Overview({ sessions }: { sessions: AgentSessionRow[] }) {
  const by = <K extends string>(key: (s: AgentSessionRow) => K | null | undefined) => {
    const m = new Map<K, number>();
    for (const s of sessions) {
      const k = key(s);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const states: { status: AgentSessionRow['status']; label: string }[] = [
    { status: 'busy', label: 'working' },
    { status: 'idle', label: 'waiting for input' },
    { status: 'finished', label: 'finished' },
    { status: 'unknown', label: 'state unknown' },
  ];
  const models = by((s) => (s.model ? shortModel(s.model) : null)).slice(0, 6);
  return (
    <Card title="Overview">
      <div className="text-xs space-y-3">
        <ul className="space-y-1.5">
          {states.map((st) => (
            <li key={st.status} className="flex items-center gap-2">
              <StatusDot status={st.status} />
              <span className="text-zinc-300">{st.label}</span>
              <span className="ml-auto mono text-zinc-400 tabular-nums">{sessions.filter((s) => s.status === st.status).length}</span>
            </li>
          ))}
        </ul>
        <ul className="space-y-1.5 border-t border-zinc-800 pt-3">
          {by((s) => s.provider).map(([p, n]) => (
            <li key={p} className="flex items-center gap-2">
              <ProviderBadge provider={p} />
              <span className="ml-auto mono text-zinc-400 tabular-nums">{n}</span>
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span className="text-zinc-500">Foundry · yours</span>
            <span className="ml-auto mono text-zinc-400 tabular-nums">{sessions.filter((s) => s.source === 'foundry').length} · {sessions.filter((s) => s.source === 'external').length}</span>
          </li>
        </ul>
        {models.length > 0 && (
          <div className="border-t border-zinc-800 pt-3 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Models</div>
            {models.map(([m, n]) => (
              <div key={m} className="flex items-center gap-2">
                <span className="mono text-zinc-300 truncate">{m}</span>
                <span className="ml-auto mono text-zinc-400 tabular-nums">{n}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-zinc-500 border-t border-zinc-800 pt-3">Click a session to read it. The last 24 hours; the list refreshes by itself.</p>
      </div>
    </Card>
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
  // a session's helper agents fold under it: open while one of them runs, until the person chooses (this browser)
  const [subs, setSubs] = useState<Record<string, boolean>>(readSubs);
  const subsOpen = (s: AgentSessionRow) => subs[s.sessionId] ?? s.subagents.some((a) => a.status === 'running');
  const toggleSubs = (s: AgentSessionRow) =>
    setSubs((m) => {
      const next = { ...m, [s.sessionId]: !subsOpen(s) };
      try { localStorage.setItem(SUBS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  return (
    <ul className="divide-y divide-zinc-800/70">
      {rows.map((s, i) => (
        <li key={s.sessionId} className={cn('ml-2 sm:ml-4 border-l-2 border-zinc-800/60 pl-2 sm:pl-3 pr-2 sm:pr-3', i % 2 === 1 && 'bg-zinc-900/50')}>
          <div role="button" tabIndex={0} onClick={() => onOpen(s.sessionId)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(s.sessionId); }} className={cn(ROW, 'py-2.5 cursor-pointer hover:bg-zinc-900/50 focus-visible:outline-2 focus-visible:outline-emerald-500 rounded')}>
            <span className="pt-1.5"><StatusDot status={s.status} /></span>
            <div className="min-w-0">
              <div className="text-sm text-zinc-100 truncate" title={s.foundry ? (s.title ?? undefined) : s.sessionId}>{title(s)}</div>
              <div className="mt-1 flex items-center gap-2 min-w-0 text-[11px] text-zinc-500">
                {s.foundry ? <AttemptChip kind={s.foundry.kind} attempt={s.foundry.attempt} /> : null}
                {s.foundry && s.foundry.taskTitle && s.title && s.title.replace(/^#+\s*/, '') !== s.foundry.taskTitle && <span className="truncate" title={s.title}>{s.title.replace(/^#+\s*/, '')}</span>}
                {!s.foundry && s.cwd && <span className="mono truncate" title={s.cwd}>{shortCwd(s.cwd)}{s.gitBranch ? <span className="text-zinc-600"> · {s.gitBranch}</span> : null}</span>}
                {s.status === 'unknown' && <span className="text-sky-400 whitespace-nowrap">status unknown</span>}
                {s.subagents.length > 0 && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 shrink-0 rounded border border-zinc-700 px-1.5 py-px text-[10px] text-zinc-400 hover:text-zinc-100 hover:border-zinc-500"
                    aria-expanded={subsOpen(s)}
                    title={subsOpen(s) ? 'Fold its helper agents' : 'Show its helper agents'}
                    onClick={(e) => { e.stopPropagation(); toggleSubs(s); }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {subsOpen(s) ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
                    {s.subagents.length} subagent{s.subagents.length === 1 ? '' : 's'}
                    {s.subagents.some((a) => a.status === 'running') && <span className="text-emerald-400"> · running</span>}
                  </button>
                )}
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
            <div className="flex justify-start sm:justify-end">
              {s.source === 'foundry' && s.foundry?.killable && (
                <Button size="sm" variant="danger" title="Stop this session" onClick={(e) => { e.stopPropagation(); onKill(s); }}>
                  <Square size={11} /> Stop
                </Button>
              )}
            </div>
          </div>
          {s.subagents.length > 0 && subsOpen(s) && (
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
const ROW = 'grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_12rem_7rem_4.5rem] gap-x-3 gap-y-1.5 items-start px-1 [&>*:nth-child(n+3)]:col-start-2 sm:[&>*:nth-child(n+3)]:col-start-auto';
