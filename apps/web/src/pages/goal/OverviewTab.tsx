import type { CheckResult } from '@foundry/core/browser';
import { reportsDollars } from '@foundry/core/browser';
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
import { CheckDialog } from './CheckDialog.tsx';
import { CHECK_RESULT, CheckSquare, CompletionCard } from './CompletionCard.tsx';
import { MilestonesCard } from './MilestoneEvidence.tsx';
import { ProjectSkillsCard } from './ProjectSkillsCard.tsx';

/** a label inside a card, in small capitals */
const LABEL = 'text-[11px] font-extrabold uppercase tracking-[0.1em]';

export function OverviewTab({ d }: { d: GoalDetail }) {
  const g = d.goal;
  // paused at a milestone, the Have a look card above the tabs is that milestone: it is not repeated here
  const open = d.escalations.filter((e) => e.state === 'open' && !(g.state === 'awaiting_feedback' && e.trigger === 'milestone'));
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
  const [openCheck, setOpenCheck] = useState<string | null>(null);
  const shownCheck = d.checks.find((c) => c.id === openCheck);

  return (
    <div className="space-y-4">
      <BriefStrip d={d} />

      {open.length > 0 && (
        <div className="space-y-2">
          {/* with the goal's and the task's titles, as the Inbox has them: the card names where it belongs */}
          {open.map((e) => (
            <EscalationCard key={e.id} e={{ ...e, goalTitle: g.title, taskTitle: d.tasks.find((t) => t.id === e.taskId)?.title ?? null }} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <MarkdownPanel title="goal" source={g.prompt} maxHeight={240} actions={<OpenFull value={{ title: g.title, text: g.prompt }} />} />
          {/* the verdict on the goal, next to the goal itself */}
          {review && <GoalReview review={review} />}
          {/* right under the goal, as on the New goal form: the description and what came with it */}
          <Card title={`Attachments${g.attachments.length ? ` (${g.attachments.length})` : ''}`}>
            <AttachmentInput items={g.attachments} goalId={g.id} onChange={() => {}} />
            <p className="text-[11px] text-ink-faint mt-2">Attachments are handed to every new session of this goal (Clarify, workers, goal review) as read-only references.</p>
          </Card>
          <CodexModelsCard goal={g} />
          {!['draft', 'clarifying', 'awaiting_brief_approval'].includes(g.state) && <PreviewCard goalId={g.id} goal={g} />}
          {!['draft', 'clarifying', 'awaiting_brief_approval'].includes(g.state) && <MilestonesCard d={d} />}
          {d.events.some((e) => e.type === 'goal.models_changed') && (
            <Card title="Model fallback">
              <div className="text-xs text-ink-soft space-y-1">
                {d.events
                  .filter((e) => e.type === 'goal.models_changed')
                  .map((e, i) => {
                    const p = e.payload as any;
                    return (
                      <div key={i}>
                        <span className="mono text-ink">{p.from}</span> was unavailable → {p.tier ? `${p.tier} sessions now use ` : 'this goal now uses '}
                        <span className="mono text-ink">{p.to}</span> <span className="text-ink-faint">({p.reason})</span>
                      </div>
                    );
                  })}
                <div className="text-[11px] text-ink-faint">
                  {g.provider === 'agy' ? 'Model' : 'Preset'}: <span className="mono">{g.provider === 'codex' ? g.codexPreset?.label ?? 'Legacy single model' : g.provider === 'agy' ? `${g.models.worker} (every role)` : g.modelPreset ?? 'Settings default for this goal type'}</span>
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
        </div>
        <div className="space-y-4">
          <Card title="Acceptance">
            {/* a checklist: per tier its count, then each check's square, its name and how it stands */}
            {[
              ['must', must],
              ['stretch', stretch],
            ].map(([tier, list]) => (
              <section key={tier as string} className="mb-5">
                <div className="flex items-baseline gap-2 mb-2">
                  <h4 className={cn(LABEL, 'text-ink')}>{tier as string}</h4>
                  <span className="ml-auto text-[11px] text-ink-faint">
                    <span className="mono font-bold text-ink-soft">{(list as typeof must).filter((c) => latestResult(c.id)?.status === 'pass').length}/{(list as typeof must).length}</span> passing
                  </span>
                </div>
                {(list as typeof must).length === 0 && <div className="text-xs text-ink-faint">none</div>}
                {(list as typeof must).map((c) => {
                  const r = latestResult(c.id);
                  const res = CHECK_RESULT[r?.status ?? 'none'];
                  return (
                    <button key={c.id} type="button" onClick={() => setOpenCheck(c.id)} className="-mx-1.5 w-[calc(100%+0.75rem)] flex items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left text-[13px] transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-accent" title="Show what it checks, its output and every run">
                      <CheckSquare mark={res.mark} />
                      <span className="min-w-0 flex-1 truncate font-semibold text-ink" title={c.name}>
                        {c.name}
                      </span>
                      <span className="text-[11px] text-ink-faint truncate max-w-[80px]">{taskName(c.taskId)}</span>
                      <span className={cn('mono text-[11px] shrink-0 w-[3.25rem] text-right', res.mark === 'bad' ? 'font-bold text-bad-ink' : 'text-ink-faint')}>{res.word}</span>
                    </button>
                  );
                })}
              </section>
            ))}
            {shownCheck && <CheckDialog goalId={g.id} check={shownCheck} results={d.checkResults} taskName={taskName(shownCheck.taskId)} initial={latestResult(shownCheck.id)} onClose={() => setOpenCheck(null)} />}
            {!['draft', 'clarifying', 'awaiting_brief_approval'].includes(g.state) && <SelfCheckSection d={d} />}
            {!['draft', 'clarifying', 'awaiting_brief_approval'].includes(g.state) && d.tasks.some((t) => t.milestone) && <MilestonePauseSection d={d} />}
            {!['draft', 'clarifying', 'awaiting_brief_approval'].includes(g.state) && <PonytailSection d={d} />}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Ponytail, the lazy senior dev: switchable while the goal runs, from its next session */
function PonytailSection({ d }: { d: GoalDetail }) {
  const g = d.goal;
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="border-t border-line pt-3 mt-3 space-y-1.5">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={(g.workflow.ponytail ?? 'on') === 'on'} onChange={(e) => api.setPonytail(g.id, e.target.checked).catch((x) => setErr(x.body?.error ?? x.message))} />
        <span className="text-[13px] font-semibold text-ink">Ponytail: the smallest change that fully solves the task</span>
      </label>
      <p className="text-[11px] text-ink-faint">On: workers reuse what exists before writing new code and ponytail-review reviews; TDD still decides how tests are written. Applies from the next session.</p>
      {err && <div className="text-[11px] text-bad-ink">{err}</div>}
    </div>
  );
}

/** "Have a look": whether the goal pauses at its milestones; switchable while it runs, from its next milestone */
function MilestonePauseSection({ d }: { d: GoalDetail }) {
  const g = d.goal;
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="border-t border-line pt-3 mt-3 space-y-1.5">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={g.milestonePause ?? true} onChange={(e) => api.setMilestonePause(g.id, e.target.checked).catch((x) => setErr(x.body?.error ?? x.message))} />
        <span className="text-[13px] font-semibold text-ink">Have a look: pause at milestones</span>
      </label>
      <p className="text-[11px] text-ink-faint">On: the goal pauses for the final walkthrough, and when a milestone without a script lands. Off: it goes on, and what each milestone shows is sent to your notification channels. Applies from the next milestone.</p>
      {err && <div className="text-[11px] text-bad-ink">{err}</div>}
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
    <div className="border-t border-line pt-3 space-y-1.5">
      <label className="flex items-center gap-2 cursor-pointer" title="Needs Playwright's Chromium (Settings → Preview & self-check)">
        <input type="checkbox" checked={g.selfCheck} onChange={(e) => toggle(e.target.checked)} />
        <span className="text-[13px] font-semibold text-ink">Self-check after each task</span>
      </label>
      <p className="text-[11px] text-ink-faint">A smoke test after each task lands: opens the preview's first page in a headless browser, takes a screenshot, and fails on console, page or network errors, which then get fixed. No AI, so no tokens; it costs the seconds the preview takes to start. Unlike Have a look, it never shows you anything or pauses.</p>
      {last ? (
        <div className="flex items-start gap-2 text-xs">
          <Badge state={last.status} />
          <span className="min-w-0 text-ink-soft">
            {last.errors.length ? `${last.errors.length} error${last.errors.length === 1 ? '' : 's'}` : 'no errors'}
            {task && <span className="text-ink-faint"> · after {task}</span>}
            {last.screenshot && (
              <>
                {' · '}
                <a href={api.screenshotUrl(g.id, last.screenshot)} target="_blank" rel="noreferrer" className="font-semibold text-work-ink hover:underline">
                  screenshot
                </a>
              </>
            )}
          </span>
        </div>
      ) : (
        g.selfCheck && <div className="text-[11px] text-ink-faint">No run yet.</div>
      )}
      {last && last.errors.length > 0 && (
        <ul className="mono text-[11px] text-bad-ink space-y-0.5 max-h-24 overflow-auto">
          {last.errors.slice(0, 5).map((e, i) => (
            <li key={i} className="break-words">{e}</li>
          ))}
        </ul>
      )}
      {err && <div className="text-[11px] text-bad-ink">{err}</div>}
    </div>
  );
}

/**
 * The approved Brief in one line under the timeline: its state and size, with a link to the Brief page, which holds
 * the Understanding and everything else the Clarifier wrote. A quiet panel: the stages above already say where the goal is.
 */
export function BriefStrip({ d }: { d: GoalDetail }) {
  const g = d.goal;
  const b = d.brief?.brief;
  if (!b) return null;
  const stats = [
    `${b.tasks.length} task${b.tasks.length === 1 ? '' : 's'}`,
    b.assumptions.length ? `${b.assumptions.filter((a) => a.accepted).length}/${b.assumptions.length} assumptions accepted` : null,
    b.questions.length ? `${b.questions.filter((q) => q.answer).length}/${b.questions.length} questions answered` : null,
    `est. ${reportsDollars(g.provider) ? `$${b.costEstimateUsd} / ` : ''}${b.timeEstimateMin} min`,
  ].filter(Boolean);
  return (
    <Link to={`/goals/${g.id}/brief`} className="group flex items-center gap-x-4 gap-y-1 flex-wrap rounded-lg border border-line bg-panel px-4 py-2.5 text-[13px] shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-colors hover:border-line-strong" title="Open the Brief: the Understanding, questions, assumptions, plan and checks">
      <span className="flex items-center gap-2">
        <span className={cn(LABEL, 'text-ink')}>Brief</span>
        {d.brief!.approved ? <Badge state="pass">approved</Badge> : <Badge state="pending" />}
      </span>
      {stats.map((s) => (
        <span key={s} className="text-ink-soft">
          {s}
        </span>
      ))}
      <span className="ml-auto font-semibold text-ink-soft group-hover:text-ink group-hover:underline underline-offset-[3px]">Open Brief →</span>
    </Link>
  );
}

/** the goal review's verdict in one line, on a quiet panel (tinted red only when it failed); the reviewer's notes fold out */
export function GoalReview({ review }: { review: { passed: boolean; overDelivered: boolean; notes: string } }) {
  const [open, setOpen] = useState(false);
  const verdict = review.passed ? (review.overDelivered ? 'over-delivered' : 'passed') : 'failed';
  return (
    <div className={cn('rounded-lg border px-4 py-2.5 text-[13px] shadow-[0_1px_2px_rgb(0_0_0/0.05)]', review.passed ? 'border-line bg-panel' : 'border-bad/40 bg-bad/5')}>
      <button type="button" className="w-full flex items-center gap-2.5 text-left" disabled={!review.notes} onClick={() => setOpen((o) => !o)} aria-expanded={review.notes ? open : undefined}>
        <CheckSquare mark={review.passed ? 'done' : 'bad'} />
        <span className={cn(LABEL, 'text-ink shrink-0')}>Goal review</span>
        <span className={cn('font-bold shrink-0', review.passed ? 'text-ok-ink' : 'text-bad-ink')}>{verdict}</span>
        {review.notes && <span className="min-w-0 flex-1 truncate text-ink-faint">{open ? '' : review.notes.split('\n')[0]}</span>}
        {review.notes && <span className="ml-auto shrink-0 text-[11px] font-semibold text-ink-faint">{open ? 'hide notes' : 'reviewer notes'}</span>}
      </button>
      {open && <div className="mt-2"><MarkdownPanel title="reviewer notes" source={review.notes} maxHeight={240} actions={<OpenFull value={{ title: `Goal review · ${verdict}`, text: review.notes }} />} /></div>}
    </div>
  );
}
