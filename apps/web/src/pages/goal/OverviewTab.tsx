import type { CheckResult } from '@foundry/core/browser';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, type GoalDetail } from '../../api.ts';
import { AttachmentInput } from '../../components/Attachments.tsx';
import { OpenFull } from '../../components/FullTextDialog.tsx';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { PreviewCard } from './PreviewCard.tsx';
import { Badge, Card, cn } from '../../ui.tsx';
import { EscalationCard } from '../InboxPage.tsx';
import { CodexModelsCard } from './CodexModelsCard.tsx';
import { CompletionCard } from './CompletionCard.tsx';
import { ProjectSkillsCard } from './ProjectSkillsCard.tsx';

const STAGES = ['clarifying', 'awaiting_brief_approval', 'running', 'goal_review', 'done'] as const;
const STAGE_LABEL: Record<string, string> = { clarifying: 'Clarify', awaiting_brief_approval: 'Brief', running: 'Run', goal_review: 'Review', done: 'Done' };
/** where each stage pill takes you: the page or tab that shows that stage's work */
const STAGE_LINK: Record<string, (goalId: string) => string> = {
  clarifying: (id) => `/goals/${id}#activity`,
  awaiting_brief_approval: (id) => `/goals/${id}/brief`,
  running: (id) => `/goals/${id}#tasks`,
  goal_review: (id) => `/goals/${id}#activity`,
  done: (id) => `/goals/${id}#delivery`,
};
const STAGE_LINK_HINT: Record<string, string> = {
  clarifying: 'open the Activity tab (Clarify session log)',
  awaiting_brief_approval: 'open the Brief page',
  running: 'open the Tasks tab',
  goal_review: 'open the Activity tab (review sessions)',
  done: 'open the Delivery tab',
};

export function OverviewTab({ d }: { d: GoalDetail }) {
  const g = d.goal;
  const open = d.escalations.filter((e) => e.state === 'open');
  const reached = new Set(d.events.filter((e) => e.type === 'goal.state_changed').map((e) => (e.payload as any).to as string));
  const terminalOk = g.state === 'done' || g.state === 'over_delivered';
  const stageIdx = (s: string) => STAGES.indexOf(s as any);
  const currentIdx = g.state === 'blocked' ? stageIdx(g.stateBeforeBlock ?? 'running') : terminalOk ? STAGES.length - 1 : stageIdx(g.state);
  const review = [...d.events].reverse().find((e) => e.type === 'review.goal.finished')?.payload as any;
  // goal-level checks: the goal review's own run (no attempt) is the verdict; a merge attempt's run in a scratch worktree is
  // context, not the state of the goal — it stays visible only until a review has run
  const latestResult = (checkId: string): CheckResult | undefined => {
    const runs = [...d.checkResults].reverse().filter((r) => r.checkId === checkId);
    return runs.find((r) => r.attemptId === null) ?? runs[0];
  };
  const must = d.checks.filter((c) => c.tier === 'must');
  const stretch = d.checks.filter((c) => c.tier === 'stretch');
  const taskName = (id: string | null) => (id ? d.tasks.find((t) => t.id === id)?.title ?? id : 'goal');

  return (
    <div className="space-y-4">
      {/* timeline */}
      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
        {STAGES.map((s, i) => {
          const done = i < currentIdx || (i === currentIdx && terminalOk) || reached.has(s) && i < currentIdx;
          const active = i === currentIdx && !terminalOk;
          return (
            <div key={s} className="flex items-center gap-1.5 sm:gap-2 sm:flex-1 min-w-0">
              <Link
                to={STAGE_LINK[s]!(g.id)}
                title={STAGE_LINK_HINT[s]}
                className={cn('flex items-center gap-2 rounded-md border px-2 sm:px-2.5 py-1.5 text-xs sm:flex-1 whitespace-nowrap', done ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300 hover:border-emerald-400/70' : active ? 'border-blue-500/50 bg-blue-500/5 text-blue-300 hover:border-blue-400/80' : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300')}
              >
                <span className={cn('h-2 w-2 rounded-full shrink-0', done ? 'bg-emerald-400' : active ? 'bg-blue-400 animate-pulse' : 'bg-zinc-700')} />
                {s === 'done' && g.state === 'over_delivered' ? 'Over-delivered' : STAGE_LABEL[s]}
              </Link>
              {i < STAGES.length - 1 && <div className={cn('h-px w-2 sm:w-3', done ? 'bg-emerald-500/40' : 'bg-zinc-800')} />}
            </div>
          );
        })}
        {g.delivery.policy.mode !== 'local' && (
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <div className={cn('h-px w-2 sm:w-3', terminalOk ? 'bg-emerald-500/40' : 'bg-zinc-800')} />
            <Link to={`/goals/${g.id}#delivery`} className={cn('flex items-center gap-2 rounded-md border px-2 sm:px-2.5 py-1.5 text-xs whitespace-nowrap', g.delivery.status === 'delivered' ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300 hover:border-emerald-400/70' : g.delivery.status === 'running' ? 'border-blue-500/50 bg-blue-500/5 text-blue-300 hover:border-blue-400/80' : g.delivery.status === 'failed' ? 'border-rose-500/40 bg-rose-500/5 text-rose-300 hover:border-rose-400/70' : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300')} title={g.delivery.status === 'idle' ? `Delivery (${g.delivery.policy.mode}) starts automatically once the goal is done` : `Delivery ${g.delivery.status}`}>
              <span className={cn('h-2 w-2 rounded-full shrink-0', g.delivery.status === 'delivered' ? 'bg-emerald-400' : g.delivery.status === 'running' ? 'bg-blue-400 animate-pulse' : g.delivery.status === 'failed' ? 'bg-rose-400' : 'bg-zinc-700')} />
              Deliver · {g.delivery.policy.mode}
              {g.delivery.prs.length > 0 && (
                <span className="text-zinc-500">
                  · {g.delivery.prs.length} PR{g.delivery.prs.length === 1 ? '' : 's'}
                  {g.delivery.prs.some((p) => p.state === 'merged') ? ` · ${g.delivery.prs.filter((p) => p.state === 'merged').length} merged` : ''}
                </span>
              )}
            </Link>
          </div>
        )}
        {(g.state === 'failed' || g.state === 'cancelled' || g.state === 'blocked') && <Badge state={g.state} className="ml-2" />}
      </div>

      <BriefStrip d={d} />

      {open.length > 0 && (
        <div className="space-y-2">
          {open.map((e) => (
            <EscalationCard key={e.id} e={e} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <MarkdownPanel title="goal" source={g.prompt} maxHeight={240} actions={<OpenFull value={{ title: g.title, text: g.prompt }} />} />
          {/* right under the goal, as on the New goal form: the description and what came with it */}
          <Card title={`Attachments${g.attachments.length ? ` (${g.attachments.length})` : ''}`}>
            <AttachmentInput items={g.attachments} goalId={g.id} onChange={() => {}} />
            <p className="text-[11px] text-zinc-500 mt-2">Attachments are handed to every new session of this goal (Clarify, workers, goal review) as read-only references.</p>
          </Card>
          <CodexModelsCard goal={g} />
          {!['draft', 'clarifying', 'awaiting_brief_approval'].includes(g.state) && <PreviewCard goalId={g.id} goal={g} />}
          {d.events.some((e) => e.type === 'goal.models_changed') && (
            <Card title="Model fallback">
              <div className="text-xs text-zinc-400 space-y-1">
                {d.events
                  .filter((e) => e.type === 'goal.models_changed')
                  .map((e, i) => {
                    const p = e.payload as any;
                    return (
                      <div key={i}>
                        <span className="mono text-zinc-200">{p.from}</span> was unavailable → {p.tier ? `${p.tier} sessions now use ` : 'this goal now uses '}
                        <span className="mono text-zinc-200">{p.to}</span> <span className="text-zinc-600">({p.reason})</span>
                      </div>
                    );
                  })}
                <div className="text-[11px] text-zinc-500">
                  Preset: <span className="mono">{g.provider === 'codex' ? g.codexPreset?.label ?? 'Legacy single model' : g.modelPreset ?? 'Settings default for this goal type'}</span>
                  {Object.keys(g.modelSubstitutions ?? {}).length > 0 && (
                    <>
                      {' '}· replaced for this goal:{' '}
                      {Object.entries(g.modelSubstitutions).map(([from, to]) => (
                        <span key={from} className="mono">
                          {from} → {to}{' '}
                        </span>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </Card>
          )}
          <ProjectSkillsCard d={d} />
          <CompletionCard d={d} />
          {review && (
            <Card title={`Goal review — ${review.passed ? (review.overDelivered ? 'over-delivered' : 'passed') : 'failed'}`}>
              {review.notes ? <MarkdownPanel title="reviewer notes" source={review.notes} maxHeight={240} /> : <div className="text-xs text-zinc-500">no notes</div>}
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card title="Acceptance">
            {[
              ['must', must],
              ['stretch', stretch],
            ].map(([tier, list]) => (
              <div key={tier as string} className="mb-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge state={tier as string} />
                  <span className="text-[11px] text-zinc-500">
                    {(list as typeof must).filter((c) => latestResult(c.id)?.status === 'pass').length}/{(list as typeof must).length} passing
                  </span>
                </div>
                {(list as typeof must).length === 0 && <div className="text-xs text-zinc-600">none</div>}
                {(list as typeof must).map((c) => {
                  const r = latestResult(c.id);
                  return (
                    <details key={c.id} className="text-xs py-0.5">
                      <summary className="flex items-center gap-2 cursor-pointer list-none">
                        {r ? <Badge state={r.status} /> : <span className="text-zinc-600 text-[10px] w-10 text-center">—</span>}
                        <span className="truncate flex-1" title={c.name}>
                          {c.name}
                        </span>
                        <span className="text-[10px] text-zinc-600 truncate max-w-[80px]">{taskName(c.taskId)}</span>
                      </summary>
                      {r && <pre className="mono text-[11px] text-zinc-400 bg-zinc-950 rounded p-2 mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{r.summary}</pre>}
                    </details>
                  );
                })}
              </div>
            ))}
            {!['draft', 'clarifying', 'awaiting_brief_approval'].includes(g.state) && <SelfCheckSection d={d} />}
            {!['draft', 'clarifying', 'awaiting_brief_approval'].includes(g.state) && d.tasks.some((t) => t.milestone) && <MilestonePauseSection d={d} />}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** "Have a look": whether the goal pauses at its milestones; switchable while it runs, from its next milestone */
function MilestonePauseSection({ d }: { d: GoalDetail }) {
  const g = d.goal;
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="border-t border-zinc-800 pt-3 space-y-1.5">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" className="accent-emerald-500" checked={g.milestonePause ?? true} onChange={(e) => api.setMilestonePause(g.id, e.target.checked).catch((x) => setErr(x.body?.error ?? x.message))} />
        <span className="text-xs text-zinc-200">Have a look: pause at milestones</span>
      </label>
      <p className="text-[11px] text-zinc-500">Off: the goal goes on when a milestone lands, and what it shows is sent to your notification channels. Applies from the next milestone.</p>
      {err && <div className="text-[11px] text-rose-300">{err}</div>}
    </div>
  );
}

type Shot = Awaited<ReturnType<typeof api.screenshots>>['screenshots'][number];

/**
 * The self-check is a must check of its own (a screenshot of the preview and its console and network errors after
 * each task lands), so it is switched on and read here, with the other checks.
 */
function SelfCheckSection({ d }: { d: GoalDetail }) {
  const g = d.goal;
  const [last, setLast] = useState<Shot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // asked again when a new run shows up in the goal's events
  const runs = d.events.filter((e) => e.type === 'selfcheck.finished').length;
  useEffect(() => {
    void api.screenshots(g.id).then((r) => setLast(r.screenshots.at(-1) ?? null)).catch(() => {});
  }, [g.id, runs]);
  const toggle = (on: boolean) => {
    setErr(null);
    api.setSelfCheck(g.id, on).catch((e) => setErr(e.body?.error ?? e.message));
  };
  const task = last?.taskId ? d.tasks.find((t) => t.id === last.taskId)?.title : null;
  return (
    <div className="border-t border-zinc-800 pt-3 space-y-1.5">
      <label className="flex items-center gap-2 cursor-pointer" title="Needs Playwright's Chromium (Settings → Preview & self-check)">
        <input type="checkbox" className="accent-emerald-500" checked={g.selfCheck} onChange={(e) => toggle(e.target.checked)} />
        <span className="text-xs text-zinc-200">Self-check after each task</span>
      </label>
      <p className="text-[11px] text-zinc-500">Opens the preview in a headless browser once a task lands, takes a screenshot, and fails on console or network errors.</p>
      {last ? (
        <div className="flex items-start gap-2 text-xs">
          <Badge state={last.status} />
          <span className="min-w-0 text-zinc-400">
            {last.errors.length ? `${last.errors.length} error${last.errors.length === 1 ? '' : 's'}` : 'no errors'}
            {task && <span className="text-zinc-500"> · after {task}</span>}
            {last.screenshot && (
              <>
                {' · '}
                <a href={api.screenshotUrl(g.id, last.screenshot)} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
                  screenshot
                </a>
              </>
            )}
          </span>
        </div>
      ) : (
        g.selfCheck && <div className="text-[11px] text-zinc-600">No run yet.</div>
      )}
      {last && last.errors.length > 0 && (
        <ul className="mono text-[11px] text-rose-300 space-y-0.5 max-h-24 overflow-auto">
          {last.errors.slice(0, 5).map((e, i) => (
            <li key={i} className="break-words">{e}</li>
          ))}
        </ul>
      )}
      {err && <div className="text-[11px] text-rose-300">{err}</div>}
    </div>
  );
}

/**
 * The approved Brief in one line under the timeline: its state and size, with a link to the Brief page, which holds
 * the Understanding and everything else the Clarifier wrote.
 */
function BriefStrip({ d }: { d: GoalDetail }) {
  const g = d.goal;
  const b = d.brief?.brief;
  if (!b) return null;
  const stats = [
    `${b.tasks.length} task${b.tasks.length === 1 ? '' : 's'}`,
    b.assumptions.length ? `${b.assumptions.filter((a) => a.accepted).length}/${b.assumptions.length} assumptions accepted` : null,
    b.questions.length ? `${b.questions.filter((q) => q.answer).length}/${b.questions.length} questions answered` : null,
    `est. ${g.provider !== 'codex' ? `$${b.costEstimateUsd} / ` : ''}${b.timeEstimateMin} min`,
  ].filter(Boolean);
  return (
    <Link to={`/goals/${g.id}/brief`} className="group flex items-center gap-x-3 gap-y-1 flex-wrap rounded-md border border-zinc-800 px-3 py-2 text-xs hover:border-zinc-600" title="Open the Brief: the Understanding, questions, assumptions, plan and checks">
      <span className="flex items-center gap-1.5">
        <span className="text-zinc-200 font-medium">Brief</span>
        {d.brief!.approved ? <Badge state="pass">approved</Badge> : <Badge state="pending" />}
      </span>
      {stats.map((s) => (
        <span key={s} className="text-zinc-400">
          {s}
        </span>
      ))}
      <span className="ml-auto text-zinc-400 group-hover:text-zinc-100">Open Brief →</span>
    </Link>
  );
}
