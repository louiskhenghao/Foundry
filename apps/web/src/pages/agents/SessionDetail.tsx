import type { AgentSessionRow, AgentSubagentRow } from '@foundry/engine/agents-types';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LiveLog } from '../LiveLog.tsx';
import { PAGE_TITLE, ago, chipClass, cn } from '../../ui.tsx';
import { ContextGauge } from './ContextGauge.tsx';
import { FIGURE_LABEL, ProviderBadge, SourceBadge, StatusDot, shortCwd, shortModel } from './rows.tsx';
import { TranscriptView } from './TranscriptView.tsx';

/** a fact about the session, as a small plate in the row under its title (as a goal's facts) */
const FACT = 'inline-flex items-center gap-1.5 min-w-0 max-w-full rounded-md bg-panel px-2.5 py-1 text-[13px] font-semibold text-ink-soft ring-1 ring-inset ring-line';

/**
 * Detail for one session, headed as a goal's page is: its state and where it comes from, its title in large type, its
 * facts as small plates; then the conversation (LiveLog for Foundry rows, polled transcript otherwise).
 */
export function SessionDetail({ row, agentId, onOpen, onBack }: { row: AgentSessionRow; agentId: string | null; onOpen: (sessionId: string, agentId?: string) => void; onBack: () => void }) {
  const sub = agentId ? row.subagents.find((s) => s.agentId === agentId) : null;
  const facts: [string, React.ReactNode][] = [
    ['Model', row.model ? <span className="mono">{shortModel(row.model)}</span> : '—'],
    // the gauge draws nothing without a count: the plate says so as the others do
    ['Context', row.contextUsedTokens != null ? <ContextGauge used={row.contextUsedTokens} window={row.contextWindowTokens} /> : '—'],
    ['Directory', row.cwd ? <span className="mono" title={row.cwd}>{shortCwd(row.cwd)}</span> : '—'],
    ['Branch', row.gitBranch ? <span className="mono">{row.gitBranch}</span> : '—'],
    ['Started', row.startedAt ? <span className="mono">{ago(row.startedAt)}</span> : '—'],
    ['Last activity', row.lastActivityAt ? <span className="mono">{ago(row.lastActivityAt)}</span> : '—'],
  ];
  return (
    <div className="space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-bold text-ink hover:underline underline-offset-[3px]">
        <ArrowLeft size={14} aria-hidden="true" /> All agents
      </button>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusDot status={row.status} />
          <SourceBadge row={row} />
          <ProviderBadge provider={row.provider} />
          {row.foundry && (
            <Link to={`/goals/${row.foundry.goalId}`} className="inline-flex items-center gap-1 min-w-0 text-xs font-semibold text-work-ink hover:underline underline-offset-2">
              <ExternalLink size={12} className="shrink-0" /> <span className="truncate">{row.foundry.goalTitle ?? 'Open goal'}</span>
            </Link>
          )}
        </div>
        <h1 className={cn(PAGE_TITLE, 'text-ink line-clamp-3')}>{sub ? `${sub.agentType}: ${sub.description || sub.agentId}` : (row.title ?? row.sessionId)}</h1>
        {row.source === 'external' && row.provider === 'codex' && <p className="text-sm text-ink-faint">External Codex conversation, shown for reading only. Its live process state is unknown. Foundry does not resume, stop or modify this session.</p>}
        <dl className="flex flex-wrap gap-2">
          {facts.map(([k, v]) => (
            <div key={k} className={FACT}>
              <dt className="shrink-0 font-medium text-ink-faint">{k}</dt>
              <dd className="min-w-0 truncate text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        {row.subagents.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className={cn(FIGURE_LABEL, 'mr-1')}>Log:</span>
            <SubTab active={!agentId} onClick={() => onOpen(row.sessionId)}>session</SubTab>
            {row.subagents.map((s) => (
              <SubTab key={s.agentId} active={agentId === s.agentId} onClick={() => onOpen(row.sessionId, s.agentId)}>
                {s.agentType}: {(s.description || s.agentId).slice(0, 40)}
                <span className="ml-1"><SubagentStatus status={s.status} /></span>
              </SubTab>
            ))}
          </div>
        )}
      </header>
      {/* surface-card: on this page the log sits directly on the page, which in light shares zinc-950 — the card class keeps it a visible panel */}
      {!agentId && row.foundry?.attemptId ? <LiveLog attemptId={row.foundry.attemptId} className="surface-card max-h-[70vh]" /> : <TranscriptView sessionId={row.sessionId} agentId={agentId ?? undefined} />}
    </div>
  );
}

/** Native history can identify a child without proving whether its process is still alive. */
export function SubagentStatus({ status }: { status: AgentSubagentRow['status'] }) {
  return status === 'running' ? <span className="font-bold text-ink">● running</span> : status === 'unknown' ? <span className="text-work-ink" title="Live process state unknown">status unknown</span> : <span className="text-ink-faint">done</span>;
}

/** which log to read, as a chip; on the chosen one (filled with the accent) the status takes the chip's own colour */
function SubTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn(chipClass(active), active && '[&_span]:text-current')}>
      {children}
    </button>
  );
}
