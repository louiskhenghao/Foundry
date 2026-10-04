import type { AgentSessionRow, AgentStatus } from '@foundry/engine/agents-types';
import { cn } from '../../ui.tsx';

export function StatusDot({ status }: { status: AgentStatus }) {
  const cls = status === 'busy' ? 'bg-emerald-400 animate-pulse' : status === 'idle' ? 'bg-zinc-500' : status === 'unknown' ? 'border border-sky-400 bg-transparent' : 'bg-zinc-700';
  const label = status === 'busy' ? 'working' : status === 'idle' ? 'waiting for input' : status === 'unknown' ? 'Live process state unknown' : 'finished';
  return <span className={cn('inline-block h-2 w-2 rounded-full shrink-0', cls)} role="img" aria-label={label} title={label} />;
}

export function ProviderBadge({ provider }: { provider: AgentSessionRow['provider'] }) {
  return <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 shrink-0" title="Coding agent">{provider === 'codex' ? 'Codex' : provider === 'claude' ? 'Claude Code' : 'Agent unknown'}</span>;
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
