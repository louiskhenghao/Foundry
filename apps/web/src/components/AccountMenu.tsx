import { PROVIDER_NAME } from '@foundry/core/browser';
import { UserCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AgentProvider } from '../api.ts';
import { useLive } from '../store.ts';

/** Both provider accounts are available independent of the default backend; the title names the account each runs on. */
export function AccountMenu() {
  const version = useLive((s) => s.globalVersion);
  const [current, setCurrent] = useState<Partial<Record<AgentProvider, string | null>>>({});
  useEffect(() => {
    let alive = true;
    api.health().then((h) => alive && setCurrent(h.currentAccountByProvider ?? {})).catch(() => {});
    return () => {
      alive = false;
    };
  }, [version]);
  const on = (Object.entries(current) as [AgentProvider, string | null][]).filter(([, who]) => who).map(([p, who]) => `${PROVIDER_NAME[p]}: ${who}`);
  return <Link to="/accounts" aria-label="Agent accounts" title={on.length ? `Coding agent accounts — new sessions run on ${on.join(', ')}` : 'Coding agent accounts'} className="flex h-8 sm:h-7 items-center gap-1.5 rounded-md border border-zinc-700 px-2 text-xs text-zinc-300 hover:bg-zinc-900"><UserCircle2 size={14} /><span className="hidden sm:inline">Accounts</span></Link>;
}
