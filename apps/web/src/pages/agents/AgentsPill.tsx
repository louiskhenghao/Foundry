import type { AgentsSummary } from '@foundry/engine/agents-types';
import { useEffect, useState } from 'react';
import { api } from '../../api.ts';
import { useLive } from '../../store.ts';

/** how many agent sessions work right now (and idle), refreshed every 15 s and on every live change; null until known */
export function useAgentsSummary(): AgentsSummary | null {
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
  return s;
}
