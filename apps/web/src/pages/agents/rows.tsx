import type { AgentSessionRow, AgentStatus } from '@foundry/engine/agents-types';
import type { ReactNode } from 'react';
import { PROVIDER_STYLE } from '../../components/ProviderMark.tsx';
import { cn, code } from '../../ui.tsx';

/**
 * A session's state as a small square, in the marks the goals use: working flows in blue (the hatch), waiting for input
 * is hollow ink, finished is solid grey (the page cannot tell whether it went well), and a liveness Foundry cannot see is
 * hollow grey. Outlines are inset-ring-*, which draw inside the square.
 */
export function StatusDot({ status }: { status: AgentStatus }) {
  const cls = status === 'busy' ? 'hatch text-work inset-ring-[1.5px] inset-ring-work' : status === 'idle' ? 'inset-ring-[1.5px] inset-ring-ink' : status === 'unknown' ? 'inset-ring-[1.5px] inset-ring-line-strong' : 'bg-line-strong';
  const label = status === 'busy' ? 'working' : status === 'idle' ? 'waiting for input' : status === 'unknown' ? 'Live process state unknown' : 'finished';
  return <span className={cn('inline-block h-3 w-3 rounded-[3px] shrink-0', cls)} role="img" aria-label={label} title={label} />;
}


/**
 * The coding agent, with an icon and colour of its own so Claude Code and Codex tell apart at a glance; `compact` keeps
 * the icon only. `md`: the size of a page head's facts (the goal page, the Brief), the same type and height as they.
 */
export function ProviderBadge({ provider, compact = false, size = 'sm' }: { provider: AgentSessionRow['provider']; compact?: boolean; size?: 'sm' | 'md' }) {
  const p = provider ? PROVIDER_STYLE[provider] : null;
  const label = p?.label ?? 'Agent unknown';
  return (
    <span
      className={cn(
        'inline-flex items-center shrink-0 font-semibold',
        size === 'md' ? cn('gap-1.5 rounded-md px-2.5 py-1 text-[13px] ring-1 ring-inset', p?.plate ?? 'ring-line text-ink-soft') : cn('gap-1 rounded-[5px] border px-1.5 py-0.5 text-[11px] leading-none', p?.chip ?? 'border-line-strong text-ink-soft'),
      )}
      title={`Coding agent: ${label}`}
      aria-label={compact ? label : undefined}
    >
      {p && <p.Icon size={size === 'md' ? 13 : 11} aria-hidden="true" className="shrink-0" />}
      {!compact && label}
    </span>
  );
}

/** a small plate in capitals, its shape: where a session or a port comes from (FOUNDRY, YOURS, TAILSCALE, PROCESS…) */
const PLATE_SHAPE = 'inline-flex items-center whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em]';
/** the plate in neutral ink: never a signal */
export const PLATE = cn(PLATE_SHAPE, 'border border-line-strong text-ink-soft');
/**
 * A quiet trait chip in small letters (a session's work, a kind of learning, a schedule that approves itself), as the
 * Goals page's; `tone` colours one that is a merge (the reviews' violet) or what goes wrong (red). One colour per chip:
 * a colour class added after another of the same property does not win by coming later.
 */
export const traitChip = (tone?: 'extra' | 'bad') => cn('inline-flex items-center whitespace-nowrap rounded-sm border px-1.5 py-px text-[11px] font-semibold leading-tight', tone === 'extra' ? 'border-extra/50 text-extra-ink' : tone === 'bad' ? 'border-bad/50 text-bad-ink' : 'border-line-strong/70 text-ink-soft');
/** the label of a figure or a fact: tiny capitals beside or over its mono figure */
export const FIGURE_LABEL = 'text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint';
/** a board's panel without its heading, for a list the page's own title already names */
export const BOARD_PANEL = 'overflow-hidden rounded-xl bg-panel shadow-[0_0_0_1px_var(--color-line),var(--surface-shadow)]';

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

/** where a session was opened, as a plate: by Foundry (violet) or in VS Code (blue), in their hues before themes; the command line and anything else neutral */
export function SourceBadge({ row }: { row: AgentSessionRow }) {
  const label = row.source === 'foundry' ? 'Foundry' : row.entrypoint === 'claude-vscode' ? 'VS Code' : row.entrypoint === 'cli' ? 'CLI' : (row.entrypoint ?? 'external');
  const tone = row.source === 'foundry' ? code(2).chip : row.entrypoint === 'claude-vscode' ? code(0).chip : null;
  return <span className={cn(tone ? cn(PLATE_SHAPE, tone) : PLATE, 'shrink-0')}>{label}</span>;
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
