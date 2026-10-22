import { Orbit, Sparkle, SquareTerminal } from 'lucide-react';
import type { AgentProvider } from '../api.ts';
import { cn } from '../ui.tsx';

/** Each coding agent's own icon and colour, so Claude Code, Codex and Antigravity tell apart at a glance wherever they appear. */
export const PROVIDER_STYLE = {
  claude: { label: 'Claude Code', Icon: Sparkle, chip: 'border-orange-500/40 bg-orange-500/10 text-orange-300', tile: 'border-orange-500/30 bg-orange-500/10 text-orange-300' },
  codex: { label: 'Codex', Icon: SquareTerminal, chip: 'border-blue-500/40 bg-blue-500/10 text-blue-300', tile: 'border-blue-500/30 bg-blue-500/10 text-blue-300' },
  agy: { label: 'Antigravity', Icon: Orbit, chip: 'border-teal-500/40 bg-teal-500/10 text-teal-300', tile: 'border-teal-500/30 bg-teal-500/10 text-teal-300' },
} as const satisfies Record<AgentProvider, { label: string; Icon: typeof Sparkle; chip: string; tile: string }>;

/** The coding agent's icon on a tile of its colour: the mark a section about one coding agent leads with. */
export function ProviderMark({ provider, size = 'md', className }: { provider: AgentProvider; size?: 'md' | 'lg'; className?: string }) {
  const { Icon, tile } = PROVIDER_STYLE[provider];
  return (
    <span aria-hidden="true" className={cn('grid shrink-0 place-items-center rounded-lg border', tile, size === 'lg' ? 'h-11 w-11' : 'h-8 w-8', className)}>
      <Icon size={size === 'lg' ? 22 : 16} strokeWidth={1.75} />
    </span>
  );
}
