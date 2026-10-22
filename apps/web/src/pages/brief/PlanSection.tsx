import type { Brief } from '@foundry/core/browser';
import { LARGE_BRIEF_TASKS, stagesOf } from '@foundry/core/browser';
import { Info, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, chipClass, cn, fmtUsd } from '../../ui.tsx';
import { BriefDag } from './BriefDag.tsx';
import { TaskCard } from './TaskCard.tsx';
import { areaStyle, newTask } from './shared.ts';
import { HelpLink } from '../HelpPage.tsx';
import { SectionTitle } from './SectionTitle.tsx';

/**
 * The plan: a graph of the tasks (each named with its Area) and the same tasks listed by Stage —
 * tasks of one stage run in parallel, a stage starts when the previous one is done.
 */
export function PlanSection({ costAvailable = true, brief, goalId, editable, edit }: { costAvailable?: boolean; brief: Brief; goalId: string; editable: boolean; edit: (fn: (b: Brief) => Brief) => void }) {
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
      title={<span className="flex items-start gap-1.5"><SectionTitle section="plan">{`Plan (${brief.tasks.length} task${brief.tasks.length === 1 ? '' : 's'} · ${stages.stages.length} stage${stages.stages.length === 1 ? '' : 's'})`}</SectionTitle><HelpLink to="approving-the-brief#plan" className="mt-0.5 shrink-0" /></span>}
      actions={
        editable && (
          <Button size="sm" onClick={addTask}>
            <Plus size={13} /> Add task
          </Button>
        )
      }
    >
      {large && (
        // advice, not a problem: its icon in the information blue, the box as any inside a card
        <div className="mb-3 flex items-start gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-xs text-ink-soft">
          <Info size={14} className="shrink-0 text-work-ink" aria-hidden="true" />
          <span className="min-w-0">
            This is a large goal: {brief.tasks.length} tasks, estimated {costAvailable && <>{fmtUsd(brief.costEstimateUsd)} / </>} {brief.timeEstimateMin} min. It will run, but consider splitting it into one goal per Area for smaller pull requests and easier review.
          </span>
        </div>
      )}
      {!stages.ok && <div className="text-xs font-semibold text-bad-ink mb-2">Graph error: {stages.error}</div>}
      {brief.tasks.length > 1 && (
        <div className="mb-4">
          <BriefDag brief={brief} selected={null} onSelect={setOpenKey} />
        </div>
      )}
      {brief.areas.length > 1 && (
        // a filter: the Area shown is the chip filled with the accent; each Area's dot in its colour, as on its tasks and
        // in the graph, ringed so it shows on the filled chip too
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button onClick={() => setAreaFilter(null)} className={chipClass(!areaFilter)}>
            all Areas
          </button>
          {brief.areas.map((a) => (
            <button key={a.key} onClick={() => setAreaFilter(areaFilter === a.key ? null : a.key)} className={cn(chipClass(areaFilter === a.key), 'inline-flex items-center gap-1.5')}>
              <span className="h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_1.5px_var(--color-panel)]" style={{ background: areaStyle(brief, a.key).dot }} aria-hidden="true" />
              <span>
                {a.name} · <span className="mono">{brief.tasks.filter((t) => t.areaKey === a.key).length}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {brief.tasks.length === 0 && <div className="text-sm text-ink-faint">No tasks. Add one, or draft tasks for an Area above.</div>}
      <div className="space-y-6">
        {stages.stages.map((stage, i) => {
          const xs = stage.filter((t) => visible(t.key));
          if (!xs.length) return null;
          return (
            <div key={i}>
              {stages.ok && (
                <div className="flex items-center gap-2.5 mb-2.5">
                  <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-[5px] bg-ink px-1 mono text-[11px] font-bold text-on-ink">{i + 1}</span>
                  <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint">
                    Stage {i + 1}
                    {stage.length > 1 ? ` · ${stage.length} in parallel` : ''}
                    {i > 0 ? ' · after the previous stage' : ''}
                  </span>
                </div>
              )}
              <div className={cn('space-y-2.5', stages.ok && 'ml-2.5 pl-4 border-l-2 border-line')}>
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
