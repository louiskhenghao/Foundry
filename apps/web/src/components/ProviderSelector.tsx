import { useId } from 'react';
import { AGENT_PROVIDERS, PROVIDER_LABEL } from '@foundry/core/browser';
import type { AgentProvider } from '../api.ts';
import { cn } from '../ui.tsx';
import { PROVIDER_STYLE } from './ProviderMark.tsx';

type ProviderFilter = AgentProvider | 'all';
type SelectorProps = {
  hideLabel?: boolean;
  className?: string;
  controls?: Partial<Record<ProviderFilter, string>>;
  counts?: Partial<Record<ProviderFilter, number>>;
} & ({ allowAll: true; value: ProviderFilter; onChange: (provider: ProviderFilter) => void }
  | { allowAll?: false; value: AgentProvider; onChange: (provider: AgentProvider) => void });

/** each coding agent in its own colour, as wherever it appears: its icon, and the chosen one on a plate of that colour */
const AGENT_LOOK: Record<AgentProvider, { ink: string; chosen: string }> = {
  claude: { ink: 'text-agent-claude', chosen: 'bg-agent-claude/15 text-agent-claude ring-[1.5px] ring-inset ring-agent-claude/70' },
  codex: { ink: 'text-agent-codex', chosen: 'bg-agent-codex/15 text-agent-codex ring-[1.5px] ring-inset ring-agent-codex/70' },
  agy: { ink: 'text-agent-agy', chosen: 'bg-agent-agy/15 text-agent-agy ring-[1.5px] ring-inset ring-agent-agy/70' },
};

/**
 * One native radio group for choosing the coding agent across forms and page filters, drawn as a segmented control like
 * ButtonGroup: each agent with its icon in its own colour and the chosen one on a plate of that colour (All agents, no
 * agent of its own, filled with the accent); on a narrow screen the options wrap and grow to fill their row.
 */
export function ProviderSelector(props: SelectorProps) {
  const { value, hideLabel = false, className, controls, counts } = props;
  const providers: ProviderFilter[] = props.allowAll ? ['all', ...AGENT_PROVIDERS] : [...AGENT_PROVIDERS];
  const select = (provider: ProviderFilter) => {
    if (props.allowAll) props.onChange(provider);
    else if (provider !== 'all') props.onChange(provider);
  };
  const id = useId();
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className={hideLabel ? 'sr-only' : 'mb-1.5 text-xs font-semibold text-ink-soft'}>Coding agent</legend>
      <div className="inline-flex max-w-full flex-wrap gap-0.5 rounded-md bg-panel p-0.5 ring-1 ring-inset ring-line-strong">
        {providers.map((provider) => {
          const chosen = value === provider;
          const look = provider === 'all' ? null : AGENT_LOOK[provider];
          const Icon = provider === 'all' ? null : PROVIDER_STYLE[provider].Icon;
          return (
            <label key={provider} className="relative grow cursor-pointer">
              <input className="peer sr-only" type="radio" name={`provider-${id}`} value={provider} checked={chosen} onChange={() => select(provider)} aria-controls={controls?.[provider]} />
              <span className={cn('flex min-h-8 items-center justify-center gap-1.5 rounded-sm px-3 text-[13px] font-semibold whitespace-nowrap transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent', chosen ? (look?.chosen ?? 'bg-accent text-on-accent') : 'text-ink-soft hover:bg-sunken hover:text-ink')}>
                {Icon && <Icon size={14} strokeWidth={2.25} aria-hidden="true" className={cn('shrink-0', !chosen && look?.ink)} />}
                {provider === 'all' ? 'All agents' : PROVIDER_LABEL[provider]}
                {counts?.[provider] != null && <span className="mono tabular-nums opacity-70">{counts[provider]}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
