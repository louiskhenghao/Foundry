import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AgentProvider } from '../api.ts';
import { useLive } from '../store.ts';

/**
 * Each backend pauses independently. A retry time is not a promise that the account limit resets.
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
  const active = (['claude', 'codex'] as const).filter((provider) => pauses[provider] && Date.parse(pauses[provider]!) > Date.now());
  if (!active.length) return null;
  return (
    <div className="space-y-2" role="status">
      {active.map((provider) => (
        <div key={provider} className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm px-3 py-2 flex items-center gap-2 flex-wrap">
          <span>⏸ {provider === 'codex' ? 'Codex' : 'Claude Code'} usage limit — new sessions paused. Automatic retry at {new Date(pauses[provider]!).toLocaleTimeString()}.</span>
          <Link to={`/usage?provider=${provider}`} className="underline text-amber-300 ml-auto">{provider === 'codex' ? 'Codex' : 'Claude Code'} usage</Link>
        </div>
      ))}
    </div>
  );
}
