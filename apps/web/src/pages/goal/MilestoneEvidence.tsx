import { ARTIFACT_SCENARIOS } from '@foundry/core/browser';
import { CheckCircle2, ChevronLeft, ChevronRight, Eye, FastForward, FileCode2, FileDown, Loader2, MessageSquare, Play, RotateCcw, ScrollText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type GoalDetail, api, fileUrl } from '../../api.ts';
import { Button, Card, Modal, ago, cn } from '../../ui.tsx';

type Item = { file: string; caption: string };
export type Evidence = {
  taskId: string;
  video: string | null;
  shots: Item[];
  summary: string;
  error: string | null;
  mock?: boolean;
  script?: string | null;
  status?: 'pass' | 'fail' | 'unverified';
  clips?: Item[];
  outputs?: Item[];
  log?: string | null;
  final?: boolean;
  /** 'files': what a task produced (a model's snapshots, images, video), not a walkthrough */
  kind?: 'files';
  /** a milestone of files: the models, drawings and too-large clips it names, relative to artifacts/ */
  files?: string[];
};

/** a task whose milestone shows the files it produced (a model's snapshots, images, video) instead of a walkthrough, as the engine decides: a milestone script comes first */
export const showsFiles = (t: { scenario: string; milestoneScript?: string | null }) => !t.milestoneScript && (ARTIFACT_SCENARIOS as readonly string[]).includes(t.scenario);

/** the task id the final walkthrough uses where a milestone's goes */
export const FINAL_WALK = 'final';

/** what a recording proved: older recordings carry no status, so it is read from what they hold */
export const evidenceStatus = (e: Evidence): 'pass' | 'fail' | 'unverified' => e.status ?? (e.mock ? 'unverified' : e.shots.length || e.video ? 'pass' : 'fail');

const STATUS: Record<'pass' | 'fail' | 'unverified' | 'running' | 'none', { label: string; className: string }> = {
  pass: { label: 'shown', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-700/50' },
  unverified: { label: 'unverified · fake data', className: 'bg-amber-500/15 text-amber-300 border-amber-700/50' },
  fail: { label: 'failed', className: 'bg-rose-500/15 text-rose-300 border-rose-700/50' },
  running: { label: 'recording…', className: 'bg-sky-500/15 text-sky-300 border-sky-700/50' },
  none: { label: 'not reached yet', className: 'bg-zinc-800 text-zinc-400 border-zinc-700' },
};

/** `files`: a milestone of files, which is collected, not recorded */
function StatusChip({ status, files = false }: { status: keyof typeof STATUS; files?: boolean }) {
  const s = STATUS[status];
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide', s.className)}>
      {status === 'running' && <Loader2 size={10} className="animate-spin" />}
      {status === 'running' && files ? 'collecting…' : s.label}
    </span>
  );
}

type Media = { kind: 'video' | 'image'; file: string; caption: string };

/** the recording as one row of items: the videos first (one per scripted test), then the screenshots in the order taken */
const mediaOf = (e: Evidence): Media[] => [
  ...(e.video ? [{ kind: 'video' as const, file: e.video, caption: 'Walkthrough video' }] : []),
  ...(e.clips ?? []).map((c) => ({ kind: 'video' as const, ...c })),
  ...e.shots.map((s) => ({ kind: 'image' as const, ...s })),
];

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

/** text a milestone script attached (an API's responses), shown as it came */
function OutputBlock({ goalId, item }: { goalId: string; item: Item }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(api.screenshotUrl(goalId, item.file))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => {
        if (!alive) return;
        try {
          setText(JSON.stringify(JSON.parse(t), null, 2));
        } catch {
          setText(t);
        }
      })
      .catch(() => alive && setText('(could not be read)'));
    return () => {
      alive = false;
    };
  }, [goalId, item.file]);
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-zinc-500 truncate mb-0.5">{item.caption}</div>
      <pre className="surface-inset mono text-[11px] text-zinc-300 bg-zinc-900 border border-zinc-800 rounded p-2 max-h-48 overflow-auto whitespace-pre">{text ?? '…'}</pre>
    </div>
  );
}

/**
 * a milestone's recording: the videos and screenshots as same-size tiles (a click opens them in a viewer), what an API
 * answered, the script and its log, and why when it could not show it. A milestone of files shows what the task
 * produced: its pictures whole (a model's snapshot is not a page to crop), and its models and drawings as links.
 */
export function EvidenceView({ goalId, evidence, taskId }: { goalId: string; evidence: Evidence; taskId?: string }) {
  const [shown, setShown] = useState<number | null>(null);
  const items = mediaOf(evidence);
  const status = evidenceStatus(evidence);
  const files = evidence.kind === 'files';
  const fit = files ? 'object-contain' : 'object-cover object-top';
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-zinc-500">
        {files ? 'What the task produced' : 'What Foundry saw'}
        {evidence.summary ? `${files ? ' · ' : ': '}${evidence.summary}` : ''}
      </div>
      {files && (evidence.files ?? []).length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          {evidence.files!.map((f) => (
            <a key={f} href={api.artifactUrl(goalId, f)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline mono" title={`${f}: opens or downloads in a new tab`}>
              <FileDown size={11} /> {f}
            </a>
          ))}
        </div>
      )}
      {(evidence.script || evidence.log) && (
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          {evidence.script && (
            taskId ? (
              <a href={fileUrl({ goal: goalId, task: taskId, rel: evidence.script })} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline mono" title="The Playwright script that recorded this milestone (opens in a new tab)">
                <FileCode2 size={11} /> {evidence.script}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 text-zinc-400 mono"><FileCode2 size={11} /> {evidence.script}</span>
            )
          )}
          {evidence.log && (
            <a href={api.screenshotUrl(goalId, evidence.log)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline" title="What the script runner printed (opens in a new tab)">
              <ScrollText size={11} /> runner log
            </a>
          )}
        </div>
      )}
      {items.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
          {items.map((m, i) => (
            <button key={m.file} type="button" onClick={() => setShown(i)} title={m.caption} className="min-w-0 text-left group">
              <span className={cn('relative block aspect-video overflow-hidden rounded border border-zinc-700 group-hover:border-zinc-500', files ? 'bg-zinc-950' : 'bg-black')}>
                {m.kind === 'video' ? (
                  <>
                    {/* the first frame as the tile's picture */}
                    <video src={`${api.screenshotUrl(goalId, m.file)}#t=0.1`} muted preload="metadata" playsInline className={cn('h-full w-full pointer-events-none', fit)} />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="rounded-full bg-black/60 p-2 text-zinc-100">
                        <Play size={14} fill="currentColor" />
                      </span>
                    </span>
                  </>
                ) : (
                  <img src={api.screenshotUrl(goalId, m.file)} alt={m.caption} loading="lazy" className={cn('h-full w-full', fit)} />
                )}
              </span>
              {/* a file's caption keeps its folder and name, where a long path would lose the view that tells two apart */}
              <span className="block text-[10px] text-zinc-500 truncate mt-0.5">{files ? m.caption.split('/').slice(-2).join('/') : m.caption}</span>
            </button>
          ))}
        </div>
      )}
      {(evidence.outputs ?? []).length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {evidence.outputs!.map((o) => (
            <OutputBlock key={o.file} goalId={goalId} item={o} />
          ))}
        </div>
      )}
      {status === 'unverified' && <div className="text-[11px] text-amber-300/90">Shown with fake data only: it does not count as reached. Rerun it once the real app can start.</div>}
      {evidence.error && <div className={cn('text-[11px] whitespace-pre-wrap', status === 'fail' ? 'text-rose-300/90' : 'text-amber-300/90')}>{evidence.error}</div>}
      {shown !== null && items[shown] && <MediaViewer goalId={goalId} items={items} index={shown} onIndex={setShown} onClose={() => setShown(null)} />}
    </div>
  );
}

/** what happened at one milestone visit */
interface Visit {
  at: string;
  paused: boolean;
  recheck: boolean;
  outcome: { action: 'continue' | 'feedback'; feedback: string | null } | null;
}

/** a recording of one milestone, with when it was made */
type Recording = { at: string; evidence: Evidence };

/**
 * Every milestone of the goal in plan order, one per feature: whether it was shown (a passing script, a walkthrough of
 * the real app, or the files a task produced), shown with fake data only, or failed; when it landed and what the person
 * answered; its latest recording, so it can be looked at again; and a Rerun. On top, the final walkthrough that ran
 * every script once all tasks were done.
 */
export function MilestonesCard({ d }: { d: GoalDetail }) {
  const g = d.goal;
  // each milestone opens on its own: looking at one never folds another away
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set());
  const [err, setErr] = useState<string | null>(null);
  const toggle = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const visits = new Map<string, Visit[]>();
  const latest = new Map<string, Recording>();
  let finalWalk: { at: string; passed: boolean; failed: string[] } | null = null;
  for (const e of d.milestoneEvents) {
    if (e.type === 'milestone.final_walk') {
      const p = e.payload as { passed: boolean; failed: string[] };
      finalWalk = { at: e.ts, passed: p.passed, failed: p.failed };
      continue;
    }
    const p = e.payload as { taskId?: string; recheck?: boolean; action?: 'continue' | 'feedback'; feedback?: string | null };
    if (!p.taskId) continue;
    if (e.type === 'milestone.evidence') {
      latest.set(p.taskId, { at: e.ts, evidence: e.payload as Evidence });
      continue;
    }
    const list = visits.get(p.taskId) ?? [];
    if (e.type === 'goal.checkpoint_opened') list.push({ at: e.ts, paused: true, recheck: !!p.recheck, outcome: null });
    else if (e.type === 'goal.milestone_passed') list.push({ at: e.ts, paused: false, recheck: false, outcome: null });
    else if (e.type === 'goal.checkpoint_closed' && list.length) list.at(-1)!.outcome = { action: p.action!, feedback: p.feedback ?? null };
    else continue;
    visits.set(p.taskId, list);
  }
  const runs = new Set([...(d.milestoneRuns ?? []), ...asked]);
  const milestones = d.tasks.filter((t) => t.milestone).map((t) => ({ task: t, visits: visits.get(t.id) ?? [], rec: latest.get(t.id) ?? null }));
  if (!milestones.length) return null;
  const reached = milestones.filter((m) => m.rec && evidenceStatus(m.rec.evidence) === 'pass').length;
  const landed = milestones.filter((m) => m.task.state === 'done');
  const rerun = async (taskId: string) => {
    setErr(null);
    setAsked((a) => new Set([...a, ...(taskId === FINAL_WALK ? landed.map((m) => m.task.id) : [taskId])]));
    try {
      await api.rerunMilestone(g.id, taskId);
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    } finally {
      // the goal's own list says what still runs from here on
      setTimeout(() => setAsked(new Set()), 4000);
    }
  };
  const finalRunning = runs.has(FINAL_WALK);
  return (
    <Card
      title={`Milestones (${reached}/${milestones.length} shown)`}
      actions={
        landed.length > 0 && (
          <Button size="sm" variant="info" disabled={landed.every((m) => runs.has(m.task.id))} onClick={() => void rerun(FINAL_WALK)} title="Record every milestone that landed again: scripts run, walkthroughs replay, milestones of files collect their files again">
            <RotateCcw size={12} /> Rerun all
          </Button>
        )
      }
    >
      {err && <div className="mb-2 text-[11px] text-rose-300">{err}</div>}
      {(finalWalk || finalRunning) && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 text-xs">
          <span className="font-medium text-zinc-200">Final walkthrough</span>
          <StatusChip status={finalRunning ? 'running' : finalWalk!.passed ? 'pass' : 'fail'} />
          <span className="text-[11px] text-zinc-500 truncate">
            {finalRunning ? 'every feature’s script runs once more on the finished branch' : finalWalk!.passed ? `every script passed · ${ago(finalWalk!.at)}` : `${finalWalk!.failed.length} script${finalWalk!.failed.length > 1 ? 's' : ''} failed · ${ago(finalWalk!.at)}`}
          </span>
        </div>
      )}
      <ul className="text-xs divide-y divide-zinc-800/70">
        {milestones.map(({ task, visits: vs, rec }) => {
          const last = vs.at(-1);
          const expanded = open.has(task.id);
          const running = runs.has(task.id);
          const files = showsFiles(task);
          const status = running ? 'running' : rec ? evidenceStatus(rec.evidence) : 'none';
          return (
            <li key={task.id} className="py-2 first:pt-0 last:pb-0">
              <div className="flex items-start gap-2">
                <button type="button" disabled={!rec} onClick={() => toggle(task.id)} className="min-w-0 flex-1 flex items-start gap-2 text-left enabled:hover:text-zinc-50" aria-expanded={rec ? expanded : undefined}>
                  <span className="mt-0.5 shrink-0">{!last ? <Eye size={13} className="text-zinc-600" /> : last.paused ? <Eye size={13} className="text-amber-300" /> : <FastForward size={13} className="text-sky-300" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-zinc-200 font-medium">{task.title}</span>
                      <StatusChip status={status} files={files} />
                    </span>
                    <span className="block text-zinc-500 truncate">{task.milestone}</span>
                    <span className="block text-[11px] text-zinc-500">
                      {!last ? (task.state === 'done' ? 'landed' : 'not reached yet') : `${ago(last.at)} · ${last.paused ? (last.recheck ? 'second look' : 'paused for a look') : task.milestoneScript ? 'recorded, the goal went on' : 'went on (Have a look off)'}`}
                      {rec && rec.at !== last?.at && <span> · {files ? 'collected' : 'recorded'} {ago(rec.at)}{rec.evidence.final ? ' (final walkthrough)' : ''}</span>}
                      {last?.outcome?.action === 'continue' && <span className="inline-flex items-center gap-0.5 text-emerald-300/90"> · <CheckCircle2 size={10} /> continued</span>}
                      {last?.outcome?.action === 'feedback' && <span className="inline-flex items-center gap-0.5 text-sky-300/90"> · <MessageSquare size={10} /> feedback: {last.outcome.feedback?.slice(0, 80)}</span>}
                    </span>
                  </span>
                  {rec && <ChevronRight size={13} className={cn('mt-0.5 shrink-0 text-zinc-500 transition-transform', expanded && 'rotate-90')} />}
                </button>
                {task.state === 'done' && (
                  <Button size="sm" variant="info" className="shrink-0" disabled={running} onClick={() => void rerun(task.id)} title={task.milestoneScript ? `Run ${task.milestoneScript} again and record what it shows` : files ? "Show the task's files again (snapshots, images, video)" : 'Replay the walkthrough recorded last time in the preview'}>
                    <RotateCcw size={12} /> Rerun
                  </Button>
                )}
              </div>
              {expanded && rec && (
                <div className="mt-2 ml-5">
                  <EvidenceView goalId={g.id} evidence={rec.evidence} taskId={task.id} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
