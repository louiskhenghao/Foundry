import type { AgentSessionRow, AgentsList } from '@foundry/engine/agents-types';
import { CornerDownRight, Square } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api.ts';
import { useLive } from '../../store.ts';
import { ago, Button, cn, ConfirmDialog, Empty, Page } from '../../ui.tsx';
import { ContextGauge } from './ContextGauge.tsx';
import { SessionDetail } from './SessionDetail.tsx';
import { SourceBadge, StatusDot, shortCwd, shortModel } from './rows.tsx';

/** Every Claude session on this machine (Foundry-spawned and external), read live from the engine — nothing stored. */
export function AgentsPage() {
  const version = useLive((s) => s.globalVersion);
  const [list, setList] = useState<AgentsList | null>(null);
  const [kill, setKill] = useState<AgentSessionRow | null>(null);
  const [killing, setKilling] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    const load = () => api.agents().then(setList).catch(() => {});
    const t = setTimeout(load, 150);
    const i = setInterval(load, 5_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [version]);

  // #<sessionId> or #<sessionId>/<agentId> selects the detail view (hash, per the app's sub-view convention)
  const [selId, selAgent] = loc.hash.slice(1).split('/');
  const open = (sessionId: string, agentId?: string) => nav({ hash: agentId ? `${sessionId}/${agentId}` : sessionId }, { replace: false });
  const selected = selId ? list?.sessions.find((s) => s.sessionId === selId) : null;

  const doKill = () => {
    if (!kill) return;
    setKilling(true);
    api
      .killAgent(kill.sessionId)
      .then(() => api.agents().then(setList).catch(() => {}))
      .catch(() => {})
      .finally(() => {
        setKilling(false);
        setKill(null);
      });
  };

  if (selId) {
    return (
      <Page width="lg">
        {selected ? <SessionDetail row={selected} agentId={selAgent ?? null} onOpen={open} onBack={() => nav({ hash: '' }, { replace: false })} /> : <Empty>{list ? 'This session is no longer in the last-24h window.' : 'Loading…'}</Empty>}
      </Page>
    );
  }

  const sessions = list?.sessions ?? [];
  // Foundry first (the engine's own agents), then everything the user opened themselves
  const groups = [
    { key: 'foundry', label: 'Foundry agents', hint: 'spawned by the engine for your goals — these can be stopped from here', accent: 'bg-violet-400', rows: sessions.filter((s) => s.source === 'foundry') },
    { key: 'external', label: 'Your sessions', hint: 'opened outside Foundry (VS Code, terminal) — watched, never touched', accent: 'bg-sky-400', rows: sessions.filter((s) => s.source === 'external') },
  ].filter((g) => g.rows.length > 0);
  return (
    <Page width="lg">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-zinc-100">Agents</h1>
        {list && (
          <span className="text-xs text-zinc-500">
            {list.summary.busy} working · {list.summary.idle} idle · {list.summary.finished} finished (24h)
          </span>
        )}
      </div>
      <p className="text-xs text-zinc-500 mb-4 max-w-2xl">
        Live view of every Claude Code session on this machine — Foundry's own agents and the ones you open yourself. Read straight from Claude Code, nothing is stored. Click a session to follow its conversation.
      </p>
      {!list && <Empty>Loading…</Empty>}
      {list && sessions.length === 0 && <Empty>No Claude sessions in the last 24 hours.</Empty>}

      {groups.map((g) => (
        <section key={g.key} className="mb-6">
          <div className="flex items-baseline gap-2 mb-2">
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
                  {s.source === 'external' && <SourceBadge row={s} />}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                  {s.model && <span className="mono">{shortModel(s.model)}</span>}
                  <ContextGauge used={s.contextUsedTokens} window={s.contextWindowTokens} />
                  {s.lastActivityAt && <span>{ago(s.lastActivityAt)} ago</span>}
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
                        <span className="text-zinc-100 truncate block" title={s.sessionId}>{s.title ?? s.foundry?.goalTitle ?? s.sessionId.slice(0, 8)}</span>
                      </td>
                      <td className="py-2 pr-3 max-w-40">
                        {s.source === 'foundry' ? <span className="text-xs text-violet-300 truncate block">{s.foundry?.goalTitle ?? '—'}</span> : <SourceBadge row={s} />}
                      </td>
                      <td className="py-2 pr-3 mono text-xs text-zinc-400 whitespace-nowrap">{s.model ? shortModel(s.model) : '—'}</td>
                      <td className="py-2 pr-3"><ContextGauge used={s.contextUsedTokens} window={s.contextWindowTokens} /></td>
                      <td className="py-2 pr-3 text-xs text-zinc-500 whitespace-nowrap" title={s.startedAt ? `started ${ago(s.startedAt)} ago` : undefined}>
                        {s.lastActivityAt ? `${ago(s.lastActivityAt)} ago` : '—'}
                      </td>
                      <td className="py-2 pr-3 mono text-xs text-zinc-500 max-w-[16rem]"><span className="truncate block" title={s.cwd ?? undefined}>{s.cwd ? shortCwd(s.cwd) : '—'}</span></td>
                      <td className="py-2">
                        {s.foundry?.killable && (
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
                          <span className="flex items-center gap-1.5 pl-4 text-xs text-zinc-400 min-w-0">
                            <CornerDownRight size={12} className="shrink-0 text-zinc-600" />
                            <span className="text-zinc-300 shrink-0">{a.agentType}</span>
                            <span className="truncate">{a.description}</span>
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-[11px] whitespace-nowrap" colSpan={2}>
                          {a.status === 'running' ? <span className="text-emerald-400">● running</span> : <span className="text-zinc-600">done</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-xs text-zinc-600 whitespace-nowrap" colSpan={3}>{a.lastActivityAt ? `${ago(a.lastActivityAt)} ago` : ''}</td>
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
        The running Claude process for {kill?.foundry?.goalTitle ? <b>{kill.foundry.goalTitle}</b> : 'this task'} is killed. The engine may retry the task per its normal policy.
      </ConfirmDialog>
    </Page>
  );
}
