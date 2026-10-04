import { Check } from 'lucide-react';
import { useId } from 'react';
import type { AgentProvider } from '../api.ts';
import { cn } from '../ui.tsx';

/** One native radio group for choosing the backend across forms and page filters. */
export function ProviderSelector({ value, onChange, hideLabel = false, className, controls }: {
  value: AgentProvider;
  onChange: (provider: AgentProvider) => void;
  hideLabel?: boolean;
  className?: string;
  controls?: Partial<Record<AgentProvider, string>>;
}) {
  const id = useId();
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className={hideLabel ? 'sr-only' : 'mb-1.5 text-xs font-medium text-zinc-400'}>Agent backend</legend>
      <div className="inline-grid max-w-full grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/50 p-1">
        {(['claude', 'codex'] as const).map((provider) => (
          <label key={provider} className="relative cursor-pointer">
            <input className="peer sr-only" type="radio" name={`provider-${id}`} value={provider} checked={value === provider} onChange={() => onChange(provider)} aria-controls={controls?.[provider]} />
            <span className="flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 text-xs text-zinc-400 transition-colors hover:text-zinc-100 peer-checked:border-emerald-500/40 peer-checked:bg-emerald-500/10 peer-checked:font-semibold peer-checked:text-emerald-200 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-emerald-500">
              <Check size={14} aria-hidden="true" className={cn('shrink-0', value !== provider && 'invisible')} />
              <span className="whitespace-nowrap">{provider === 'claude' ? 'Claude Code' : 'Codex'}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
