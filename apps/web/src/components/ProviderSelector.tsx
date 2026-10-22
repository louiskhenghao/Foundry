import { useId } from 'react';
import { AGENT_PROVIDERS, PROVIDER_LABEL } from '@foundry/core/browser';
import type { AgentProvider } from '../api.ts';
import { cn } from '../ui.tsx';

type ProviderFilter = AgentProvider | 'all';
type SelectorProps = {
  hideLabel?: boolean;
  className?: string;
  controls?: Partial<Record<ProviderFilter, string>>;
  counts?: Partial<Record<ProviderFilter, number>>;
} & ({ allowAll: true; value: ProviderFilter; onChange: (provider: ProviderFilter) => void }
  | { allowAll?: false; value: AgentProvider; onChange: (provider: AgentProvider) => void });

/**
 * One native radio group for choosing the coding agent across forms and page filters, drawn as a segmented control like
 * ButtonGroup: the chosen agent filled with the accent; on a narrow screen the options wrap and grow to fill their row.
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
        {providers.map((provider) => (
          <label key={provider} className="relative grow cursor-pointer">
            <input className="peer sr-only" type="radio" name={`provider-${id}`} value={provider} checked={value === provider} onChange={() => select(provider)} aria-controls={controls?.[provider]} />
            <span className={cn('flex min-h-8 items-center justify-center gap-1.5 rounded-sm px-3 text-[13px] font-semibold whitespace-nowrap transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent', value === provider ? 'bg-accent text-on-accent' : 'text-ink-soft hover:bg-sunken hover:text-ink')}>
              {provider === 'all' ? 'All agents' : PROVIDER_LABEL[provider]}
              {counts?.[provider] != null && <span className="mono tabular-nums opacity-70">{counts[provider]}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
