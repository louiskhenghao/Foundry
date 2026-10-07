import { CheckCircle2, ChevronRight, Eye, FastForward, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { type GoalDetail, api } from '../../api.ts';
import { Card, Modal, ago, cn } from '../../ui.tsx';

export type Evidence = { taskId: string; video: string | null; shots: { file: string; caption: string }[]; summary: string; error: string | null };

/** a walkthrough Foundry recorded in the preview: the video, the screenshots (a click shows one large) and why when it could not */
export function EvidenceView({ goalId, evidence }: { goalId: string; evidence: Evidence }) {
  const [big, setBig] = useState<{ file: string; caption: string } | null>(null);
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-zinc-500">What Foundry saw{evidence.summary ? `: ${evidence.summary}` : ''}</div>
      {evidence.video && <video src={api.screenshotUrl(goalId, evidence.video)} controls muted className="w-full max-w-2xl rounded border border-zinc-700 bg-black" />}
      {evidence.shots.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {evidence.shots.map((s) => (
            <button key={s.file} type="button" onClick={() => setBig(s)} title={s.caption} className="w-40 text-left">
              <img src={api.screenshotUrl(goalId, s.file)} alt={s.caption} className="h-24 w-40 object-cover object-top rounded border border-zinc-700 hover:border-zinc-500" />
              <span className="block text-[10px] text-zinc-500 truncate">{s.caption}</span>
            </button>
          ))}
        </div>
      )}
      {evidence.error && <div className="text-[11px] text-amber-300/90">{evidence.error}</div>}
      {big && (
        <Modal open wide title={big.caption || 'Screenshot'} onClose={() => setBig(null)}>
          <img src={api.screenshotUrl(goalId, big.file)} alt={big.caption} className="w-full rounded border border-zinc-800" />
        </Modal>
      )}
    </div>
  );
}

/** what happened at one milestone visit, from the goal's events */
interface Visit {
  at: string;
  paused: boolean;
  recheck: boolean;
  outcome: { action: 'continue' | 'feedback'; feedback: string | null } | null;
}

/**
 * Every milestone of the goal, newest first: when it landed, whether the goal paused for it (Have a look) and what the
 * person answered, and the walkthrough Foundry recorded, so it can be watched again after the goal went on.
 */
export function MilestonesCard({ d }: { d: GoalDetail }) {
  const g = d.goal;
  const [open, setOpen] = useState<string | null>(null);
  const visits = new Map<string, Visit[]>();
  const evidence = new Map<string, Evidence>();
  for (const e of d.milestoneEvents) {
    const p = e.payload as { taskId?: string; recheck?: boolean; action?: 'continue' | 'feedback'; feedback?: string | null };
    if (!p.taskId) continue;
    const list = visits.get(p.taskId) ?? [];
    if (e.type === 'goal.checkpoint_opened') list.push({ at: e.ts, paused: true, recheck: !!p.recheck, outcome: null });
    else if (e.type === 'goal.milestone_passed') list.push({ at: e.ts, paused: false, recheck: false, outcome: null });
    else if (e.type === 'goal.checkpoint_closed' && list.length) list.at(-1)!.outcome = { action: p.action!, feedback: p.feedback ?? null };
    else if (e.type === 'milestone.evidence') evidence.set(p.taskId, e.payload as Evidence);
    else continue;
    visits.set(p.taskId, list);
  }
  const milestones = d.tasks
    .filter((t) => t.milestone)
    .map((t) => ({ task: t, visits: visits.get(t.id) ?? [], evidence: evidence.get(t.id) ?? null }))
    .sort((a, b) => (b.visits.at(-1)?.at ?? '').localeCompare(a.visits.at(-1)?.at ?? ''));
  if (!milestones.length) return null;
  return (
    <Card title={`Milestones (${milestones.filter((m) => m.visits.length).length}/${milestones.length} reached)`}>
      <ul className="text-xs divide-y divide-zinc-800/70">
        {milestones.map(({ task, visits: vs, evidence: ev }) => {
          const last = vs.at(-1);
          const expanded = open === task.id;
          return (
            <li key={task.id} className="py-2 first:pt-0 last:pb-0">
              <button type="button" disabled={!ev} onClick={() => setOpen(expanded ? null : task.id)} className="w-full flex items-start gap-2 text-left enabled:hover:text-zinc-50" aria-expanded={ev ? expanded : undefined}>
                <span className="mt-0.5 shrink-0">{!last ? <Eye size={13} className="text-zinc-600" /> : last.paused ? <Eye size={13} className="text-amber-300" /> : <FastForward size={13} className="text-sky-300" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-zinc-200 font-medium">{task.title}</span>
                  <span className="block text-zinc-500 truncate">{task.milestone}</span>
                  <span className="block text-[11px] text-zinc-500">
                    {!last ? 'not reached yet' : `${ago(last.at)} · ${last.paused ? (last.recheck ? 'second look' : 'paused for a look') : 'went on (Have a look off)'}`}
                    {last?.outcome?.action === 'continue' && <span className="inline-flex items-center gap-0.5 text-emerald-300/90"> · <CheckCircle2 size={10} /> continued</span>}
                    {last?.outcome?.action === 'feedback' && <span className="inline-flex items-center gap-0.5 text-sky-300/90"> · <MessageSquare size={10} /> feedback: {last.outcome.feedback?.slice(0, 80)}</span>}
                  </span>
                </span>
                {ev && <ChevronRight size={13} className={cn('mt-0.5 shrink-0 text-zinc-500 transition-transform', expanded && 'rotate-90')} />}
              </button>
              {expanded && ev && (
                <div className="mt-2 ml-5">
                  <EvidenceView goalId={g.id} evidence={ev} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
