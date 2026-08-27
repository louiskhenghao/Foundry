import type { Brief } from '@ai-engine/core/browser';
import { LARGE_BRIEF_TASKS, stagesOf } from '@ai-engine/core/browser';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, cn, fmtUsd } from '../../ui.tsx';
import { BriefDag } from './BriefDag.tsx';
import { TaskCard } from './TaskCard.tsx';
import { areaStyle, newTask } from './shared.ts';

/**
 * The plan: a graph of the tasks (coloured by Area) and the same tasks listed by Stage —
 * tasks of one stage run in parallel, a stage starts when the previous one is done.
 */
export function PlanSection({ brief, goalId, editable, edit }: { brief: Brief; goalId: string; editable: boolean; edit: (fn: (b: Brief) => Brief) => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const stages = useMemo(() => {
    try {
      return { ok: true as const, stages: stagesOf(brief.tasks) };
    } catch (e: any) {
      return { ok: false as const, error: e.message as string, stages: [brief.tasks] };
    }
  }, [brief.tasks]);
  const addTask = () => {
    const t = newTask(brief, areaFilter);
    edit((b) => ({ ...b, tasks: [...b.tasks, t] }));
    setOpenKey(t.key);
  };
  const large = brief.tasks.length > LARGE_BRIEF_TASKS;
  const visible = (key: string) => !areaFilter || brief.tasks.find((t) => t.key === key)?.areaKey === areaFilter;

  return (
    <Card
      title={`Plan (${brief.tasks.length} task${brief.tasks.length === 1 ? '' : 's'} · ${stages.stages.length} stage${stages.stages.length === 1 ? '' : 's'})`}
      actions={
        editable && (
          <Button size="sm" onClick={addTask}>
            <Plus size={13} /> Add task
          </Button>
        )
      }
    >
      {large && (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
          This is a large goal: {brief.tasks.length} tasks, estimated {fmtUsd(brief.costEstimateUsd)} / {brief.timeEstimateMin} min. It will run, but consider splitting it into one goal per Area for smaller pull requests and easier review.
        </div>
      )}
      {!stages.ok && <div className="text-xs text-rose-300 mb-2">Graph error: {stages.error}</div>}
      {brief.tasks.length > 1 && (
        <div className="mb-4">
          <BriefDag brief={brief} selected={null} onSelect={setOpenKey} />
        </div>
      )}
      {brief.areas.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-3 text-[11px]">
          <button onClick={() => setAreaFilter(null)} className={cn('rounded-full border px-2 py-0.5', !areaFilter ? 'border-zinc-400 text-zinc-100' : 'border-zinc-700 text-zinc-500')}>
            all Areas
          </button>
          {brief.areas.map((a) => (
            <button key={a.key} onClick={() => setAreaFilter(areaFilter === a.key ? null : a.key)} className={cn('rounded-full border px-2 py-0.5', areaStyle(brief, a.key).chip, areaFilter && areaFilter !== a.key && 'opacity-40')}>
              {a.name} · {brief.tasks.filter((t) => t.areaKey === a.key).length}
            </button>
          ))}
        </div>
      )}
      {brief.tasks.length === 0 && <div className="text-sm text-zinc-500">No tasks. Add one, or draft tasks for an Area above.</div>}
      <div className="space-y-6">
        {stages.stages.map((stage, i) => {
          const xs = stage.filter((t) => visible(t.key));
          if (!xs.length) return null;
          return (
            <div key={i}>
              {stages.ok && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-zinc-800 text-[10px] text-zinc-300 mono shrink-0">{i + 1}</span>
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                    Stage {i + 1}
                    {stage.length > 1 ? ` · ${stage.length} in parallel` : ''}
                    {i > 0 ? ' · after the previous stage' : ''}
                  </span>
                </div>
              )}
              <div className={cn('space-y-2.5', stages.ok && 'ml-2.5 pl-4 border-l-2 border-zinc-800')}>
                {xs.map((t) => (
                  <TaskCard key={t.key} task={t} brief={brief} goalId={goalId} editable={editable} open={openKey === t.key} onOpen={() => setOpenKey(t.key)} onClose={() => setOpenKey(null)} onOpenTask={setOpenKey} edit={edit} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
