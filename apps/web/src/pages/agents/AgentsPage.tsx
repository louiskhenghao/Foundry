import { AGENT_PROVIDERS, PROVIDER_LABEL } from '@foundry/core/browser';
import type { AgentSessionRow, AgentsList } from '@foundry/engine/agents-types';
import { Bot, ChevronDown, ChevronRight, CornerDownRight, Folder, Search, Square, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, type AgentProvider, type GoalRow } from '../../api.ts';
import { useLive } from '../../store.ts';
import { ago, BOARD_ROW, Board, Button, Card, chipClass, cn, ConfirmDialog, Empty, Input, Page, PageHeader, useAffix } from '../../ui.tsx';
import { ContextGauge } from './ContextGauge.tsx';
import { SessionDetail, SubagentStatus } from './SessionDetail.tsx';
import { AttemptChip, EmptyPanel, FIGURE_LABEL, PLATE, ProviderBadge, ranFor, SourceBadge, StatusDot, shortCwd, shortModel, traitChip } from './rows.tsx';

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

  // a history that could not be read is said quietly: nothing waits for the person here
  const warnings = <>{error && <div role="alert" className="text-xs text-bad-ink mb-3">{error}</div>}{list?.warnings?.map((warning, index) => <div key={index} className="rounded-md border border-line bg-panel px-3 py-2 text-xs text-ink-soft mb-3">{warning}</div>)}</>;
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
    <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-16 space-y-4">
      <PageHeader
        title="Agents"
        summary={
          <>
            {sum && (
              <span className="block">
                {/* the sessions at work lead, in ink with the running hatch; every count in mono */}
                <span className={cn(sum.busy > 0 && 'font-bold text-ink')}>
                  {sum.busy > 0 && <i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[2px] align-[-1px] hatch text-ink inset-ring-1 inset-ring-ink" aria-hidden="true" />}
                  <span className="mono">{sum.busy}</span> working
                </span>{' '}
                · <span className="mono">{sum.idle}</span> idle · <span className="mono">{sum.finished}</span> finished{(sum.unknown ?? 0) > 0 && <> · <span className="mono">{sum.unknown}</span> unknown</>} (24h)
              </span>
            )}
            <span className="block mt-1">Every coding agent, together: the sessions Foundry runs for your goals, and the ones you opened yourself, from the last 24 hours. Foundry's can be stopped here; yours are read-only, and an external Codex session's live state is unknown.</span>
          </>
        }
        actions={<span className="text-xs text-ink-faint">refreshes every 5 s</span>}
      />

      <div className="flex items-center gap-2 flex-wrap">
        {(['all', ...AGENT_PROVIDERS] as const).map((p) => (
          <button key={p} onClick={() => setProvider(p)} className={chipClass(provider === p)}>
            {p === 'all' ? 'all' : PROVIDER_LABEL[p]} <span className="mono opacity-60">{list ? counts[p] : ''}</span>
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft" title="working or waiting for input">
          <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} /> live only
        </label>
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={13} className="absolute left-2 top-2 text-ink-faint" aria-hidden="true" />
          <Input type="search" className="pl-7 py-1 text-xs" placeholder="search sessions, goals, tasks, models, folders" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search sessions" />
        </div>
        {all.length > 1 && (
          <span className="flex items-center gap-2 text-xs text-ink-faint">
            <button type="button" className="hover:text-ink" onClick={() => setAll(false)}>expand all</button>
            <span className="text-line-strong">·</span>
            <button type="button" className="hover:text-ink" onClick={() => setAll(true)}>collapse all</button>
          </span>
        )}
        <button className="lg:hidden text-xs font-semibold underline underline-offset-2 text-ink-soft hover:text-ink" onClick={() => setShowSide(!showSide)}>
          {showSide ? 'hide overview' : 'overview'}
        </button>
      </div>
      {warnings}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 min-w-0">
          {list && <div className="mb-4 text-xs text-ink-faint" aria-live="polite">Showing {matching.length} of {sessions.length} sessions</div>}
          {!list && <Empty>{error ? 'Session list unavailable; retrying…' : 'Loading…'}</Empty>}
          {list && matching.length === 0 && (sessions.length === 0 ? <EmptyPanel title="No agent sessions in the last 24 hours." /> : <EmptyPanel title="No sessions match.">Pick all, untick live only, or clear the search.</EmptyPanel>)}
          {/* the boards in a box of their own, so the first sits right under the line above */}
          <div>
            {goalGroups.length > 0 && (
              <Board id="foundry-agents" icon={<Bot size={14} aria-hidden="true" />} title="Foundry agents" count={goalGroups.reduce((n, g) => n + g.rows.length, 0)}>
                {goalGroups.map((g) => <GroupCard key={g.id} g={g} open={isOpen(g)} onToggle={() => toggle(g)} onOpen={openSession} onKill={kill} />)}
              </Board>
            )}
            {folderGroups.length > 0 && (
              <Board id="your-sessions" icon={<User size={14} aria-hidden="true" />} title="Your sessions" count={folderGroups.reduce((n, g) => n + g.rows.length, 0)}>
                {folderGroups.map((g) => <GroupCard key={g.id} g={g} open={isOpen(g)} onToggle={() => toggle(g)} onOpen={openSession} onKill={kill} />)}
              </Board>
            )}
          </div>
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

/** one group of sessions, a row of its board: a goal's (Foundry's), or the ones the person opened in one folder */
type SessionGroup = { id: string; kind: 'goal' | 'folder'; title: string | null; goal: GoalRow | null; dir: string | null; rows: AgentSessionRow[] };

/**
 * A goal's or a folder's sessions as one row of its board: fold, plate, name and coding agent, then the folder and the
 * counts (the working ones in ink); open, its sessions are listed under it, indented.
 */
function GroupCard({ g, open, onToggle, onOpen, onKill }: { g: SessionGroup; open: boolean; onToggle: () => void; onOpen: (sessionId: string, agentId?: string) => void; onKill: (row: AgentSessionRow) => void }) {
  const busy = g.rows.filter((r) => r.status === 'busy').length;
  const idle = g.rows.filter((r) => r.status === 'idle').length;
  const last = g.rows.map((r) => r.lastActivityAt).filter(Boolean).sort().pop();
  const panel = `agents-${g.id || 'none'}`;
  const providers = [...new Set(g.rows.map((r) => r.provider))];
  return (
    <li>
      <div className={cn(BOARD_ROW, 'px-4 md:px-5 py-3.5')}>
        <div className="flex items-center gap-2.5 min-w-0">
          {/* the fold button covers the row, as a goal's title link covers its row */}
          <button className="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-accent" aria-expanded={open} aria-controls={panel} onClick={onToggle} title={open ? 'collapse' : 'expand'}>
            {open ? <ChevronDown size={14} className="text-ink-faint shrink-0" /> : <ChevronRight size={14} className="text-ink-faint shrink-0" />}
            <span className={cn(PLATE, 'shrink-0')}>{g.kind === 'goal' ? 'Foundry' : 'Yours'}</span>
            <span className="min-w-0 text-[15px] font-bold leading-snug text-ink break-words line-clamp-2 sm:line-clamp-1 group-hover:underline decoration-2 underline-offset-[3px]">{g.title ?? (g.kind === 'goal' ? 'Goal no longer exists' : 'No folder')}</span>
            {providers.map((p) => <ProviderBadge key={p ?? 'none'} provider={p} />)}
          </button>
          {g.goal && <Link to={`/goals/${g.id}`} className="relative z-10 shrink-0 text-xs font-semibold text-ink-soft hover:text-ink hover:underline underline-offset-2" aria-label="Open goal"><span className="hidden sm:inline">Open goal </span>→</Link>}
        </div>
        {/* from sm up the folder gives way to the counts; a phone puts the counts on a line of their own */}
        <div className="mt-1.5 flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-1 pl-6 text-xs text-ink-faint min-w-0">
          {g.dir && <span className="flex items-center gap-1.5 min-w-0 max-w-full"><Folder size={12} className="shrink-0" aria-hidden="true" /><span className="mono truncate" title={g.dir}>{shortCwd(g.dir)}</span></span>}
          <span className="sm:ml-auto shrink-0 whitespace-nowrap">
            <span className="mono">{g.rows.length}</span> session{g.rows.length === 1 ? '' : 's'}
            {busy > 0 && <> · <b className="font-bold text-ink"><span className="mono">{busy}</span> working</b></>}
            {idle > 0 && <> · <span className="mono">{idle}</span> idle</>}
            {last && <> · <span className="mono">{ago(last)}</span></>}
          </span>
        </div>
      </div>
      {open && <div id={panel} className="border-t border-line bg-inset/60"><SessionList rows={g.rows} inGoal={g.kind === 'goal'} onOpen={onOpen} onKill={onKill} /></div>}
    </li>
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
      <div className="text-xs space-y-4">
        {/* each state's mark beside its name, so the panel is also the key to the rows' marks */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {states.map((st) => (
            <div key={st.status} className="min-w-0">
              <dt className={cn(FIGURE_LABEL, 'flex items-center gap-1.5 leading-tight')}>
                <StatusDot status={st.status} />
                {st.label}
              </dt>
              <dd className="mt-1 text-2xl font-bold mono text-ink tabular-nums leading-none">{sessions.filter((s) => s.status === st.status).length}</dd>
            </div>
          ))}
        </dl>
        <ul className="space-y-2 border-t border-line pt-3">
          {by((s) => s.provider).map(([p, n]) => (
            <li key={p} className="flex items-center gap-2">
              <ProviderBadge provider={p} />
              <span className="ml-auto mono text-sm font-bold text-ink tabular-nums">{n}</span>
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span className={FIGURE_LABEL}>Foundry · yours</span>
            <span className="ml-auto mono text-sm font-bold text-ink tabular-nums">{sessions.filter((s) => s.source === 'foundry').length} · {sessions.filter((s) => s.source === 'external').length}</span>
          </li>
        </ul>
        {models.length > 0 && (
          <div className="border-t border-line pt-3 space-y-2">
            <div className={FIGURE_LABEL}>Models</div>
            {models.map(([m, n]) => (
              <div key={m} className="flex items-center gap-2">
                <span className="mono text-ink-soft truncate">{m}</span>
                <span className="ml-auto mono text-sm font-bold text-ink tabular-nums">{n}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-ink-faint border-t border-line pt-3">Click a session to read it. The last 24 hours; the list refreshes by itself.</p>
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
    <ul className="divide-y divide-line">
      {rows.map((s) => (
        <li key={s.sessionId}>
          <div role="button" tabIndex={0} onClick={() => onOpen(s.sessionId)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(s.sessionId); }} className={cn(ROW, 'py-3 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent')}>
            <span className="pt-1"><StatusDot status={s.status} /></span>
            <div className="min-w-0">
              <div className="text-sm font-bold text-ink truncate group-hover:underline decoration-2 underline-offset-[3px]" title={s.foundry ? (s.title ?? undefined) : s.sessionId}>{title(s)}</div>
              <div className="mt-1 flex items-center gap-2 min-w-0 text-xs text-ink-faint">
                {s.foundry ? <AttemptChip kind={s.foundry.kind} attempt={s.foundry.attempt} /> : null}
                {s.foundry && s.foundry.taskTitle && s.title && s.title.replace(/^#+\s*/, '') !== s.foundry.taskTitle && <span className="truncate" title={s.title}>{s.title.replace(/^#+\s*/, '')}</span>}
                {!s.foundry && s.cwd && <span className="mono truncate" title={s.cwd}>{shortCwd(s.cwd)}{s.gitBranch ? <span className="text-ink-soft"> · {s.gitBranch}</span> : null}</span>}
                {s.status === 'unknown' && <span className="text-work-ink whitespace-nowrap">status unknown</span>}
                {s.subagents.length > 0 && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 shrink-0 rounded-sm px-1.5 py-px text-[11px] font-semibold text-ink-soft inset-ring-1 inset-ring-line-strong hover:text-ink hover:inset-ring-ink-faint"
                    aria-expanded={subsOpen(s)}
                    title={subsOpen(s) ? 'Fold its helper agents' : 'Show its helper agents'}
                    onClick={(e) => { e.stopPropagation(); toggleSubs(s); }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {subsOpen(s) ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
                    {s.subagents.length} subagent{s.subagents.length === 1 ? '' : 's'}
                    {s.subagents.some((a) => a.status === 'running') && <span className="font-bold text-ink"> · running</span>}
                  </button>
                )}
              </div>
            </div>
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                {!inGoal && <ProviderBadge provider={s.provider} compact />}
                <span className="mono text-xs text-ink-soft truncate">{s.model ? shortModel(s.model) : '—'}</span>
              </div>
              <ContextGauge used={s.contextUsedTokens} window={s.contextWindowTokens} />
            </div>
            <div className="text-xs text-ink-faint space-y-1.5 sm:text-right">
              <div className="mono whitespace-nowrap" title={s.startedAt ? `started ${ago(s.startedAt)}` : undefined}>{s.lastActivityAt ? ago(s.lastActivityAt) : '—'}</div>
              <div className="flex sm:justify-end">{s.source === 'external' ? <SourceBadge row={s} /> : <span className="mono text-[11px] whitespace-nowrap">{ranFor(s.startedAt, s.endedAt ?? s.lastActivityAt) ?? ''}</span>}</div>
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
                  <div role="button" tabIndex={0} onClick={() => onOpen(s.sessionId, a.agentId)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(s.sessionId, a.agentId); }} className={cn(ROW, 'py-2 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent')}>
                    <span />
                    <div className="flex items-start gap-1.5 min-w-0 pl-3 border-l-2 border-line">
                      <CornerDownRight size={12} className="shrink-0 mt-1 text-ink-faint" aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-ink-soft truncate group-hover:underline underline-offset-2" title={a.description}>{a.description || a.agentType}</div>
                        <div className="mt-1 flex items-center gap-2 text-[11px]"><span className={traitChip()}>{a.agentType}</span><SubagentStatus status={a.status} /></div>
                      </div>
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <span className="mono text-[11px] text-ink-soft truncate block">{a.model ? shortModel(a.model) : ''}</span>
                      <ContextGauge used={a.contextUsedTokens ?? null} window={a.contextWindowTokens ?? null} />
                    </div>
                    <div className="mono text-[11px] text-ink-faint space-y-1.5 sm:text-right">
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

/**
 * One grid for sessions and their subagents, so the columns line up; phones stack it. Rows of a board, indented under
 * their group's row; a subagent indents further inside its own cell.
 */
const ROW = cn(BOARD_ROW, 'grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_10rem_6rem_4.5rem] gap-x-3 gap-y-1.5 items-start pl-8 sm:pl-10 pr-4 md:pr-5 [&>*:nth-child(n+3)]:col-start-2 sm:[&>*:nth-child(n+3)]:col-start-auto');
