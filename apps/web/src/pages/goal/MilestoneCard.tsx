import type { FeedbackPlan } from '@foundry/core/browser';
import { Eye, MessageSquare, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type GoalDetail, api } from '../../api.ts';
import { Button, Card, Select, Textarea, cn } from '../../ui.tsx';
import { PreviewCard } from './PreviewCard.tsx';

const KIND_LABEL: Record<FeedbackPlan['kind'], string> = { hint: 'Hint for the remaining tasks', fix: 'Fix tasks (then a second look here)', decision: 'Decision (every later task follows it)' };
const IMAGE = /\.(png|jpe?g|webp|gif|svg)$/i;

/**
 * The goal paused at a milestone: what to look at, the preview, what the self-check saw, the artifacts — and the two ways
 * out: continue, or write what you saw and confirm what it becomes.
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
    <Card
      title={
        <span className="flex items-center gap-2">
          <Eye size={14} className="text-amber-300" /> {cp.recheck ? 'Second look' : 'Have a look'} — {task?.title ?? cp.taskId}
        </span>
      }
    >
      <div className="space-y-3 text-xs text-zinc-400">
        <p className="text-sm text-zinc-200 whitespace-pre-wrap">{cp.lookFor}</p>
        {cp.recheck && <p className="text-[11px] text-amber-300">This is the second look at this milestone, after the fix tasks from your feedback landed. Anything you write now becomes a hint for the remaining tasks; the goal does not pause here again.</p>}
        <PreviewCard goalId={g.id} selfCheck={g.selfCheck} embedded />
        {shots.length > 0 && (
          <div>
            <div className="text-[11px] text-zinc-500 mb-1">What the self-check saw</div>
            <div className="flex gap-2 flex-wrap">
              {shots.slice(0, 4).map((s) => (
                <a key={s.at} href={api.screenshotUrl(g.id, s.screenshot!)} target="_blank" rel="noreferrer" title={`${s.status} · ${s.summary.split('\n')[0]}`}>
                  <img src={api.screenshotUrl(g.id, s.screenshot!)} alt={s.summary} className={cn('h-24 w-40 object-cover object-top rounded border-2', s.status === 'pass' ? 'border-emerald-500/60' : s.status === 'fail' ? 'border-rose-500/60' : 'border-zinc-700')} />
                </a>
              ))}
            </div>
          </div>
        )}
        {artifacts.length > 0 && (
          <div>
            <div className="text-[11px] text-zinc-500 mb-1">Artifacts ({artifacts.length})</div>
            <div className="flex gap-2 flex-wrap items-end">
              {artifacts.slice(0, 12).map((f) =>
                IMAGE.test(f) ? (
                  <a key={f} href={api.artifactUrl(g.id, f)} target="_blank" rel="noreferrer" title={f}>
                    <img src={api.artifactUrl(g.id, f)} alt={f} className="h-24 w-24 object-cover rounded border border-zinc-700" />
                  </a>
                ) : (
                  <a key={f} href={api.artifactUrl(g.id, f)} target="_blank" rel="noreferrer" className="mono text-[11px] text-zinc-300 hover:underline">
                    {f}
                  </a>
                ),
              )}
            </div>
          </div>
        )}
        <div className="text-[11px] text-zinc-500">The code so far is on the Diff tab; the folder itself is under Open ▾ above.</div>
        <div className="border-t border-zinc-800 pt-3 space-y-2">
          <Textarea className="w-full text-sm min-h-[72px]" placeholder="What did you see? Anything to change, keep, or that is wrong… (leave empty and press Continue if it looks right)" value={text} onChange={(e) => { setText(e.target.value); setPlan(null); }} disabled={!esc || busy !== null} />
          {plan && (
            <div className="rounded border border-zinc-700 bg-zinc-900/60 p-2 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <MessageSquare size={12} className="text-sky-300" />
                <span className="text-zinc-300">This becomes:</span>
                <Select className="text-xs py-1" value={plan.kind} onChange={(e) => rekind(e.target.value as FeedbackPlan['kind'])} disabled={cp.recheck}>
                  {(Object.keys(KIND_LABEL) as FeedbackPlan['kind'][]).map((k) => (
                    <option key={k} value={k}>{KIND_LABEL[k]}</option>
                  ))}
                </Select>
              </div>
              <div className="text-zinc-400">{plan.rationale}</div>
              {plan.kind === 'hint' && <div className="text-zinc-300 whitespace-pre-wrap">{plan.hint || <span className="text-zinc-500">(nothing to pass on — the remaining tasks run unchanged)</span>}</div>}
              {plan.kind === 'decision' && <div className="text-zinc-300 whitespace-pre-wrap">Decision: {plan.decision}</div>}
              {plan.fixTasks.length > 0 && (
                <ul className="list-disc pl-4 space-y-1">
                  {plan.fixTasks.map((f, i) => (
                    <li key={i}>
                      <span className="text-zinc-200">{f.title}</span>
                      {f.relevantFiles.length > 0 && <span className="mono text-zinc-500"> · {f.relevantFiles.join(', ')}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {err && <div className="text-rose-300">{err}</div>}
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
            {!esc && <span className="text-zinc-500">(no open milestone escalation — refresh)</span>}
          </div>
        </div>
      </div>
    </Card>
  );
}
