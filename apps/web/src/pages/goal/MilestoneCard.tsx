import type { FeedbackPlan } from '@foundry/core/browser';
import { Eye, MessageSquare, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type GoalDetail, api } from '../../api.ts';
import { Button, NEEDS_YOU_CARD, Select, Textarea, YouStrip, cn } from '../../ui.tsx';
import { MediaLightbox } from '../../components/MediaLightbox.tsx';
import { markFill } from '../../components/progress.tsx';
import { type Evidence, EvidenceView, FINAL_WALK, LikenessView, evidenceStatus, likenessOf, showsFiles } from './MilestoneEvidence.tsx';
import { PreviewCard } from './PreviewCard.tsx';
import { HelpLink } from '../HelpPage.tsx';

const KIND_LABEL: Record<FeedbackPlan['kind'], string> = { hint: 'Hint for the remaining tasks', fix: 'Fix tasks (then a second look here)', decision: 'Decision (every later task follows it)' };
const IMAGE = /\.(png|jpe?g|webp|gif|svg)$/i;
/** a label in small capitals over a row of pictures */
const LABEL = 'mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint';

/**
 * The goal paused at a milestone: what to look at, the preview, what the self-check saw, the artifacts — and the two ways
 * out: continue, or write what you saw and confirm what it becomes. It waits for you, so it opens with a yellow strip.
 */
export function MilestoneCard({ d }: { d: GoalDetail }) {
  const g = d.goal;
  const cp = g.checkpoint;
  const task = cp ? d.tasks.find((t) => t.id === cp.taskId) : null;
  const esc = d.escalations.find((e) => e.trigger === 'milestone' && e.state === 'open');
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<FeedbackPlan | null>(null);
  const [busy, setBusy] = useState<null | 'classify' | 'continue' | 'confirm'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shots, setShots] = useState<{ at: string; status: string; screenshot: string | null; summary: string }[]>([]);
  const [artifacts, setArtifacts] = useState<string[]>([]);
  useEffect(() => {
    void api.screenshots(g.id).then((r) => setShots(r.screenshots.filter((s) => s.screenshot))).catch(() => {});
    void api.artifacts(g.id).then((r) => setArtifacts(r.files)).catch(() => {});
  }, [g.id, cp?.openedAt]);
  if (!cp) return null;
  const act = async (kind: NonNullable<typeof busy>, fn: () => Promise<unknown>) => {
    setBusy(kind);
    setErr(null);
    try {
      await fn();
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    } finally {
      setBusy(null);
    }
  };
  const classify = () => act('classify', async () => setPlan((await api.feedbackClassify(g.id, text)).plan));
  const rekind = (kind: FeedbackPlan['kind']) => {
    if (!plan) return;
    if (kind === 'hint') setPlan({ ...plan, kind, hint: plan.hint ?? text, fixTasks: [], decision: null });
    else if (kind === 'fix') setPlan({ ...plan, kind, fixTasks: plan.fixTasks.length ? plan.fixTasks : [{ title: text.split('\n')[0]!.slice(0, 60) || 'apply the feedback', spec: text, relevantFiles: [] }], decision: null });
    else setPlan({ ...plan, kind, decision: plan.decision ?? text });
  };
  const cont = () => esc && act('continue', () => api.answer(esc.id, { action: 'continue' }));
  const confirm = () => esc && plan && act('confirm', () => api.answer(esc.id, { action: 'feedback', feedback: text, plan }));
  return (
    <section className={NEEDS_YOU_CARD}>
      <YouStrip
        icon={Eye}
        title={
          <>
            {cp.recheck ? 'Second look' : 'Have a look'}
            <span className="text-lg sm:text-xl font-bold tracking-[-0.01em]"> — {cp.taskId === FINAL_WALK ? 'the final walkthrough' : (task?.title ?? cp.taskId)}</span>
          </>
        }
        tags={<HelpLink to="while-it-runs#milestones" label="What a milestone look is for (new tab)" />}
        since={cp.openedAt}
      />
      <div className="space-y-4 p-4 sm:p-5 text-xs text-ink-soft">
        {/* what to look at: the question the look answers, the largest words on the panel */}
        <p className="whitespace-pre-wrap text-base sm:text-[17px] font-semibold leading-snug text-ink">{cp.lookFor}</p>
        {cp.recheck && cp.taskId !== FINAL_WALK && <p className="text-[13px] leading-snug text-work-ink">This is the second look at this milestone, after the fix tasks from your feedback landed. Anything you write now becomes a hint for the remaining tasks; the goal does not pause here again.</p>}
        {cp.recheck && cp.taskId === FINAL_WALK && <p className="text-[13px] leading-snug text-work-ink">This is the second look at the final walkthrough, after the fixes from your feedback landed. What you write now still becomes fix tasks, but the goal does not pause here again.</p>}
        {cp.taskId === FINAL_WALK ? <FinalWalkthrough d={d} /> : <Walkthrough d={d} taskId={cp.taskId} since={cp.openedAt} />}
        <PreviewCard goalId={g.id} embedded />
        {shots.length > 0 && (
          <div>
            <div className={LABEL}>What the self-check saw</div>
            <div className="flex gap-2 flex-wrap">
              {shots.slice(0, 4).map((s) => (
                <a key={s.at} href={api.screenshotUrl(g.id, s.screenshot!)} target="_blank" rel="noreferrer" title={`${s.status} · ${s.summary.split('\n')[0]}`}>
                  <img src={api.screenshotUrl(g.id, s.screenshot!)} alt={s.summary} className={cn('h-24 w-40 object-cover object-top rounded-md border-2', s.status === 'pass' ? 'border-ok/70' : s.status === 'fail' ? 'border-bad/70' : 'border-line-strong')} />
                </a>
              ))}
            </div>
          </div>
        )}
        <ArtifactsStrip goalId={g.id} files={artifacts} shown={stripShown(d, task, cp.openedAt)} />
        <div className="text-xs text-ink-faint">The code so far is on the Diff tab; the folder itself is under Open ▾ above.</div>
        <div className="border-t border-line pt-4 space-y-3">
          <Textarea className="w-full text-sm min-h-[72px]" placeholder="What did you see? Anything to change, keep, or that is wrong… (leave empty and press Continue if it looks right)" value={text} onChange={(e) => { setText(e.target.value); setPlan(null); }} disabled={!esc || busy !== null} />
          {plan && (
            <div className="rounded-md border border-line bg-sunken p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <MessageSquare size={13} className="text-work-ink" aria-hidden="true" />
                <span className="font-semibold text-ink">This becomes:</span>
                <span className="min-w-0 max-w-full">
                  <Select className="text-xs py-1" value={plan.kind} onChange={(e) => rekind(e.target.value as FeedbackPlan['kind'])} disabled={cp.recheck}>
                    {(Object.keys(KIND_LABEL) as FeedbackPlan['kind'][]).map((k) => (
                      <option key={k} value={k}>{KIND_LABEL[k]}</option>
                    ))}
                  </Select>
                </span>
              </div>
              <div className="text-ink-soft">{plan.rationale}</div>
              {plan.kind === 'hint' && <div className="text-[13px] text-ink whitespace-pre-wrap">{plan.hint || <span className="text-ink-faint">(nothing to pass on — the remaining tasks run unchanged)</span>}</div>}
              {plan.kind === 'decision' && <div className="text-[13px] text-ink whitespace-pre-wrap">Decision: {plan.decision}</div>}
              {plan.fixTasks.length > 0 && (
                <ul className="list-disc pl-4 space-y-1 marker:text-ink-faint">
                  {plan.fixTasks.map((f, i) => (
                    <li key={i}>
                      <span className="text-[13px] font-semibold text-ink">{f.title}</span>
                      {f.relevantFiles.length > 0 && <span className="mono text-ink-faint"> · {f.relevantFiles.join(', ')}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {err && <div className="text-bad-ink">{err}</div>}
          <div className="flex items-center gap-2 flex-wrap">
            {!plan ? (
              <Button size="sm" variant="primary" disabled={!esc || !text.trim() || busy !== null} onClick={classify} title="A small session reads your note and proposes what it becomes; you confirm before anything changes (≤ $0.5)">
                <MessageSquare size={12} /> {busy === 'classify' ? 'Reading…' : 'Turn into a plan'}
              </Button>
            ) : (
              <Button size="sm" variant="primary" disabled={!esc || busy !== null} onClick={confirm}>
                {busy === 'confirm' ? 'Applying…' : 'Confirm & continue'}
              </Button>
            )}
            <Button size="sm" variant={plan ? 'ghost' : 'default'} disabled={!esc || busy !== null} onClick={cont} title="Looks right — carry on with the remaining tasks">
              <Play size={12} /> {busy === 'continue' ? 'Continuing…' : 'Continue'}
            </Button>
            {!esc && <span className="text-ink-faint">(no open milestone escalation — refresh)</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * what a milestone of files' evidence shows (paths relative to artifacts/: its pictures, clips and named files), or null
 * while that evidence is on its way or failed
 */
export function evidenceShows(d: Pick<GoalDetail, 'milestoneEvents' | 'milestoneRuns'>, taskId: string, since: string): Set<string> | null {
  const ev = d.milestoneEvents.filter((e) => e.type === 'milestone.evidence' && (e.payload as Evidence).taskId === taskId).at(-1);
  if (!ev || (ev.ts < since && (d.milestoneRuns ?? []).includes(taskId))) return null;
  const p = ev.payload as Evidence;
  if (evidenceStatus(p) === 'fail') return null;
  return new Set([...p.shots.map((s) => s.caption), ...(p.clips ?? []).map((c) => c.caption), ...(p.files ?? [])]);
}

/** what the artifacts strip leaves out at a milestone: what the evidence of a milestone of files shows; a walkthrough or a scripted milestone leaves out nothing */
export const stripShown = (d: Pick<GoalDetail, 'milestoneEvents' | 'milestoneRuns'>, task: { id: string; scenario: string; milestoneScript?: string | null } | null | undefined, since: string): Set<string> | null =>
  task && showsFiles(task) ? evidenceShows(d, task.id, since) : null;

/** the goal's artifacts; `shown`: what a milestone of files' evidence above already shows, listed here only when not */
export function ArtifactsStrip({ goalId, files, shown }: { goalId: string; files: string[]; shown: ReadonlySet<string> | null }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const rest = shown ? files.filter((f) => !shown.has(f)) : files;
  if (!rest.length) return null;
  // the pictures open large, one after another; other files open (or download) in a tab of their own
  const pictures = rest.slice(0, 12).filter((f) => IMAGE.test(f));
  return (
    <div>
      <div className={LABEL}>{shown ? 'Other artifacts' : 'Artifacts'} ({rest.length})</div>
      <div className="flex gap-2 flex-wrap items-end">
        {rest.slice(0, 12).map((f) =>
          IMAGE.test(f) ? (
            <button key={f} type="button" onClick={() => setViewing(pictures.indexOf(f))} title={f}>
              <img src={api.artifactUrl(goalId, f)} alt={f} loading="lazy" decoding="async" className="h-24 w-24 object-cover rounded-md border border-line-strong hover:border-ink-faint" />
            </button>
          ) : (
            <a key={f} href={api.artifactUrl(goalId, f)} target="_blank" rel="noreferrer" className="mono text-[11px] text-ink-soft hover:text-ink hover:underline">
              {f}
            </a>
          ),
        )}
      </div>
      {viewing !== null && pictures[viewing] && (
        <MediaLightbox items={pictures.map((f) => ({ kind: 'image' as const, src: api.artifactUrl(goalId, f), caption: f, link: { href: api.artifactUrl(goalId, f), label: 'open the file' } }))} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} title={shown ? 'Other artifacts' : 'Artifacts'} />
      )}
    </div>
  );
}

/** the final walkthrough: every feature's latest recording, one after another, the failing ones first */
function FinalWalkthrough({ d }: { d: GoalDetail }) {
  const latest = new Map<string, { ev: Evidence; at: string }>();
  for (const e of d.milestoneEvents) if (e.type === 'milestone.evidence') latest.set((e.payload as Evidence).taskId, { ev: e.payload as Evidence, at: e.ts });
  const rows = d.tasks.filter((t) => t.milestone && latest.has(t.id)).map((t) => ({ task: t, ...latest.get(t.id)! }));
  rows.sort((a, b) => Number(evidenceStatus(a.ev) === 'pass') - Number(evidenceStatus(b.ev) === 'pass'));
  if (!rows.length) return null;
  return (
    <div className="space-y-4">
      {rows.map(({ task, ev, at }) => (
        <div key={task.id} className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[13px] font-bold text-ink">
            {task.title}
            {/* a failed recording in the failure colour; fake data is a caveat, not a signal */}
            {evidenceStatus(ev) !== 'pass' && <span className={cn('rounded-sm px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] ring-1 ring-inset', evidenceStatus(ev) === 'fail' ? 'bg-bad/10 text-bad-ink ring-bad/40' : 'text-ink-soft ring-line-strong')}>{evidenceStatus(ev) === 'fail' ? 'failed' : 'fake data only'}</span>}
          </div>
          <EvidenceView key={at} goalId={d.goal.id} evidence={ev} taskId={task.id} />
        </div>
      ))}
    </div>
  );
}

/** what Foundry recorded for this milestone (a walkthrough of the preview, or the files the task produced), so the person can look without starting anything */
function Walkthrough({ d, taskId, since }: { d: GoalDetail; taskId: string; since: string }) {
  const ev = d.milestoneEvents.filter((e) => e.type === 'milestone.evidence' && (e.payload as Evidence).taskId === taskId).at(-1);
  // a task whose deliverables are files (a model's snapshots, images, video) shows those files, not a walkthrough
  const task = d.tasks.find((t) => t.id === taskId);
  const files = !!task && showsFiles(task);
  // an older recording shows while no new one is on its way (a milestone that paused after its script failed again)
  if (!ev || (ev.ts < since && (d.milestoneRuns ?? []).includes(taskId)))
    return (
      <div className="flex items-center gap-2 text-[13px] text-ink-soft">
        {/* under way: the flowing hatch of running work */}
        <i className={cn('block h-3 w-3 shrink-0 rounded-[3px]', markFill.run)} aria-hidden="true" />
        {files ? 'Collecting what the task produced…' : 'Recording a walkthrough of the preview…'}
      </div>
    );
  const look = likenessOf(d, taskId, ev.ts);
  return (
    <div className="space-y-2">
      <EvidenceView key={ev.ts} goalId={d.goal.id} evidence={ev.payload as Evidence} taskId={taskId} />
      <LikenessView goalId={d.goal.id} look={look} subjects={d.brief?.brief.subjects ?? []} running={(d.likenessRuns ?? []).includes(taskId)} fixTitle={d.tasks.find((t) => t.id === look?.fixTaskId)?.title ?? null} />
    </div>
  );
}
