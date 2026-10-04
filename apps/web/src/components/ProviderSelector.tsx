import { Check } from 'lucide-react';
import { useId } from 'react';
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

/** One native radio group for choosing the backend across forms and page filters. */
export function ProviderSelector(props: SelectorProps) {
  const { value, hideLabel = false, className, controls, counts } = props;
  const providers: ProviderFilter[] = props.allowAll ? ['all', 'claude', 'codex'] : ['claude', 'codex'];
  const select = (provider: ProviderFilter) => {
    if (props.allowAll) props.onChange(provider);
    else if (provider !== 'all') props.onChange(provider);
  };
  const id = useId();
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className={hideLabel ? 'sr-only' : 'mb-1.5 text-xs font-medium text-zinc-400'}>Agent backend</legend>
      <div className={cn('inline-grid max-w-full gap-1 rounded-lg border border-zinc-800 bg-zinc-950/50 p-1', props.allowAll ? 'grid-cols-3' : 'grid-cols-2')}>
        {providers.map((provider) => (
          <label key={provider} className="relative cursor-pointer">
            <input className="peer sr-only" type="radio" name={`provider-${id}`} value={provider} checked={value === provider} onChange={() => select(provider)} aria-controls={controls?.[provider]} />
            <span className="flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 sm:px-3 text-xs text-zinc-400 transition-colors hover:text-zinc-100 peer-checked:border-emerald-500/40 peer-checked:bg-emerald-500/10 peer-checked:font-semibold peer-checked:text-emerald-200 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-emerald-500">
              <Check size={14} aria-hidden="true" className={cn('shrink-0', value !== provider && 'invisible')} />
              <span className="whitespace-nowrap">{provider === 'all' ? 'All engines' : provider === 'claude' ? 'Claude Code' : 'Codex'}</span>
              {counts?.[provider] != null && <span className="tabular-nums opacity-60">{counts[provider]}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
