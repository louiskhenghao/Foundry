import type { AgentSessionRow } from '@foundry/engine/agents-types';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LiveLog } from '../LiveLog.tsx';
import { ago, Card, cn } from '../../ui.tsx';
import { ContextGauge } from './ContextGauge.tsx';
import { SourceBadge, StatusDot, shortCwd, shortModel } from './rows.tsx';
import { TranscriptView } from './TranscriptView.tsx';

/** Detail for one session: metadata header + the conversation (LiveLog for Foundry rows, polled transcript otherwise). */
export function SessionDetail({ row, agentId, onOpen, onBack }: { row: AgentSessionRow; agentId: string | null; onOpen: (sessionId: string, agentId?: string) => void; onBack: () => void }) {
  const sub = agentId ? row.subagents.find((s) => s.agentId === agentId) : null;
  const facts: [string, React.ReactNode][] = [
    ['Model', row.model ? <span className="mono">{shortModel(row.model)}</span> : '—'],
    ['Context', <ContextGauge used={row.contextUsedTokens} window={row.contextWindowTokens} />],
    ['Directory', row.cwd ? <span className="mono" title={row.cwd}>{shortCwd(row.cwd)}</span> : '—'],
    ['Branch', row.gitBranch ? <span className="mono">{row.gitBranch}</span> : '—'],
    ['Started', row.startedAt ? `${ago(row.startedAt)} ago` : '—'],
    ['Last activity', row.lastActivityAt ? `${ago(row.lastActivityAt)} ago` : '—'],
  ];
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft size={14} /> All agents
      </button>
      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <StatusDot status={row.status} />
          <span className="font-medium text-zinc-100 min-w-0 truncate">{sub ? `${sub.agentType}: ${sub.description || sub.agentId}` : (row.title ?? row.sessionId)}</span>
          <SourceBadge row={row} />
          {row.foundry && (
            <Link to={`/goals/${row.foundry.goalId}`} className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300">
              <ExternalLink size={12} /> {row.foundry.goalTitle ?? 'Open goal'}
            </Link>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1.5 text-xs">
          {facts.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 min-w-0">
              <span className="text-zinc-500 shrink-0">{k}</span>
              <span className="text-zinc-300 min-w-0 truncate">{v}</span>
            </div>
          ))}
        </div>
        {row.subagents.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-zinc-500">Log:</span>
            <SubTab active={!agentId} onClick={() => onOpen(row.sessionId)}>session</SubTab>
            {row.subagents.map((s) => (
              <SubTab key={s.agentId} active={agentId === s.agentId} onClick={() => onOpen(row.sessionId, s.agentId)}>
                {s.agentType}: {(s.description || s.agentId).slice(0, 40)}
                {s.status === 'running' && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />}
              </SubTab>
            ))}
          </div>
        )}
      </Card>
      {/* surface-card: on this page the log sits directly on the page, which in light shares zinc-950 — the card class keeps it a visible panel */}
      {!agentId && row.foundry?.attemptId ? <LiveLog attemptId={row.foundry.attemptId} className="surface-card max-h-[70vh]" /> : <TranscriptView sessionId={row.sessionId} agentId={agentId ?? undefined} />}
    </div>
  );
}

function SubTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('rounded-md border px-2 py-0.5', active ? 'border-zinc-600 bg-zinc-800 text-zinc-100' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700')}>
      {children}
    </button>
  );
}
