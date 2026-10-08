import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AgentProvider } from '../api.ts';
import { useLive } from '../store.ts';

/**
 * Each backend pauses independently. A retry time is not a promise that the account limit resets. Resume now starts
 * sessions again at once; if the limit still holds, the next session pauses them again.
 */
export function UsagePausedBanner() {
  const version = useLive((s) => s.globalVersion);
  const [pauses, setPauses] = useState<Partial<Record<AgentProvider, string | null>>>({});
  useEffect(() => {
    let alive = true;
    const load = () => api.health().then((h) => alive && setPauses(h.pausedUntilByProvider)).catch(() => {});
    load();
    const i = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, [version]);
  const [resuming, setResuming] = useState<AgentProvider | null>(null);
  const active = (['claude', 'codex'] as const).filter((provider) => pauses[provider] && Date.parse(pauses[provider]!) > Date.now());
  const resume = (provider: AgentProvider) => {
    setResuming(provider);
    api
      .resumeUsage(provider)
      .then(() => setPauses((p) => ({ ...p, [provider]: null })))
      .catch(() => {})
      .finally(() => setResuming(null));
  };
  if (!active.length) return null;
  return (
    <div className="space-y-2" role="status">
      {active.map((provider) => (
        <div key={provider} className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm px-3 py-2 flex items-center gap-2 flex-wrap">
          <span>⏸ {provider === 'codex' ? 'Codex' : 'Claude Code'} usage limit — new sessions paused. Automatic retry {retryAt(pauses[provider]!)}.</span>
          <span className="ml-auto flex items-center gap-3">
            <button type="button" className="underline text-amber-100 disabled:opacity-50" disabled={resuming === provider} onClick={() => resume(provider)} title="Start sessions again now; if the limit still holds, the next session pauses them again">
              {resuming === provider ? 'Resuming…' : 'Resume now'}
            </button>
            <Link to={`/usage?provider=${provider}`} className="underline text-amber-300">{provider === 'codex' ? 'Codex' : 'Claude Code'} usage</Link>
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
