import type { Goal } from '@foundry/core/browser';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../../ui.tsx';

const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`);

/**
 * Where Clarify is, with how long the current step has run: the Clarifier reading the repository and writing its
 * answer, then the planner splitting the goal into tasks. A long answer is written in one go, so the log can stand still
 * for minutes; the timer says it is still working.
 */
export function ClarifyProgress({ goal, writingBrief }: { goal: Goal; writingBrief: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const stage = goal.clarifyStage;
  const since = stage ? Math.max(0, Math.round((now - Date.parse(stage.at)) / 1000)) : null;
  const steps = [
    { key: 'clarifying', label: writingBrief ? 'Clarifier: reading the repository, then writing the Brief' : 'Clarifier: reading the repository, then asking or writing the Brief' },
    ...(writingBrief ? [{ key: 'planning', label: 'Planner: splitting the goal into tasks' }] : []),
  ];
  // no step recorded yet (the session is being prepared): the first one
  const current = Math.max(0, steps.findIndex((s) => s.key === stage?.stage));
  return (
    <div className="space-y-1.5">
      <ol className="space-y-1">
        {steps.map((s, i) => {
          const done = current > i;
          const active = current === i;
          return (
            <li key={s.key} className={cn('flex items-center gap-2', active ? 'text-zinc-200' : done ? 'text-zinc-400' : 'text-zinc-600')}>
              {done ? <CheckCircle2 size={13} className="text-emerald-400" /> : active ? <Loader2 size={13} className="animate-spin text-sky-300" /> : <Circle size={13} />}
              <span>{s.label}</span>
              {active && since !== null && <span className="mono text-[11px] text-zinc-500">{fmt(since)}</span>}
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] text-zinc-500">An answer is written in one go, so the log below can stand still for minutes while it is.</p>
    </div>
  );
}
