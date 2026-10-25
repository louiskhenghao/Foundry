import type { Attempt, CheckResult, Task, TaskState, VerdictScores } from '@foundry/core/browser';
import { reportsDollars } from '@foundry/core/browser';
import { Ban, Check, Clock, CornerDownRight, Eye, GitMerge, Hand, Play, RotateCcw, Square, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { type ReactNode, useEffect, useState } from 'react';
import { api, fileKey, fileUrl, type FileRef, type GoalDetail, type TaskFile, type WaitingKind } from '../../api.ts';
import { openFile } from '../../components/FilePreview.tsx';
import { type FullText, FullTextDialog, OpenFullButton } from '../../components/FullTextDialog.tsx';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { OpenMenu } from '../../components/OpenMenu.tsx';
import { taskMark } from '../../components/progress.tsx';
import { TaskTags } from '../../components/TaskTags.tsx';
import { ScoreRow } from '../../components/ScoreRow.tsx';
import { Badge, Button, ConfirmDialog, ago, chipClass, choiceClass, cn, fmtUsd, stateLabel } from '../../ui.tsx';
import { areaStyle } from '../brief/shared.ts';
import { CHECK_RESULT, CheckSquare } from './CompletionCard.tsx';
import { delegatedProgress } from './DagCanvas.tsx';
import { LiveLog, ROLE_INK } from '../LiveLog.tsx';
import { EscalationCard } from '../InboxPage.tsx';

/** a section's label in the drawer, in small capitals */
const LABEL = 'text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint';
/** a fact about the task, as a small plate under its title (the goal's head has the same) */
const FACT = 'inline-flex items-center gap-1.5 min-w-0 max-w-full rounded-md bg-panel px-2.5 py-1 text-[13px] font-semibold text-ink-soft ring-1 ring-inset ring-line';
/** the checkerboard behind a picture, so a transparent one shows its edges */
const CHECKER = 'bg-[image:repeating-conic-gradient(color-mix(in_srgb,var(--color-ink-faint)_16%,transparent)_0_25%,transparent_0_50%)] bg-[length:12px_12px]';

/**
 * A task's state as a plate in its signal colour, the way the goal page heads its goal: blue while it works, violet while
 * it is reviewed or merged, green once done, yellow while it waits for you, red when it failed, hollow before it starts.
 */
function TaskPlate({ state }: { state: TaskState }) {
  const m = taskMark(state);
  const Icon = m === 'done' ? Check : m === 'you' ? Hand : m === 'bad' ? X : m === 'off' ? Ban : m === 'next' ? Clock : state === 'observing' ? Eye : state === 'merging' ? GitMerge : Play;
  const look = m === 'done' ? 'bg-ok text-on-ok' : m === 'you' ? 'bg-you text-on-you' : m === 'bad' ? 'bg-bad text-on-bad' : m === 'next' || m === 'off' ? 'ring-[1.5px] ring-inset ring-line-strong text-ink-soft' : state === 'running' ? 'bg-work text-on-work' : 'bg-extra text-on-extra';
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-extrabold uppercase tracking-[0.08em] leading-none', look)}>
      <Icon size={12} strokeWidth={2.5} aria-hidden="true" />
      {stateLabel(state)}
    </span>
  );
}

export function TaskDrawer({ d, task, onClose, onRestart }: { d: GoalDetail; task: Task; onClose: () => void; onRestart?: () => void }) {
  const cost = (value: number) => !reportsDollars(d.goal.provider) ? 'unavailable' : fmtUsd(value);
  const attempts = d.attempts.filter((a) => a.taskId === task.id);
  const row = d.tasks.find((t) => t.id === task.id);
  const usage = row?.usage ?? null;
  // what the task's cut sessions probably cost (each at its model's measured rate); 0 when none could be estimated
  const cutEstimate = attempts.flatMap((a) => a.sessions).filter((s) => s.costAvailable === false).reduce((n, s) => n + (d.costEstimate?.bySession[s.sessionId ?? ''] ?? 0), 0);
  const [ai, setAi] = useState(attempts.length - 1);
  const [view, setView] = useState<'log' | 'report' | 'prompt'>('log');
  const [prompt, setPrompt] = useState<string | null>(null);
  const [fullText, setFullText] = useState<FullText | null>(null);
  const made = useTaskFiles(d.goal.id, task);
  const a: Attempt | undefined = attempts[Math.min(Math.max(ai, 0), attempts.length - 1)];
  const results: CheckResult[] = a ? d.checkResults.filter((r) => r.attemptId === a.id) : [];
  const checks = d.checks.filter((c) => c.taskId === task.id);
  const obs = a ? (d.events.find((e) => e.type === 'observation.reported' && (e.payload as any).report.attemptId === a.id)?.payload as any)?.report : null;
  // the task reviewer's scores on the rubric's axes (ADR-0077), and the attempt before's to show the move
  const scoresOf = (attemptId: string): VerdictScores | null => ((d.events.find((e) => e.type === 'review.task.finished' && (e.payload as any).attemptId === attemptId)?.payload as any)?.verdict?.scores as VerdictScores | undefined) ?? null;
  const scores = a ? scoresOf(a.id) : null;
  const prevScores = a ? (attempts.slice(0, Math.max(0, attempts.indexOf(a))).map((x) => scoresOf(x.id)).filter(Boolean).at(-1) ?? null) : null;
  const openEsc = d.escalations.filter((e) => e.state === 'open' && e.taskId === task.id);
  const concluded = (id: string) => (d.events.find((e) => e.type === 'attempt.concluded' && (e.payload as any).attemptId === id)?.payload as { state?: string; reason?: string } | undefined) ?? null;
  const lastState = [...d.events].reverse().find((e) => e.type === 'task.state_changed' && (e.payload as any).taskId === task.id)?.payload as { to?: string; reason?: string } | undefined;
  // a goal task: a Delegated goal does the work, so there is no session here to unstick and its attempts are its own
  const goalTask = task.kind === 'goal';
  const delegated = row?.delegated ?? null;
  // the planner touched this task up after a delegated goal landed (Replan): the person sees why
  const revised = [...d.events].reverse().find((e) => e.type === 'task.revised' && (e.payload as any).taskId === task.id)?.payload as { reason?: string } | undefined;
  // its Area's chip in the Area's colour, as the Brief shows it
  const brief = d.brief?.brief;
  const areaChip = brief && task.area ? areaStyle(brief, brief.areas.find((x) => x.name === task.area)?.key ?? null).chip : undefined;

  useEffect(() => {
    setPrompt(null);
    if (view === 'prompt' && a) api.prompt(a.id).then(setPrompt).catch(() => setPrompt(''));
  }, [view, a?.id]);
  useEffect(() => setAi(attempts.length - 1), [attempts.length]);

  const openFull = (title: string, text: string) => <OpenFullButton onClick={() => setFullText({ title, text })} />;

  return (
    // fills the full-height panel: on wide screens each column scrolls on its own, so a long file list never scrolls the attempt
    // away; narrower, the whole panel scrolls, its head with it, so the head never takes most of a phone's screen
    <section className="relative h-full flex flex-col overflow-y-auto lg:overflow-hidden rounded-lg border border-line bg-panel shadow-[var(--surface-shadow)]">
      {/* the × stays in the corner while the panel scrolls under it */}
      <div className="sticky top-0 z-10 h-0 shrink-0 flex justify-end">
        <button type="button" className="mt-3 mr-3 h-fit rounded-md bg-panel/90 p-1.5 text-ink-faint hover:text-ink hover:bg-sunken" onClick={onClose} aria-label="close">
          <X size={16} />
        </button>
      </div>
      {/* the head, as a small goal head: the state, the title in large type, its traits, then its totals as plates */}
      <header className="shrink-0 border-b border-line px-4 sm:px-6 pt-4 pb-4 pr-12 sm:pr-14">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 grow basis-[20rem]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <TaskPlate state={task.state} />
              <TaskTags kind={task.kind} scenario={task.scenario} area={task.area} areaChip={areaChip} difficulty={task.difficulty} />
              {task.origin !== 'brief' && <span className="text-[11px] font-semibold text-ink-faint">{task.origin}</span>}
            </div>
            <h2 className="mt-2.5 text-xl sm:text-2xl lg:text-[1.75rem] font-extrabold leading-tight tracking-[-0.025em] text-ink break-words">{task.title}</h2>
            {task.commitRef && (
              // one line here; the whole commit message opens in the full-text dialog
              <button
                type="button"
                className="mt-1.5 block max-w-full min-w-0 truncate text-left text-[13px] text-ink-faint hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent rounded-sm cursor-pointer disabled:cursor-default disabled:hover:text-ink-faint"
                title={task.commitMessage ? 'Show the full commit message' : undefined}
                disabled={!task.commitMessage}
                onClick={() => task.commitMessage && setFullText({ title: `Commit ${task.commitRef!.slice(0, 7)}`, text: task.commitMessage, raw: true })}
              >
                <span className="mono font-semibold text-ink-soft">{task.commitRef.slice(0, 7)}</span> {task.commitMessage?.split('\n')[0]}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 max-w-full">
            {task.state === 'blocked' && d.escalations.some((e) => e.state === 'open' && e.taskId === task.id && (e.payload as { kind?: string }).kind === 'merge') && (
              <Link to={`/goals/${d.goal.id}/resolve/${task.id}`}>
                <Button size="sm" variant="primary" title="The automatic merge attempts gave up: resolve the conflict yourself">
                  <GitMerge size={13} /> Resolve manually
                </Button>
              </Link>
            )}
            {/* on a phone it sits in the delegated goal's box below, beside what it says, not alone at the end of the header */}
            {delegated?.exists && (
              <Link to={`/goals/${delegated.goalId}`} className="hidden sm:inline-flex">
                <Button size="sm" variant="primary" title="The goal doing this task">
                  <CornerDownRight size={13} /> Open delegated goal
                </Button>
              </Link>
            )}
            {!goalTask && <UnstickButton d={d} task={task} live={row?.live} waiting={row?.waiting} waitingKind={row?.waitingKind} />}
            {onRestart && !['running', 'observing', 'merging'].includes(task.state) && (
              <Button size="sm" onClick={onRestart} title="Reset this task and everything downstream of it, then run again">
                <RotateCcw size={13} /> Restart from here
              </Button>
            )}
            {task.worktreePath && task.state !== 'done' && <OpenMenu goalId={d.goal.id} places={[{ which: `task:${task.id}`, label: 'Task worktree', path: task.worktreePath, hint: task.branch ?? undefined }]} label="Open worktree" working={['running', 'observing', 'merging'].includes(task.state)} />}
          </div>
        </div>
        {usage && usage.attempts > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2" title="everything this task has cost so far — all attempts, all their sessions">
            <span className={cn(LABEL, 'mr-0.5')}>Task total</span>
            <span className={FACT}>
              <b className="mono font-bold text-ink">{usage.attempts}</b> attempt{usage.attempts === 1 ? '' : 's'}
            </span>
            <span className={FACT}>
              <b className="mono font-bold text-ink">{cost(usage.costUsd)}</b>
              <span className="min-w-0 truncate font-medium text-ink-faint">(worker {cost(usage.byRole.worker.costUsd)} · reviewer {cost(usage.byRole.reviewer.costUsd)}{usage.byRole.merger.sessions ? ` · merger ${cost(usage.byRole.merger.costUsd)}` : ''})</span>
            </span>
            {usage.unmeasured > 0 && (
              <span className={cn(FACT, 'text-ink')} title={`${usage.unmeasured} session${usage.unmeasured === 1 ? '' : 's'} ended before the coding agent reported a cost: not in this total${cutEstimate ? `; about ${fmtUsd(cutEstimate)} estimated from their tokens at the model's measured rate` : ''}`}>
                {cutEstimate ? `+ ≈${fmtUsd(cutEstimate)} est.` : `+${usage.unmeasured} unmeasured`}
              </span>
            )}
            <span className={FACT}>
              <b className="mono font-bold text-ink">{d.goal.provider === 'codex' ? '—' : usage.turns}</b> turns
            </span>
            <span className={FACT}>
              <b className="mono font-bold text-ink">{usage.wallMin.toFixed(0)}</b> min wall
            </span>
            {usage.models.length > 0 && <span className={cn(FACT, 'mono font-medium')}>{usage.models.join(' · ')}</span>}
          </div>
        )}
      </header>
      <div className="lg:flex-1 lg:min-h-0 lg:overflow-hidden lg:flex lg:flex-col p-4 sm:p-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 lg:grid-rows-1 lg:flex-1 lg:min-h-0 gap-5 lg:gap-6">
        <div className="lg:col-span-1 lg:overflow-y-auto lg:pr-1 space-y-5">
          <MarkdownPanel title="spec" source={task.spec} maxHeight={260} actions={openFull(`Spec · ${task.title}`, task.spec)} />
          {revised && <div className="text-xs text-work-ink" title="A delegated goal landed before this task started; the planner read what it delivered and touched the spec up">Touched up after a step landed: {revised.reason}</div>}
          {task.summary && <MarkdownPanel title="what it delivered" source={task.summary} maxHeight={260} actions={openFull(`What it delivered · ${task.title}`, task.summary)} />}
          {task.hint && <MarkdownPanel title="human hint" source={task.hint} local maxHeight={160} actions={openFull(`Human hint · ${task.title}`, task.hint)} />}
          {scores && (
            <section>
              <h3 className={cn(LABEL, 'mb-2')}>Review scores</h3>
              <ScoreRow scores={scores} prev={prevScores} />
            </section>
          )}
          <section>
            <h3 className={cn(LABEL, 'mb-2')}>Checks</h3>
            {checks.length === 0 && <div className="text-xs text-ink-faint">none (goal-level only)</div>}
            {checks.map((c) => {
              const r = results.find((x) => x.checkId === c.id);
              const res = CHECK_RESULT[r?.status ?? 'none'];
              return (
                <div key={c.id} className="text-xs flex items-center gap-2 py-1">
                  <CheckSquare mark={res.mark} />
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink" title={c.spec.type === 'command' ? c.spec.cmd : c.name}>
                    {c.name}
                  </span>
                  <span className="shrink-0 text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint" title={c.tier}>{c.tier}</span>
                  <span className={cn('mono text-[11px] shrink-0 w-[3.25rem] text-right', res.mark === 'bad' ? 'font-bold text-bad-ink' : res.mark === 'done' ? 'font-semibold text-ok-ink' : 'text-ink-faint')}>{res.word}</span>
                </div>
              );
            })}
          </section>
          {task.relevantFiles.length > 0 && (
            <section>
              <h3 className={cn(LABEL, 'mb-2')}>Relevant files</h3>
              <div className="mono text-[11.5px] text-ink-soft space-y-1">
                {task.relevantFiles.map((f, _, all) => {
                  // openable when the task's commit or one of the goal's folders has it; a file the plan only meant to create does not exist
                  const open = made?.relevant.find((r) => r.rel === f)?.open;
                  // the preview steps through the openable ones in this order
                  const openable = all.flatMap((x) => made?.relevant.find((r) => r.rel === x)?.open ?? []);
                  return open ? (
                    <button key={f} type="button" onClick={() => openFile(open, openable)} className="block w-full truncate text-left font-semibold text-work-ink hover:underline" title={`Open ${f}`}>
                      {f}
                    </button>
                  ) : (
                    <div key={f} className="truncate text-ink-faint" title={made ? "Not in this task's commit or in any folder of the goal" : undefined}>
                      {f}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {(task.delivers ?? []).length > 0 && (
            <section>
              <h3 className={cn(LABEL, 'mb-2')} title="The files this task promised to the tasks after it; each is a must check when it lands">Deliverables</h3>
              <div className="mono text-[11.5px] text-ink-soft space-y-1">
                {(task.delivers ?? []).map((f, _, all) => {
                  const open = made?.delivers?.find((r) => r.rel === f)?.open;
                  const openable = all.flatMap((x) => made?.delivers?.find((r) => r.rel === x)?.open ?? []);
                  return open ? (
                    <button key={f} type="button" onClick={() => openFile(open, openable)} className="block w-full truncate text-left font-semibold text-work-ink hover:underline" title={`Open ${f}`}>
                      {f}
                    </button>
                  ) : (
                    <div key={f} className="truncate text-ink-faint" title={made ? 'Not there yet' : undefined}>
                      {f}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {made && <TaskFiles task={task} files={made.files} />}
          <FigureShots d={d} task={task} />
        </div>
        <div className="lg:col-span-2 min-w-0 lg:overflow-y-auto lg:pr-1">
          {openEsc.length > 0 && (
            // a heading in capitals, as the Goals page's boards have: each card under it carries its own yellow head
            <section aria-labelledby="task-needs-you" className="mb-5 space-y-3">
              <h3 id="task-needs-you" className="flex items-center gap-2 text-[12.5px] font-extrabold caps text-ink">
                <Hand size={14} aria-hidden="true" />
                This task is waiting for you
                <b className="mono grid h-5 min-w-5 place-items-center rounded-[5px] bg-you px-1.5 text-xs tracking-normal text-on-you">{openEsc.length}</b>
              </h3>
              {openEsc.map((e) => (
                <EscalationCard key={e.id} e={e} embedded />
              ))}
            </section>
          )}
          {openEsc.length === 0 && task.state === 'blocked' && lastState?.reason && <div className="mb-3 text-xs font-semibold text-you-ink">blocked: {lastState.reason}</div>}
          {!openEsc.length && task.state !== 'done' && lastState?.reason && task.state !== 'blocked' && <div className="mb-2 text-xs text-ink-faint">last transition: {lastState.to} — {lastState.reason}</div>}
          {task.state === 'ready' && row?.waiting && <div className="mb-2 text-xs text-ink-faint">not started yet: {row.waiting}</div>}
          {goalTask && (
            // in the colour of its kind's chip (a step done by a goal of its own)
            <div className="mb-4 rounded-lg border border-code-7/35 bg-code-7/5 px-3.5 py-2.5 text-[13px] text-ink-soft space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-code-7-ink">Done by a delegated goal</span>
                {delegated?.exists && <Badge state={delegated.state ?? 'pending'} />}
                {delegated?.exists && <span className="text-ink-soft">{delegatedProgress(delegated.taskCounts)}</span>}
              </div>
              {delegated ? (
                delegated.exists ? (
                  <div className="text-ink-soft">
                    {delegated.needsYou ? <span className="font-bold text-you-ink">It {delegated.needsYou}. </span> : task.state === 'done' ? "Its result landed on this goal's branch as this task's commit. " : 'This task finishes when that goal does: its branch then lands here as one commit, its files under artifacts/ with it. '}
                    <Link to={`/goals/${delegated.goalId}`} className="hidden sm:inline font-semibold text-work-ink hover:underline">Open it</Link>
                    <span className="hidden sm:inline">.</span>
                    <Link to={`/goals/${delegated.goalId}`} className="sm:hidden mt-2 flex">
                      <Button size="sm" variant="primary" className="w-full justify-center">
                        <CornerDownRight size={13} /> Open delegated goal
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <div className="text-ink-faint">That goal was deleted. Retry starts a new one; skip moves on without this step.</div>
                )
              ) : (
                <div className="text-ink-faint">Its goal starts when this task does; delegated goals run side by side, as many as the goal's parallel limit allows.</div>
              )}
            </div>
          )}
          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
            {/* the attempts as small cards: the one shown outlined in the accent */}
            {attempts.map((x, i) => (
              <button key={x.id} onClick={() => setAi(i)} className={cn('text-xs rounded-md border px-2 py-1 flex items-center gap-1.5 font-semibold text-ink', choiceClass(i === Math.min(Math.max(ai, 0), attempts.length - 1)))}>
                <span className="mono">#{x.index}</span> {x.kind === 'merge' ? 'merge' : ''} <Badge state={x.state} />
                {x.continuations > 0 && <span className="mono text-[11px] text-ink-faint" title={`${x.continuations} continuation(s): the same session was resumed instead of a fresh attempt`}>↻{x.continuations}</span>}
                <span className="text-ink-faint mono font-normal">{cost(x.costUsd)}</span>
              </button>
            ))}
            {attempts.length === 0 && <span className="text-xs text-ink-faint">{goalTask ? 'no attempts here: the delegated goal has its own' : 'no attempts yet'}</span>}
          </div>
          {a && (
            <>
              <AttemptStats a={a} d={d} concluded={concluded(a.id)} />
              <div className="flex gap-1.5 mb-2.5">
                {(['log', 'report', 'prompt'] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} className={chipClass(view === v)}>
                    {v === 'log' ? 'Live log' : v === 'report' ? 'Observation' : 'Prompt'}
                  </button>
                ))}
              </div>
              {view === 'log' &&
                (d.goal.transfer && !d.goal.transfer.transcripts && a.startedAt <= d.goal.transfer.from.exportedAt ? (
                  <div className="text-xs text-ink-faint">This log stayed on the computer the goal came from.</div>
                ) : (
                  <LiveLog attemptId={a.id} />
                ))}
              {view === 'report' && (obs ? <MarkdownPanel title="observation report" source={obs.summary} maxHeight={420} /> : <div className="text-xs text-ink-faint">no observation yet</div>)}
              {view === 'prompt' && (prompt === null ? <div className="text-xs text-ink-faint">loading…</div> : <MarkdownPanel title="prompt sent to the worker" source={prompt || '_not recorded for this attempt_'} maxHeight={420} />)}
              {results
                .filter((r) => r.status !== 'pass')
                .map((r) => (
                  <details key={r.id} className="mt-2">
                    <summary className="py-1.5 sm:py-0 text-xs font-semibold text-bad-ink cursor-pointer">✗ {d.checks.find((c) => c.id === r.checkId)?.name}</summary>
                    <pre className="mono text-xs whitespace-pre-wrap text-ink-soft bg-sunken border border-line rounded-md p-2.5 mt-1.5 max-h-64 overflow-auto">{r.summary}</pre>
                  </details>
                ))}
            </>
          )}
        </div>
      </div>
      </div>
      <FullTextDialog value={fullText} onClose={() => setFullText(null)} />
    </section>
  );
}

const fmtDur = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

/** Labelled facts about one attempt, then every session that ran for it (worker segments, reviewer, merger). */
function AttemptStats({ a, d, concluded }: { a: Attempt; d: GoalDetail; concluded: { state?: string; reason?: string } | null }) {
  const cost = (value: number) => !reportsDollars(d.goal.provider) ? 'unavailable' : fmtUsd(value);
  const reviewerCost = a.sessions.filter((s) => s.role === 'reviewer').reduce((n, s) => n + s.costUsd, 0);
  // sessions cut before the coding agent reported a cost: their dollars are unknown, so the sums above leave them out
  const unmeasured = a.sessions.filter((s) => s.costAvailable === false).length;
  const estimateOf = (sessionId: string | null) => d.costEstimate?.bySession[sessionId ?? ''] ?? null;
  const cutEstimate = a.sessions.filter((s) => s.costAvailable === false).reduce((n, s) => n + (estimateOf(s.sessionId) ?? 0), 0);
  const unmeasuredNote = `${unmeasured} session${unmeasured === 1 ? '' : 's'} ended before the coding agent reported a cost${cutEstimate ? `: about ${fmtUsd(cutEstimate)}, estimated from the tokens at the model's measured rate` : ': unknown, not $0'}`;
  const workerModels = [...new Set(a.sessions.filter((s) => s.role === 'worker').map((s) => s.model).filter(Boolean))] as string[];
  const fallbacks = d.events.filter((e) => e.type === 'goal.models_changed').map((e) => e.payload as { from: string; to: string });
  const running = !a.endedAt;
  const cell = (label: string, value: ReactNode, title?: string) => (
    <div className="min-w-0" title={title}>
      <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint">{label}</div>
      <div className="mt-1 text-[13px] font-semibold text-ink truncate">{value}</div>
    </div>
  );
  return (
    <div className="mb-4 space-y-2.5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 rounded-lg border border-line bg-sunken p-3">
        {cell('Result', <span className="flex items-center gap-1.5"><Badge state={running ? 'running' : a.state} />{a.resultSubtype && !running ? <span className="mono font-normal text-ink-faint">{a.resultSubtype}</span> : null}</span>)}
        {cell('Worker model', <span className="mono">{(workerModels.length ? workerModels : [a.model ?? '?']).join(' → ')}</span>, fallbacks.length ? `model fallback(s) on this goal: ${fallbacks.map((f) => `${f.from} → ${f.to}`).join(', ')}` : undefined)}
        {cell('Turns', d.goal.provider === 'codex' ? 'unavailable' : <><span className="mono">{a.numTurns}</span>{a.continuations > 0 ? ` over ${a.continuations + 1} segments` : ''}</>)}
        {cell('Cost', <><span className="mono">{cost(a.costUsd)}</span> <span className="font-normal text-ink-faint">worker</span>{reviewerCost > 0 ? <> + <span className="mono">{cost(reviewerCost)}</span> <span className="font-normal text-ink-faint">reviewer</span></> : null}{unmeasured > 0 ? <> + <span className="font-bold">{cutEstimate ? `≈${fmtUsd(cutEstimate)} est.` : 'unknown'}</span></> : null}</>, unmeasured > 0 ? unmeasuredNote : undefined)}
        {cell('Started', <span className="mono">{ago(a.startedAt)}</span>)}
        {cell('Duration', a.endedAt ? <span className="mono">{fmtDur(Date.parse(a.endedAt) - Date.parse(a.startedAt))}</span> : 'running…')}
        {cell('Session', a.sessionId ? <span className="mono">{a.sessionId.slice(0, 8)}</span> : '—', a.sessionId ?? undefined)}
        {cell('Skills', d.goal.provider !== 'claude' && d.goal.provider != null ? 'not observable' : a.skillsUsed.length ? a.skillsUsed.join(', ') : '—', 'skills invoked with the Skill tool')}
      </div>
      {!running && concluded?.reason && <div className={cn('text-xs font-semibold', concluded.state === 'passed' ? 'text-ok-ink' : concluded.state === 'failed' || concluded.state === 'error' ? 'text-bad-ink' : 'text-ink-soft')}>→ {concluded.reason}</div>}
      {a.sessions.length > 0 && (
        // a row a line: on a phone the table slides sideways in its box rather than folding every cell
        <div className="overflow-x-auto">
          <table className="text-[11.5px] w-full whitespace-nowrap">
            <thead className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint">
              <tr className="text-left">
                <th className="pr-3 pb-1 font-extrabold">session</th>
                <th className="pr-3 pb-1 font-extrabold">model</th>
                <th className="pr-3 pb-1 font-extrabold text-right">turns</th>
                <th className="pr-3 pb-1 font-extrabold text-right">cost</th>
                <th className="pr-3 pb-1 font-extrabold text-right">time</th>
                <th className="pb-1 font-extrabold">ended</th>
              </tr>
            </thead>
            <tbody className="text-ink-soft">
              {a.sessions.map((s, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="pr-3 py-1">
                    <span className={cn('font-semibold', ROLE_INK[s.role] ?? 'text-ink-soft')}>{s.role}</span>
                    {s.role === 'worker' && s.segment > 0 && <span className="text-ink-faint"> · continuation {s.segment}</span>}
                  </td>
                  <td className="pr-3 mono">{s.model ?? '—'}</td>
                  <td className="pr-3 text-right mono">{d.goal.provider === 'codex' ? '—' : s.numTurns}</td>
                  <td className="pr-3 text-right mono">{s.costAvailable === false ? (estimateOf(s.sessionId) != null ? <span className="font-bold text-ink" title="ended before the coding agent reported a cost: estimated from its tokens at the rate the same model cost in sessions that reported it">≈{fmtUsd(estimateOf(s.sessionId)!)}</span> : <span className="font-sans font-bold text-ink" title="ended before the coding agent reported a cost: unknown, not $0 (its model has no session with a reported cost yet)">unknown</span>) : cost(s.costUsd)}</td>
                  <td className="pr-3 text-right mono">{fmtDur(s.durationMs)}</td>
                  <td className="mono text-ink-faint">{s.subtype === 'success' ? 'ok' : (s.subtype ?? '—')}{s.subtype === 'error_max_turns' || s.subtype === 'error_max_budget_usd' ? ' → continued' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** What the task made and which of its relevant files open, reloaded as the task moves on. */
function useTaskFiles(goalId: string, task: Task) {
  const [made, setMade] = useState<{ files: TaskFile[]; relevant: { rel: string; open: FileRef | null }[]; delivers?: { rel: string; open: FileRef | null }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .taskFiles(goalId, task.id)
      .then((r) => alive && setMade(r))
      .catch(() => alive && setMade({ files: [], relevant: [] }));
    return () => {
      alive = false;
    };
  }, [goalId, task.id, task.state, task.commitRef]);
  return made;
}

/** a figure task's pages as Foundry opened them headless (ADR-0076): the newest check's shots, the see-through beside the closed object */
function FigureShots({ d, task }: { d: GoalDetail; task: Task }) {
  const last = [...d.events].reverse().find((e) => e.type === 'figure.checked' && (e.payload as { taskId: string }).taskId === task.id);
  if (!last) return null;
  const p = last.payload as { status: string; pages: { file: string; screenshot: string | null; inside: string | null; errors: string[] }[] };
  const shots = p.pages.flatMap((pg) => [...(pg.screenshot ? [{ file: pg.screenshot, caption: pg.file }] : []), ...(pg.inside ? [{ file: pg.inside, caption: `${pg.file} · see-through` }] : [])]);
  if (!shots.length) return null;
  return (
    <section>
      <h3 className={cn(LABEL, 'mb-2')}>Figure pages as Foundry opened them{p.status === 'pass' ? '' : ' · errors'}</h3>
      <div className="grid grid-cols-2 gap-1.5">
        {shots.map((s) => (
          <a key={s.file} href={api.screenshotUrl(d.goal.id, s.file)} target="_blank" rel="noreferrer" title={s.caption} className="block overflow-hidden rounded-md border border-line hover:border-line-strong">
            <img src={api.screenshotUrl(d.goal.id, s.file)} alt={s.caption} loading="lazy" className="w-full object-cover" />
            <div className="truncate px-1.5 py-1 text-[11px] text-ink-soft">{s.caption}</div>
          </a>
        ))}
      </div>
    </section>
  );
}

/**
 * What the task added or changed, shown here so nobody needs an editor on the host (a phone, a Tailscale visitor):
 * images as thumbnails, everything else as a list; each opens in the file preview. A finished task's files are read
 * from its commit, so they stay after delivery removed its folders.
 */
function TaskFiles({ task, files }: { task: Task; files: TaskFile[] }) {
  if (!files.length) return null;
  const images = files.filter((f) => f.kind === 'image');
  const others = files.filter((f) => f.kind !== 'image');
  // the preview steps through the files in the order shown: the pictures, then the rest
  const order = [...images, ...others].map((f) => f.open);
  return (
    <section>
      <h3 className={cn(LABEL, 'mb-2')}>
        Files{task.commitRef ? '' : ' so far'} ({files.length})
      </h3>
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {images.map((f) => (
            <button key={fileKey(f.open)} type="button" onClick={() => openFile(f.open, order)} title={f.rel} className={cn('aspect-square overflow-hidden rounded-md border border-line hover:border-line-strong', CHECKER)}>
              <img src={fileUrl(f.open)} alt={f.rel} loading="lazy" className="h-full w-full object-contain" />
            </button>
          ))}
        </div>
      )}
      <div className="mono text-[11.5px] space-y-1">
        {others.map((f) => (
          <button key={fileKey(f.open)} type="button" onClick={() => openFile(f.open, order)} title={`Open ${f.rel}`} className="block w-full truncate text-left font-semibold text-work-ink hover:underline">
            {f.rel}
          </button>
        ))}
      </div>
    </section>
  );
}

/** how long a running task may sit without a live session before the drawer offers to stop it (checks run between sessions) */
const QUIET_MS = 3 * 60_000;

/** what starting past the scheduler's caution costs, said before the person confirms */
const FORCE_NOTE: Record<Exclude<WaitingKind, 'hard'>, string> = {
  capacity: 'Starting it now runs one more session than the goal allows at once, so it spends usage faster; it works in its own worktree.',
  serial: 'The Brief marked it to run alone. Starting it now runs it beside the work in flight, in its own worktree; their changes may conflict when they merge.',
  overlap: 'Both tasks change the same files. Starting it now runs it in its own worktree beside the other; their changes may conflict when they merge.',
};

/**
 * The way out of a stuck task without restarting Foundry. "Start now" shows on a ready task that nothing holds back, or
 * only the scheduler's caution does (then it asks first, saying what that costs); "Stop and retry" on a running task that has had no live session for a few minutes.
 */
function UnstickButton({ d, task, live, waiting, waitingKind }: { d: GoalDetail; task: Task; live?: { inFlight: boolean; session: boolean; since: string | null }; waiting?: string | null; waitingKind?: WaitingKind | null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!live || d.goal.state !== 'running') return null;
  const working = ['running', 'observing', 'merging'].includes(task.state);
  // ready with its dependencies done: nothing holds it back, or only the scheduler's caution, which the person may override
  const forcing = task.state === 'ready' && !!waiting && !!waitingKind && waitingKind !== 'hard';
  const startable = (task.state === 'ready' && waiting === null) || forcing;
  const quietSince = Date.parse(task.updatedAt);
  const stoppable = working && !live.session && (!live.inFlight || now - quietSince > QUIET_MS);
  if (!startable && !stoppable) return null;
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.unstickTask(d.goal.id, task.id, forcing);
      setAsking(false);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {forcing ? (
        <ConfirmDialog open={asking} busy={busy} title={`Start "${task.title}" now?`} confirmLabel="Start now" onConfirm={go} onClose={() => setAsking(false)}>
          <p>It has not started because {waiting}.</p>
          <p>{FORCE_NOTE[waitingKind as Exclude<WaitingKind, 'hard'>]}</p>
          {err && <p className="text-bad-ink">{err}</p>}
        </ConfirmDialog>
      ) : (
        <ConfirmDialog open={asking} danger busy={busy} title={`Stop and retry "${task.title}"?`} confirmLabel="Stop and retry" onConfirm={go} onClose={() => setAsking(false)}>
          <p>It has had no live session for a while. What it is doing stops and it goes back to ready; a session that had started resumes where it left off.</p>
          {err && <p className="text-bad-ink">{err}</p>}
        </ConfirmDialog>
      )}
      <Button size="sm" variant={startable ? 'primary' : undefined} disabled={busy} onClick={() => (stoppable || forcing ? setAsking(true) : void go())} title={forcing ? 'Its dependencies are done; only the scheduler holds it back: start it anyway' : startable ? 'Ready and nothing holds it back, but it has not started: start it now' : 'No live session for a while: stop the stuck work and put the task back to ready'}>
        {startable ? <Play size={13} /> : <Square size={13} />} {startable ? 'Start now' : 'Stop and retry'}
      </Button>
      {err && <span className="text-[11px] text-bad-ink max-w-64 truncate" title={err}>{err}</span>}
    </>
  );
}
