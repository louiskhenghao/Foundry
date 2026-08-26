import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { useLive } from '../store.ts';

/**
 * Prominent strip shown while the engine is paused on a usage limit. Goals stay where they are and
 * resume automatically when the limit resets (also after an engine restart); this only makes it visible.
 */
export function UsagePausedBanner() {
  const version = useLive((s) => s.globalVersion);
  const [until, setUntil] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.health().then((h) => alive && setUntil(h.pausedUntil)).catch(() => {});
    load();
    const i = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, [version]);
  if (!until) return null;
  const mins = Math.max(1, Math.round((new Date(until).getTime() - Date.now()) / 60_000));
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm px-3 py-2 flex items-center gap-2 flex-wrap">
      <span>⏸ Usage limit reached — paused until {new Date(until).toLocaleTimeString()} (~{mins} min). Goals resume automatically when it resets.</span>
      <Link to="/usage" className="underline text-amber-300 ml-auto">
        Usage
      </Link>
    </div>
  );
}
