import type { AgentSessionRow, AgentsList } from '@foundry/engine/agents-types';
import { CornerDownRight, Search, Square } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type AgentProvider } from '../../api.ts';
import { ProviderSelector } from '../../components/ProviderSelector.tsx';
import { useLive } from '../../store.ts';
import { ago, Button, cn, ConfirmDialog, Empty, Page } from '../../ui.tsx';
import { ContextGauge } from './ContextGauge.tsx';
import { SessionDetail, SubagentStatus } from './SessionDetail.tsx';
import { ProviderBadge, SourceBadge, StatusDot, shortCwd, shortModel } from './rows.tsx';

/** Foundry agent sessions and external native sessions; outside sessions are only observed. */
export function AgentsPage() {
  const version = useLive((s) => s.globalVersion);
  const [list, setList] = useState<AgentsList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kill, setKill] = useState<AgentSessionRow | null>(null);
  const [killing, setKilling] = useState(false);
  const [provider, setProvider] = useState<AgentProvider | 'all'>('all');
  const [query, setQuery] = useState('');
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    let alive = true;
    const load = () => api.agents().then((value) => { if (alive) { setList(value); setError(null); } }).catch((e) => { if (alive) setError(e.message); });
    const t = setTimeout(load, 150);
    const i = setInterval(load, 5_000);
    return () => {
      alive = false;
      clearTimeout(t);
      clearInterval(i);
    };
  }, [version]);

  // #<sessionId> or #<sessionId>/<agentId> selects the detail view (hash, per the app's sub-view convention)
  const [selId, selAgent] = loc.hash.slice(1).split('/');
  const open = (sessionId: string, agentId?: string) => nav({ hash: agentId ? `${sessionId}/${agentId}` : sessionId }, { replace: false });
  const selected = selId ? list?.sessions.find((s) => s.sessionId === selId) : null;

  const doKill = () => {
    if (!kill || kill.source !== 'foundry' || !kill.foundry?.killable) return;
    setKilling(true);
    api
      .killAgent(kill.sessionId)
      .then(() => api.agents().then(setList).catch(() => {}))
      .catch((e) => setError(e.message))
      .finally(() => {
        setKilling(false);
        setKill(null);
      });
  };

  const warnings = <>{error && <div role="alert" className="text-xs text-rose-300 mb-3">{error}</div>}{list?.warnings?.map((warning, index) => <div key={index} className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200 mb-3">{warning}</div>)}</>;
  if (selId) {
    return (
      <Page width="lg">
        {warnings}
        {selected ? <SessionDetail row={selected} agentId={selAgent ?? null} onOpen={open} onBack={() => nav({ hash: '' }, { replace: false })} /> : <Empty>{list ? 'This session is no longer in the last-24h window.' : 'Loading…'}</Empty>}
      </Page>
    );
  }

  const sessions = list?.sessions ?? [];
  const matching = sessions.filter(s => (provider === 'all' || s.provider === provider) &&
    [s.title, s.foundry?.goalTitle, s.cwd, s.model, s.sessionId].some(value => value?.toLowerCase().includes(query.trim().toLowerCase())));
  const counts = { all: sessions.length, claude: sessions.filter(s => s.provider === 'claude').length, codex: sessions.filter(s => s.provider === 'codex').length };
  // Foundry first (the engine's own agents), then everything the user opened themselves
  const groups = [
    { key: 'foundry', label: 'Foundry agents', hint: 'Sessions for your goals. Running sessions can be stopped here.', accent: 'bg-violet-400', rows: matching.filter((s) => s.source === 'foundry') },
    { key: 'external', label: 'Your sessions', hint: 'From your terminal or editor. History is read-only.', accent: 'bg-sky-400', rows: matching.filter((s) => s.source === 'external') },
  ].filter((g) => g.rows.length > 0);
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
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search sessions, models, directories…" className="w-full rounded-lg border border-zinc-800 bg-zinc-950/50 py-2.5 pl-9 pr-3 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
        </label>
      </div>
      {warnings}
      {list && <div className="mb-3 text-xs text-zinc-500" aria-live="polite">Showing {matching.length} of {sessions.length} sessions · refreshes automatically</div>}
      {!list && <Empty>{error ? 'Session list unavailable; retrying…' : 'Loading…'}</Empty>}
      {list && matching.length === 0 && <Empty>{sessions.length === 0 ? 'No agent sessions in the last 24 hours.' : 'No sessions match this engine and search. Try All engines or clear the search.'}</Empty>}

      {groups.map((g) => (
        <section key={g.key} className="mb-6">
          <div className="flex items-baseline gap-2 flex-wrap mb-2">
            <span className={cn('h-2 w-2 rounded-full self-center shrink-0', g.accent)} />
            <h2 className="text-sm font-medium text-zinc-200">{g.label}</h2>
            <span className="text-[11px] text-zinc-600">{g.rows.length} · {g.hint}</span>
          </div>

          {/* phones: card stack */}
          <div className="sm:hidden space-y-2">
            {g.rows.map((s) => (
              <button key={s.sessionId} onClick={() => open(s.sessionId)} className="w-full text-left surface-card border border-zinc-800 rounded-md p-3 space-y-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusDot status={s.status} />
                  <span className="text-sm text-zinc-100 truncate flex-1">{s.title ?? s.foundry?.goalTitle ?? s.sessionId.slice(0, 8)}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap"><ProviderBadge provider={s.provider} />{s.source === 'external' && <SourceBadge row={s} />}{s.status === 'unknown' && <span className="text-[10px] text-sky-400">status unknown</span>}</div>
                <div className="flex items-center gap-3 flex-wrap text-[11px] text-zinc-500">
                  {s.model && <span className="mono break-all">{shortModel(s.model)}</span>}
                  <ContextGauge used={s.contextUsedTokens} window={s.contextWindowTokens} />
                  {s.lastActivityAt && <span>{ago(s.lastActivityAt)}</span>}
                </div>
              </button>
            ))}
          </div>

          {/* desktop: table with subagents nested under their parent */}
          <div className="hidden sm:block overflow-x-auto rounded-lg border border-zinc-800 px-3 surface-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
                  <th className="py-2 pr-3 font-medium w-6" />
                  <th className="py-2 pr-3 font-medium">Session</th>
                  <th className="py-2 pr-3 font-medium">{g.key === 'foundry' ? 'Goal' : 'Opened in'}</th>
                  <th className="py-2 pr-3 font-medium">Model</th>
                  <th className="py-2 pr-3 font-medium">Context</th>
                  <th className="py-2 pr-3 font-medium">Activity</th>
                  <th className="py-2 pr-3 font-medium">Directory</th>
                  <th className="py-2 font-medium w-8" />
                </tr>
              </thead>
              <tbody>
                {g.rows.map((s) => (
                  <Fragment key={s.sessionId}>
                    <tr className="border-b border-zinc-900 hover:bg-zinc-900/50 cursor-pointer" onClick={() => open(s.sessionId)}>
                      <td className="py-2 pr-3"><StatusDot status={s.status} /></td>
                      <td className="py-2 pr-3 max-w-88">
                        <button className="text-zinc-100 truncate block max-w-full text-left hover:text-emerald-300 focus-visible:outline-2 focus-visible:outline-emerald-500" title={s.sessionId} onClick={e => { e.stopPropagation(); open(s.sessionId); }}>{s.title ?? s.foundry?.goalTitle ?? s.sessionId.slice(0, 8)}</button>
                        <div className="mt-1 flex items-center gap-2 flex-wrap"><ProviderBadge provider={s.provider} />{s.status === 'unknown' && <span className="text-[10px] text-sky-400">status unknown</span>}</div>
                      </td>
                      <td className="py-2 pr-3 max-w-40">
                        {s.source === 'foundry' ? <span className="text-xs text-violet-300 truncate block">{s.foundry?.goalTitle ?? '—'}</span> : <SourceBadge row={s} />}
                      </td>
                      <td className="py-2 pr-3 mono text-xs text-zinc-400 whitespace-nowrap">{s.model ? shortModel(s.model) : '—'}</td>
                      <td className="py-2 pr-3"><ContextGauge used={s.contextUsedTokens} window={s.contextWindowTokens} /></td>
                      <td className="py-2 pr-3 text-xs text-zinc-500 whitespace-nowrap" title={s.startedAt ? `started ${ago(s.startedAt)}` : undefined}>
                        {s.lastActivityAt ? ago(s.lastActivityAt) : '—'}
                      </td>
                      <td className="py-2 pr-3 mono text-xs text-zinc-500 max-w-[16rem]"><span className="truncate block" title={s.cwd ?? undefined}>{s.cwd ? shortCwd(s.cwd) : '—'}</span></td>
                      <td className="py-2">
                        {s.source === 'foundry' && s.foundry?.killable && (
                          <Button size="sm" variant="ghost" title="Stop this session" onClick={(e) => { e.stopPropagation(); setKill(s); }}>
                            <Square size={12} className="text-rose-400" />
                          </Button>
                        )}
                      </td>
                    </tr>
                    {s.subagents.map((a) => (
                      <tr key={`${s.sessionId}/${a.agentId}`} className="border-b border-zinc-900/60 hover:bg-zinc-900/50 cursor-pointer" onClick={() => open(s.sessionId, a.agentId)}>
                        <td className="py-1.5 pr-3" />
                        <td className="py-1.5 pr-3 max-w-88" colSpan={2}>
                          <button className="flex items-center gap-1.5 pl-4 text-xs text-zinc-400 min-w-0 max-w-full text-left hover:text-emerald-300 focus-visible:outline-2 focus-visible:outline-emerald-500" onClick={e => { e.stopPropagation(); open(s.sessionId, a.agentId); }}>
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
        </section>
      ))}

      <ConfirmDialog open={!!kill} danger busy={killing} title="Stop this session?" confirmLabel="Stop session" onConfirm={doKill} onClose={() => setKill(null)}>
        The running agent process for {kill?.foundry?.goalTitle ? <b>{kill.foundry.goalTitle}</b> : 'this task'} is killed. The engine may retry the task per its normal policy.
      </ConfirmDialog>
    </Page>
  );
}
