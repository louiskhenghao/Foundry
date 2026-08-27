import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type GoalRow } from '../api.ts';
import { SetupBanner } from '../components/SetupBanner.tsx';
import { UsagePausedBanner } from '../components/UsageBanner.tsx';
import { useLive } from '../store.ts';
import { Badge, Button, Empty, ago, fmtLimitUsd, fmtUsd } from '../ui.tsx';

export function GoalsPage() {
  const [goals, setGoals] = useState<GoalRow[] | null>(null);
  const version = useLive((s) => s.globalVersion);
  useEffect(() => {
    const t = setTimeout(() => api.goals().then(setGoals).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [version]);

  const href = (g: GoalRow) => (g.state === 'awaiting_brief_approval' ? `/goals/${g.id}/brief` : `/goals/${g.id}`);
  const taskSummary = (g: GoalRow) =>
    Object.entries(g.taskCounts)
      .map(([k, v]) => `${v} ${k}`)
      .join(' · ') || '—';

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6">
      <SetupBanner />
      <div className="mb-3">
        <UsagePausedBanner />
      </div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Goals</h1>
        <Link to="/goals/new">
          <Button variant="primary">New goal</Button>
        </Link>
      </div>
      {!goals ? (
        <Empty>Loading…</Empty>
      ) : goals.length === 0 ? (
        <Empty>No goals yet. Create one to start.</Empty>
      ) : (
        <>
          {/* phones: cards */}
          <div className="sm:hidden space-y-2">
            {goals.map((g) => (
              <Link key={g.id} to={href(g)} className="block rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 hover:border-zinc-600">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm text-zinc-100 leading-snug">{g.title}</div>
                  <Badge state={g.state} />{g.mode === 'simple' && <span className="text-[10px] rounded-full border border-zinc-700 text-zinc-400 px-1.5">simple</span>}{g.nature !== 'auto' && g.nature !== 'code' && <span className="text-[10px] rounded-full border border-sky-800 text-sky-300 px-1.5">{g.nature}</span>}{g.workflow.pace === 'fast' && <span className="text-[10px] rounded-full border border-amber-800 text-amber-300 px-1.5">fast</span>}
                </div>
                <div className="text-[11px] text-zinc-500 mono truncate mt-1">{g.repoPath}</div>
                <div className="flex items-center gap-3 text-[11px] text-zinc-400 mt-2 flex-wrap">
                  <span>{taskSummary(g)}</span>
                  <span className="mono">
                    {fmtUsd(g.costUsd)} <span className="text-zinc-500">/ {fmtLimitUsd(g.budgets.maxCostUsd)}</span>
                  </span>
                  <span className="text-zinc-500">{ago(g.updatedAt)}</span>
                  {g.openEscalations > 0 && <span className="text-orange-400">⚠ {g.openEscalations}</span>}
                </div>
              </Link>
            ))}
          </div>
          {/* tablets and up: table */}
          <div className="hidden sm:block rounded-lg border border-zinc-800 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Goal</th>
                  <th className="text-left px-3 py-2 font-medium">State</th>
                  <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Tasks</th>
                  <th className="text-left px-3 py-2 font-medium">Cost</th>
                  <th className="text-left px-3 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {goals.map((g) => (
                  <tr key={g.id} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                    <td className="px-3 py-2">
                      <Link to={href(g)} className="text-zinc-100 hover:underline">
                        {g.title}
                      </Link>
                      <div className="text-xs text-zinc-500 mono truncate max-w-[40vw]">{g.repoPath}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Badge state={g.state} />{g.mode === 'simple' && <span className="text-[10px] rounded-full border border-zinc-700 text-zinc-400 px-1.5">simple</span>}{g.nature !== 'auto' && g.nature !== 'code' && <span className="text-[10px] rounded-full border border-sky-800 text-sky-300 px-1.5">{g.nature}</span>}{g.workflow.pace === 'fast' && <span className="text-[10px] rounded-full border border-amber-800 text-amber-300 px-1.5">fast</span>}
                        {g.openEscalations > 0 && <span className="text-orange-400 text-xs">⚠ {g.openEscalations}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-400 hidden md:table-cell">{taskSummary(g)}</td>
                    <td className="px-3 py-2 mono text-xs whitespace-nowrap">
                      {fmtUsd(g.costUsd)} <span className="text-zinc-500">/ {fmtLimitUsd(g.budgets.maxCostUsd)}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">{ago(g.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
