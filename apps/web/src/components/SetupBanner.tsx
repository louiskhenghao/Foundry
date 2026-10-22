import type { DoctorReport } from '@foundry/engine/skills-types';
import { CircleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiForProvider, type AgentProvider } from '../api.ts';
import { buttonClass } from '../ui.tsx';

const FINISHED = ['done', 'over_delivered', 'failed', 'cancelled'];
const NAME: Record<AgentProvider, string> = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity' };

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
        // broken until it is fixed: a plate in the red tint, its sign square solid
        <div key={provider} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-bad/[0.06] px-3 py-2.5 ring-1 ring-inset ring-bad/40 sm:px-4 text-sm">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-bad text-on-bad" aria-hidden="true">
            <CircleAlert size={15} strokeWidth={2.5} />
          </span>
          <div className="min-w-0 flex-1 basis-64 leading-snug">
            <b className="text-ink">Setup incomplete{several ? ` for ${NAME[provider]}` : ''}:</b>{' '}
            <span className="text-ink-soft">{report.checks.filter((c) => !c.ok && c.severity === 'error').map((e) => e.label).join(' · ')}</span>
          </div>
          <Link to={`/setup?provider=${provider}`} className={buttonClass('primary', 'sm', 'whitespace-nowrap')}>
            Fix in Setup →
          </Link>
        </div>
      ))}
    </div>
  );
}
