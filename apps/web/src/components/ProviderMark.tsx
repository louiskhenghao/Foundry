import { Orbit, Sparkle, SquareTerminal } from 'lucide-react';
import type { AgentProvider } from '../api.ts';
import { cn } from '../ui.tsx';

/**
 * Each coding agent's own icon and colour, so Claude Code, Codex and Antigravity tell apart at a glance wherever they
 * appear, in every theme: `chip` a small bordered tag, `plate` a tag the size of a page head's facts (a ring, no border),
 * `tile` the square behind its icon.
 */
export const PROVIDER_STYLE = {
  claude: { label: 'Claude Code', Icon: Sparkle, chip: 'border-agent-claude/40 bg-agent-claude/10 text-agent-claude', plate: 'ring-agent-claude/40 bg-agent-claude/10 text-agent-claude', tile: 'border-agent-claude/30 bg-agent-claude/10 text-agent-claude' },
  codex: { label: 'Codex', Icon: SquareTerminal, chip: 'border-agent-codex/40 bg-agent-codex/10 text-agent-codex', plate: 'ring-agent-codex/40 bg-agent-codex/10 text-agent-codex', tile: 'border-agent-codex/30 bg-agent-codex/10 text-agent-codex' },
  agy: { label: 'Antigravity', Icon: Orbit, chip: 'border-agent-agy/40 bg-agent-agy/10 text-agent-agy', plate: 'ring-agent-agy/40 bg-agent-agy/10 text-agent-agy', tile: 'border-agent-agy/30 bg-agent-agy/10 text-agent-agy' },
} as const satisfies Record<AgentProvider, { label: string; Icon: typeof Sparkle; chip: string; plate: string; tile: string }>;

/** The coding agent's icon on a tile of its colour: the mark a section about one coding agent leads with. */
export function ProviderMark({ provider, size = 'md', className }: { provider: AgentProvider; size?: 'md' | 'lg'; className?: string }) {
  const { Icon, tile } = PROVIDER_STYLE[provider];
  return (
    <span aria-hidden="true" className={cn('grid shrink-0 place-items-center rounded-lg border', tile, size === 'lg' ? 'h-11 w-11' : 'h-8 w-8', className)}>
      <Icon size={size === 'lg' ? 22 : 16} strokeWidth={1.75} />
    </span>
  );
}
