import type { AgentSessionRow, AgentStatus } from '@foundry/engine/agents-types';
import { Sparkle, SquareTerminal } from 'lucide-react';
import { cn } from '../../ui.tsx';

export function StatusDot({ status }: { status: AgentStatus }) {
  const cls = status === 'busy' ? 'bg-emerald-400 animate-pulse' : status === 'idle' ? 'bg-zinc-500' : status === 'unknown' ? 'border border-sky-400 bg-transparent' : 'bg-zinc-700';
  const label = status === 'busy' ? 'working' : status === 'idle' ? 'waiting for input' : status === 'unknown' ? 'Live process state unknown' : 'finished';
  return <span className={cn('inline-block h-2 w-2 rounded-full shrink-0', cls)} role="img" aria-label={label} title={label} />;
}

const PROVIDERS = {
  claude: { label: 'Claude Code', Icon: Sparkle, cls: 'border-orange-500/40 bg-orange-500/10 text-orange-300' },
  codex: { label: 'Codex', Icon: SquareTerminal, cls: 'border-blue-500/40 bg-blue-500/10 text-blue-300' },
} as const;

/** The coding agent, with an icon and colour of its own so Claude Code and Codex tell apart at a glance; `compact` keeps the icon only. */
export function ProviderBadge({ provider, compact = false }: { provider: AgentSessionRow['provider']; compact?: boolean }) {
  const p = provider ? PROVIDERS[provider] : null;
  const label = p?.label ?? 'Agent unknown';
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-none shrink-0', p?.cls ?? 'border-zinc-700 text-zinc-400')} title={`Coding agent: ${label}`} aria-label={compact ? label : undefined}>
      {p && <p.Icon size={11} aria-hidden="true" className="shrink-0" />}
      {!compact && label}
    </span>
  );
}

/** What a Foundry session did: a task's work or a merge, and which attempt. */
export function AttemptChip({ kind, attempt }: { kind?: 'work' | 'merge'; attempt?: number | null }) {
  if (!kind) return null;
  return (
    <span className={cn('inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] leading-none whitespace-nowrap shrink-0', kind === 'merge' ? 'border-fuchsia-500/40 text-fuchsia-300' : 'border-zinc-700 text-zinc-400')}>
      {kind === 'merge' ? 'merge' : 'work'}{attempt ? ` · attempt ${attempt}` : ''}
    </span>
  );
}

/** "ran 12m" between two timestamps; null when either is missing. */
export function ranFor(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start || !end) return null;
  const m = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000));
  return Number.isFinite(m) ? `ran ${m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`}` : null;
}

export function SourceBadge({ row }: { row: AgentSessionRow }) {
  const [label, cls] =
    row.source === 'foundry'
      ? ['Foundry', 'border-violet-500/40 text-violet-300']
      : row.entrypoint === 'claude-vscode'
        ? ['VS Code', 'border-sky-500/40 text-sky-300']
        : row.entrypoint === 'cli'
          ? ['CLI', 'border-zinc-600 text-zinc-300']
          : [row.entrypoint ?? 'external', 'border-zinc-600 text-zinc-400'];
  return <span className={cn('rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide shrink-0', cls)}>{label}</span>;
}

export const shortModel = (m: string) => m.replace(/^claude-/, '');

export function shortCwd(cwd: string): string {
  const wt = cwd.match(/\/data\/worktrees\/(.+)$/);
  if (wt) return `worktrees/${wt[1]}`;
  // progress folders: `<repo>-foundry/<goal>` and their hidden `.foundry/<goal>/tasks/<id>` siblings
  const pf = cwd.match(/\/([^/]+-foundry\/.+)$/);
  if (pf) return pf[1]!;
  return cwd.replace(/^\/Users\/[^/]+/, '~');
}
