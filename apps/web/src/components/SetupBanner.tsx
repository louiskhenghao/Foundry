import type { DoctorReport } from '@foundry/engine/skills-types';
import { CircleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiForProvider, type AgentProvider } from '../api.ts';

const FINISHED = ['done', 'over_delivered', 'failed', 'cancelled'];
const NAME: Record<AgentProvider, string> = { claude: 'Claude Code', codex: 'Codex' };

/**
 * Persistent banner shown while any required check fails, for the default coding agent and for any other agent an
 * unfinished goal runs on (so a Codex goal on a Claude Code install is not left to fail unseen). Polls every 60s.
 */
export function SetupBanner() {
  const [failing, setFailing] = useState<{ provider: AgentProvider; report: DoctorReport }[]>([]);
  const [several, setSeveral] = useState(false);
  useEffect(() => {
    const load = async () => {
      const [settings, goals] = await Promise.all([api.settings(), api.goals()]);
      const fallback = settings.values.engine.provider as AgentProvider;
      const used = [...new Set<AgentProvider>([fallback, ...goals.filter((g) => !FINISHED.includes(g.state)).map((g) => (g.provider ?? fallback) as AgentProvider)])];
      const reports = await Promise.all(used.map(async (provider) => ({ provider, report: await apiForProvider(provider).doctor() })));
      setSeveral(used.length > 1);
      setFailing(reports.filter((r) => !r.report.ok));
    };
    const run = () => void load().catch(() => {});
    run();
    const t = setInterval(run, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!failing.length) return null;
  return (
    <div className="space-y-2 mb-4">
      {failing.map(({ provider, report }) => (
        <div key={provider} className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-4 py-2.5 flex items-center gap-3 text-sm">
          <CircleAlert size={16} className="text-rose-400 shrink-0" />
          <div className="flex-1">
            <span className="text-zinc-100">Setup incomplete{several ? ` for ${NAME[provider]}` : ''}:</span>{' '}
            <span className="text-zinc-300">{report.checks.filter((c) => !c.ok && c.severity === 'error').map((e) => e.label).join(' · ')}</span>
          </div>
          <Link to={`/setup?provider=${provider}`} className="underline text-rose-300 whitespace-nowrap">
            Fix in Setup →
          </Link>
        </div>
      ))}
    </div>
  );
}
