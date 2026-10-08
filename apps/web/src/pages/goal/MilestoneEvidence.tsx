import { CheckCircle2, ChevronLeft, ChevronRight, Eye, FastForward, MessageSquare, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type GoalDetail, api } from '../../api.ts';
import { Card, Modal, ago, cn } from '../../ui.tsx';

export type Evidence = { taskId: string; video: string | null; shots: { file: string; caption: string }[]; summary: string; error: string | null };

type Media = { kind: 'video' | 'image'; file: string; caption: string };

/** the walkthrough's video and screenshots as one row of items: the video first, then the shots in the order taken */
const mediaOf = (e: Evidence): Media[] => [...(e.video ? [{ kind: 'video' as const, file: e.video, caption: 'Walkthrough video' }] : []), ...e.shots.map((s) => ({ kind: 'image' as const, ...s }))];

/** one item large in a window, the others a click or an arrow key away */
function MediaViewer({ goalId, items, index, onIndex, onClose }: { goalId: string; items: Media[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const m = items[index]!;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, items.length]);
  const step = (d: -1 | 1, label: string, Icon: typeof ChevronLeft) => (
    <button type="button" className="rounded p-1 hover:bg-zinc-800 disabled:opacity-30" disabled={!items[index + d]} onClick={() => onIndex(index + d)} aria-label={label} title={`${label} (${d < 0 ? '←' : '→'})`}>
      <Icon size={14} />
    </button>
  );
  return (
    <Modal open wide onClose={onClose} title={m.caption || (m.kind === 'video' ? 'Walkthrough video' : 'Screenshot')}>
      <div className="space-y-2">
        <div className="flex items-center justify-end gap-1 text-xs text-zinc-500">
          {step(-1, 'previous', ChevronLeft)}
          {index + 1} / {items.length}
          {step(1, 'next', ChevronRight)}
        </div>
        {/* keyed by file: switching items starts the next video from its beginning */}
        {m.kind === 'video' ? <video key={m.file} src={api.screenshotUrl(goalId, m.file)} controls autoPlay muted className="w-full max-h-[70vh] rounded border border-zinc-800 bg-black" /> : <img key={m.file} src={api.screenshotUrl(goalId, m.file)} alt={m.caption} className="w-full max-h-[70vh] object-contain rounded border border-zinc-800 bg-zinc-950" />}
      </div>
    </Modal>
  );
}

/** a walkthrough Foundry recorded in the preview: the video and the screenshots as same-size tiles (a click opens them in a viewer) and why when it could not */
export function EvidenceView({ goalId, evidence }: { goalId: string; evidence: Evidence }) {
  const [shown, setShown] = useState<number | null>(null);
  const items = mediaOf(evidence);
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-zinc-500">What Foundry saw{evidence.summary ? `: ${evidence.summary}` : ''}</div>
      {items.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
          {items.map((m, i) => (
            <button key={m.file} type="button" onClick={() => setShown(i)} title={m.caption} className="min-w-0 text-left group">
              <span className="relative block aspect-video overflow-hidden rounded border border-zinc-700 group-hover:border-zinc-500 bg-black">
                {m.kind === 'video' ? (
                  <>
                    {/* the first frame as the tile's picture */}
                    <video src={`${api.screenshotUrl(goalId, m.file)}#t=0.1`} muted preload="metadata" playsInline className="h-full w-full object-cover object-top pointer-events-none" />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="rounded-full bg-black/60 p-2 text-zinc-100">
                        <Play size={14} fill="currentColor" />
                      </span>
                    </span>
                  </>
                ) : (
                  <img src={api.screenshotUrl(goalId, m.file)} alt={m.caption} loading="lazy" className="h-full w-full object-cover object-top" />
                )}
              </span>
              <span className="block text-[10px] text-zinc-500 truncate mt-0.5">{m.caption}</span>
            </button>
          ))}
        </div>
      )}
      {evidence.error && <div className="text-[11px] text-amber-300/90">{evidence.error}</div>}
      {shown !== null && items[shown] && <MediaViewer goalId={goalId} items={items} index={shown} onIndex={setShown} onClose={() => setShown(null)} />}
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
