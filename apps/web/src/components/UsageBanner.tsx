import { AGENT_PROVIDERS, PROVIDER_LABEL } from '@foundry/core/browser';
import { Pause } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AgentProvider } from '../api.ts';
import { useLive } from '../store.ts';
import { Button } from '../ui.tsx';

/**
 * Each backend pauses independently. A retry time is not a promise that the account limit resets. Resume now starts
 * sessions again at once; if the limit still holds, the next session pauses them again. With another account of the
 * coding agent not limited, Switch and continue moves new sessions there and lifts the pause (ADR-0065).
 */
export function UsagePausedBanner() {
  const version = useLive((s) => s.globalVersion);
  const [pauses, setPauses] = useState<Partial<Record<AgentProvider, string | null>>>({});
  const [switchTo, setSwitchTo] = useState<Partial<Record<AgentProvider, string | null>>>({});
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .health()
        .then((h) => {
          if (!alive) return;
          setPauses(h.pausedUntilByProvider);
          setSwitchTo(h.switchToByProvider ?? {});
        })
        .catch(() => {});
    load();
    const i = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, [version]);
  const [resuming, setResuming] = useState<AgentProvider | null>(null);
  const active = AGENT_PROVIDERS.filter((provider) => pauses[provider] && Date.parse(pauses[provider]!) > Date.now());
  const resume = (provider: AgentProvider) => {
    setResuming(provider);
    api
      .resumeUsage(provider)
      .then(() => setPauses((p) => ({ ...p, [provider]: null })))
      .catch(() => {})
      .finally(() => setResuming(null));
  };
  const switchAccount = (provider: AgentProvider) => {
    setResuming(provider);
    api
      .switchUsageAccount(provider)
      .then((r) => r.to && setPauses((p) => ({ ...p, [provider]: null })))
      .catch(() => {})
      .finally(() => setResuming(null));
  };
  if (!active.length) return null;
  return (
    <div className="space-y-2" role="status">
      {active.map((provider) => (
        // new sessions wait for the limit, or for you: on a plain panel, its sign square solid yellow with a thin yellow edge
        <div key={provider} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-panel py-2.5 pl-4 pr-3 sm:pr-4 inset-ring inset-ring-line shadow-[inset_4px_0_0_var(--color-you)]">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-you text-on-you" aria-hidden="true">
            <Pause size={14} strokeWidth={2.75} />
          </span>
          <span className="min-w-0 flex-1 basis-64 text-sm leading-snug text-ink">
            <b>{PROVIDER_LABEL[provider]} usage limit</b> — new sessions paused. Automatic retry {retryAt(pauses[provider]!)}.
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {switchTo[provider] && (
              <Button type="button" size="sm" variant="primary" disabled={resuming === provider} onClick={() => switchAccount(provider)} title="New sessions run on this account from now; the stopped session resumes there">
                Switch to {switchTo[provider]} and continue
              </Button>
            )}
            <Button type="button" size="sm" disabled={resuming === provider} onClick={() => resume(provider)} title="Start sessions again now; if the limit still holds, the next session pauses them again">
              {resuming === provider ? 'Resuming…' : 'Resume now'}
            </Button>
            <Link to={`/usage?provider=${provider}`} className="inline-flex items-center px-1 text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-ink max-sm:min-h-8">{PROVIDER_LABEL[provider]} usage</Link>
          </span>
        </div>
      ))}
    </div>
  );
}

/** "at 3:00 PM" today, "on Tue 14 Oct, 3:00 PM" on another day */
function retryAt(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `at ${time}` : `on ${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}
