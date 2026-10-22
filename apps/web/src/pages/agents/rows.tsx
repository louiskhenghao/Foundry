import type { AgentSessionRow, AgentStatus } from '@foundry/engine/agents-types';
import type { ReactNode } from 'react';
import { PROVIDER_STYLE } from '../../components/ProviderMark.tsx';
import { cn } from '../../ui.tsx';

/**
 * A session's state as a small square, in the marks the goals use: working flows (the hatch), waiting for input is
 * hollow, finished is solid grey; a liveness Foundry cannot see is hollow in the information colour. Outlines are
 * inset-ring-*: `ring-inset` is also the ring colour named after the theme's `inset`, and it overrides `ring-ink`.
 */
export function StatusDot({ status }: { status: AgentStatus }) {
  const cls = status === 'busy' ? 'hatch text-ink inset-ring-[1.5px] inset-ring-ink' : status === 'idle' ? 'inset-ring-[1.5px] inset-ring-ink' : status === 'unknown' ? 'inset-ring-[1.5px] inset-ring-work' : 'bg-line-strong';
  const label = status === 'busy' ? 'working' : status === 'idle' ? 'waiting for input' : status === 'unknown' ? 'Live process state unknown' : 'finished';
  return <span className={cn('inline-block h-3 w-3 rounded-[3px] shrink-0', cls)} role="img" aria-label={label} title={label} />;
}


/** The coding agent, with an icon and colour of its own so Claude Code and Codex tell apart at a glance; `compact` keeps the icon only. */
export function ProviderBadge({ provider, compact = false }: { provider: AgentSessionRow['provider']; compact?: boolean }) {
  const p = provider ? PROVIDER_STYLE[provider] : null;
  const label = p?.label ?? 'Agent unknown';
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-none shrink-0', p?.chip ?? 'border-zinc-700 text-zinc-400')} title={`Coding agent: ${label}`} aria-label={compact ? label : undefined}>
      {p && <p.Icon size={11} aria-hidden="true" className="shrink-0" />}
      {!compact && label}
    </span>
  );
}

/** a neutral small plate in capitals: where a session or a port comes from (FOUNDRY, YOURS, TAILSCALE, PROCESS…), never a signal */
export const PLATE = 'inline-flex items-center whitespace-nowrap rounded-sm border border-line-strong px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-soft';
/**
 * A quiet trait chip in small letters (a session's work, a kind of learning, a schedule that approves itself), as the
 * Goals page's; `tone` colours one that is a merge (the reviews' violet) or what goes wrong (red). One colour per chip:
 * a colour class added after another of the same property does not win by coming later.
 */
export const traitChip = (tone?: 'extra' | 'bad') => cn('inline-flex items-center whitespace-nowrap rounded-sm border px-1.5 py-px text-[10.5px] font-semibold leading-tight', tone === 'extra' ? 'border-extra/50 text-extra-ink' : tone === 'bad' ? 'border-bad/50 text-bad-ink' : 'border-line-strong/70 text-ink-soft');
/** the label of a figure or a fact: tiny capitals beside or over its mono figure */
export const FIGURE_LABEL = 'text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-faint';
/** a board's panel without its heading, for a list the page's own title already names */
export const BOARD_PANEL = 'overflow-hidden rounded-xl bg-panel shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.06)]';

/** nothing to list: its first sentence large, the rest under it, on a dashed panel (as the Goals page's empty state) */
export function EmptyPanel({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-6 py-14 text-center">
      <p className="text-lg font-bold text-ink">{title}</p>
      {children && <p className="mt-1 text-sm text-ink-faint">{children}</p>}
    </div>
  );
}

/** What a Foundry session did: a task's work or a merge (in the colour of reviews and merges), and which attempt. */
export function AttemptChip({ kind, attempt }: { kind?: 'work' | 'merge'; attempt?: number | null }) {
  if (!kind) return null;
  return (
    <span className={cn(traitChip(kind === 'merge' ? 'extra' : undefined), 'shrink-0')}>
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

/** where a session was opened, as a neutral plate: by Foundry, in VS Code, on the command line */
export function SourceBadge({ row }: { row: AgentSessionRow }) {
  const label = row.source === 'foundry' ? 'Foundry' : row.entrypoint === 'claude-vscode' ? 'VS Code' : row.entrypoint === 'cli' ? 'CLI' : (row.entrypoint ?? 'external');
  return <span className={cn(PLATE, 'shrink-0')}>{label}</span>;
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
