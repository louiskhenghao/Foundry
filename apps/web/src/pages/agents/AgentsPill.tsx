import type { AgentsSummary } from '@foundry/engine/agents-types';
import { Bot } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.ts';
import { useLive } from '../../store.ts';

/** Header pill: how many Claude sessions are actively working right now. Hidden while nothing is busy. */
export function AgentsPill() {
  const version = useLive((s) => s.globalVersion);
  const [s, setS] = useState<AgentsSummary | null>(null);
  useEffect(() => {
    const load = () => api.agentsSummary().then(setS).catch(() => {});
    const t = setTimeout(load, 300);
    const i = setInterval(load, 15_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [version]);
  if (!s || s.busy === 0) return null;
  return (
    <Link to="/agents" className="flex items-center gap-1.5 rounded-md border border-emerald-500/40 text-emerald-300 px-2 py-1 text-[11px] mono" title={`${s.busy} Claude session${s.busy === 1 ? '' : 's'} working · ${s.idle} idle`}>
      <Bot size={12} />
      <span className="whitespace-nowrap">{s.busy} busy</span>
    </Link>
  );
}
