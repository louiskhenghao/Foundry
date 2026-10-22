import type { GoalState, TaskState } from '@foundry/core/browser';
import { Ban, Check, Eye, FileText, GitMerge, Hand, MessageSquare, Play, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLayout } from '../theme.ts';
import { cn } from '../ui.tsx';

/**
 * How Foundry draws progress, in every theme: done is solid ink, under way is a flowing hatch, waiting on you is signal
 * yellow, failed is red, not started is hollow. Goals move through five stages; tasks are small squares.
 */
export type Mark = 'done' | 'run' | 'you' | 'bad' | 'next' | 'off';

export const STAGES = ['Clarify', 'Brief', 'Run', 'Review', 'Deliver'] as const;
const STAGE_ICONS: LucideIcon[] = [MessageSquare, FileText, Play, Eye, GitMerge];

interface GoalLike {
  state: GoalState;
  delivery: { status: string; policy: { mode: string } };
  interview?: { status: string } | null;
  /** where a blocked goal stopped */
  stateBeforeBlock?: GoalState | null;
}

/** the stage a goal in this state stands on */
const STAGE_OF: Partial<Record<GoalState, number>> = { draft: 0, clarifying: 0, awaiting_brief_approval: 1, running: 2, awaiting_feedback: 2, goal_review: 3, done: 4, over_delivered: 4 };

/** where a goal stands on the five stages: one mark per stage */
export function stageMarks(g: GoalLike, hasTasks: boolean): Mark[] {
  const at = (i: number, m: Mark, after: Mark = 'next'): Mark[] => STAGES.map((_, j) => (j < i ? 'done' : j === i ? m : after));
  switch (g.state) {
    case 'draft':
    case 'clarifying':
      return at(0, g.interview?.status === 'awaiting_answers' ? 'you' : 'run');
    case 'awaiting_brief_approval':
      return at(1, 'you');
    case 'running':
      return at(2, 'run');
    // a milestone or the final walkthrough holds the run until you have looked
    case 'awaiting_feedback':
      return at(2, 'you');
    // an Inbox item holds the goal where it stopped
    case 'blocked':
      return at(STAGE_OF[g.stateBeforeBlock ?? 'running'] ?? 2, 'you');
    case 'goal_review':
      return at(3, 'run');
    case 'done':
    case 'over_delivered': {
      const d = g.delivery;
      if (d.status === 'delivered' || d.policy.mode === 'local') return at(5, 'done');
      return at(4, d.status === 'running' ? 'run' : d.status === 'failed' ? 'bad' : 'next');
    }
    case 'failed':
      return at(hasTasks ? 2 : 0, 'bad', 'off');
    case 'cancelled':
      return at(hasTasks ? 2 : 0, 'off', 'off');
  }
}

/** what each delivery policy does, as the Deliver stage says it */
const DELIVER_NOTE: Record<string, string> = { local: 'kept on its branch', push: 'pushed', pr: 'a pull request', 'pr-automerge': 'a pull request, auto-merged' };

interface NotedGoal extends GoalLike {
  interview?: { status: string; rounds: unknown[] } | null;
  approvedBy?: string | null;
  delivery: { status: string; policy: { mode: string }; prs: unknown[] };
}

/**
 * What each of the five stages says under its name, on the goal page and the Brief alike: how Clarify went, whether the
 * Brief is approved, how far the tasks are, the review, the delivery. `skeleton`: the planner is still writing the tasks
 * of a Brief whose skeleton is out to read.
 */
export function stageNotes(g: NotedGoal, tasks: { state: TaskState }[], marks: Mark[], skeleton = false): string[] {
  const total = tasks.length;
  const done = tasks.filter((t) => t.state === 'done').length;
  const rounds = g.interview?.rounds.length ?? 0;
  const prs = g.delivery.prs.length;
  return [
    g.state === 'clarifying' ? (skeleton ? 'planning the tasks' : g.interview?.status === 'awaiting_answers' ? 'questions for you' : 'reading the project') : rounds ? `${rounds} round${rounds === 1 ? '' : 's'} of questions` : 'no questions needed',
    g.state === 'awaiting_brief_approval' ? 'waiting for you' : skeleton ? 'skeleton ready' : marks[1] === 'done' ? (g.approvedBy ? `approved by ${g.approvedBy}` : 'approved') : 'not written yet',
    total ? `${done} of ${total} tasks` : 'no tasks yet',
    g.state === 'goal_review' ? 'reviewing the whole' : marks[3] === 'done' ? 'passed' : 'the whole goal',
    g.delivery.status === 'delivered' ? `delivered${prs ? ` · ${prs} PR${prs === 1 ? '' : 's'}` : ''}` : (DELIVER_NOTE[g.delivery.policy.mode] ?? g.delivery.policy.mode),
  ];
}

export function taskMark(state: TaskState): Mark {
  if (state === 'done') return 'done';
  if (state === 'running' || state === 'observing' || state === 'merging') return 'run';
  if (state === 'blocked') return 'you';
  if (state === 'failed') return 'bad';
  if (state === 'skipped') return 'off';
  return 'next';
}

/** a goal's task counts as marks, finished first: the squares of a list row */
export function countMarks(counts: Record<string, number>): Mark[] {
  const order: Mark[] = ['done', 'run', 'you', 'bad', 'next', 'off'];
  return Object.entries(counts)
    .flatMap(([state, n]) => Array.from({ length: n }, () => taskMark(state as TaskState)))
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** a mark's fill: the shape around it (square, segment, plate) is the caller's */
export const markFill: Record<Mark, string> = {
  done: 'bg-ink',
  run: 'hatch text-ink ring-[1.5px] ring-inset ring-ink',
  you: 'bg-you ring-[1.5px] ring-inset ring-on-you/70',
  bad: 'bg-bad',
  next: 'ring-[1.5px] ring-inset ring-line-strong',
  off: 'ring-1 ring-inset ring-line-strong opacity-50',
};

const MARK_WORD: Record<Mark, string> = { done: 'done', run: 'under way', you: 'waiting for you', bad: 'failed', next: 'not started', off: 'stopped' };

/** A goal's tasks as squares (at most `max`, then a count). */
export function TaskSquares({ marks, max = 12, className }: { marks: Mark[]; max?: number; className?: string }) {
  if (!marks.length) return null;
  const shown = marks.slice(0, max);
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-[3px]', className)} aria-hidden="true">
      {shown.map((m, i) => (
        <i key={i} className={cn('block h-3 w-3 shrink-0 rounded-[3px]', markFill[m])} />
      ))}
      {marks.length > max && <span className="mono text-[11px] text-ink-faint">+{marks.length - max}</span>}
    </span>
  );
}

/** The five stages in a row of small leaning segments: a list row's sense of where a goal is. */
export function MiniRail({ marks, className }: { marks: Mark[]; className?: string }) {
  const at = marks.findIndex((m) => m !== 'done');
  const where = at < 0 ? 'every stage done' : `${STAGES[at]}, ${MARK_WORD[marks[at]!]}`;
  return (
    <span role="img" aria-label={`Stage: ${where}`} className={cn('inline-flex gap-1 pl-0.5', className)}>
      {marks.map((m, i) => (
        <i key={i} className={cn('block h-2.5 w-5 rounded-[2px] slant', markFill[m])} />
      ))}
    </span>
  );
}

type StageLinks = ({ to: string; title: string } | null)[];

/** the word on the current stage's tag */
const tagOf = (m: Mark) => (m === 'you' ? 'You' : m === 'bad' ? 'Failed' : 'Now');

/** a stage's number disc in the steps layout: solid done, blue at work, yellow waiting for you, red failed, hollow ahead */
const STEP_DISC: Record<Mark, string> = {
  done: 'bg-ink text-on-ink',
  run: 'bg-work text-on-work',
  you: 'bg-you text-on-you',
  bad: 'bg-bad text-on-bad',
  next: 'bg-panel text-ink-faint ring-[1.5px] ring-inset ring-line-strong',
  off: 'bg-panel text-ink-faint ring-1 ring-inset ring-line-strong opacity-50',
};

/**
 * A goal's five stages (the goal page, the Brief), as the theme lays them out: large leaning plates (Wayfinding), or a
 * numbered line of steps. On a phone the plates become slim segments; either way the stage you are at says how it
 * stands in a line under them, where the notes do not fit.
 */
export function StageRail({ marks, notes, tasks, links }: { marks: Mark[]; notes: ReactNode[]; tasks: Mark[]; /** where each stage's work shows */ links?: StageLinks }) {
  const { stages } = useLayout();
  const at = marks.findIndex((m) => m !== 'done');
  const now = at >= 0 && marks[at] !== 'off' ? at : -1;
  return (
    <div>
      {stages === 'steps' ? (
        <StageSteps marks={marks} notes={notes} links={links} now={now} />
      ) : (
        <>
          <StageSegments marks={marks} links={links} now={now} />
          <StagePlates marks={marks} notes={notes} tasks={tasks} links={links} now={now} />
        </>
      )}
      {now >= 0 && (
        <p className="mt-3 flex min-w-0 items-center gap-2 text-[13px] sm:hidden">
          <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.08em] leading-none', marks[now] === 'you' ? 'bg-you text-on-you' : marks[now] === 'bad' ? 'bg-bad text-on-bad' : 'bg-ink text-on-ink')}>{tagOf(marks[now]!)}</span>
          <b className="shrink-0 font-extrabold text-ink">{STAGES[now]}</b>
          <span className="min-w-0 truncate text-ink-faint">{notes[now]}</span>
        </p>
      )}
    </div>
  );
}

/** a stage's content, a link to where its work shows when it has one */
function StageLink({ link, label, className, children }: { link?: { to: string; title: string } | null; label: string; className?: string; children: ReactNode }) {
  if (!link) return <span className={className}>{children}</span>;
  return (
    <Link to={link.to} title={link.title} aria-label={`${label}: ${link.title}`} className={cn(className, 'rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent')}>
      {children}
    </Link>
  );
}

/** the plates on a phone: a slim leaning segment per stage, its name under it */
function StageSegments({ marks, links, now }: { marks: Mark[]; links?: StageLinks; now: number }) {
  return (
    <ol aria-label="Stages" className="grid grid-cols-5 gap-1.5 sm:hidden">
      {STAGES.map((label, i) => {
        const m = marks[i]!;
        return (
          <li key={label} aria-current={i === now ? 'step' : undefined} className="min-w-0">
            <StageLink link={links?.[i]} label={label} className="flex flex-col gap-1.5">
              <i className={cn('block h-2.5 rounded-[3px] slant', markFill[m], i === now && m === 'next' && 'ring-2 ring-ink')} aria-hidden="true" />
              <span className={cn('truncate text-center text-[11px] leading-tight', i === now ? 'font-extrabold text-ink' : m === 'done' ? 'font-semibold text-ink-soft' : 'font-semibold text-ink-faint')}>{label}</span>
            </StageLink>
          </li>
        );
      })}
    </ol>
  );
}

/** the steps layout: a numbered disc per stage on a line, its name and note under it */
function StageSteps({ marks, notes, links, now }: { marks: Mark[]; notes: ReactNode[]; links?: StageLinks; now: number }) {
  return (
    <ol aria-label="Stages" className="flex items-start">
      {STAGES.map((label, i) => {
        const m = marks[i]!;
        const last = i === STAGES.length - 1;
        return (
          <li key={label} aria-current={i === now ? 'step' : undefined} className={cn('min-w-0', last ? 'shrink-0' : 'flex-1')}>
            <span className="flex items-center">
              <StageLink link={links?.[i]} label={label} className={cn('mono grid h-7 w-7 sm:h-8 sm:w-8 shrink-0 place-items-center rounded-full text-xs sm:text-[13px] font-bold', STEP_DISC[m], i === now && 'shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-ink)_14%,transparent)]')}>
                {m === 'done' ? <Check size={15} strokeWidth={3} aria-hidden="true" /> : m === 'bad' ? <X size={15} strokeWidth={3} aria-hidden="true" /> : i + 1}
              </StageLink>
              {!last && <span className={cn('mx-1.5 sm:mx-2.5 h-0.5 flex-1 rounded-full', m === 'done' ? 'bg-ink' : 'bg-line-strong')} aria-hidden="true" />}
            </span>
            <span className="mt-2 block min-w-0 pr-2">
              <b className={cn('flex items-center gap-1.5 text-[11px] sm:text-sm leading-tight', i === now ? 'font-extrabold text-ink' : m === 'done' ? 'font-semibold text-ink-soft' : 'font-semibold text-ink-faint')}>
                <span className="truncate">{label}</span>
                {i === now && (m === 'you' || m === 'bad') && <span className={cn('hidden sm:inline rounded px-1 py-px text-[10px] font-extrabold uppercase tracking-[0.08em] leading-none', m === 'you' ? 'bg-you text-on-you' : 'bg-bad text-on-bad')}>{tagOf(m)}</span>}
              </b>
              <span className="hidden sm:block truncate text-xs leading-snug text-ink-faint">{notes[i]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The five stages as large leaning plates (wide screens): done ones filled, the current one outlined heavily with its
 * note, and the Run plate carrying the tasks as a bar while it is the current one.
 */
function StagePlates({ marks, notes, tasks, links, now }: { marks: Mark[]; notes: ReactNode[]; tasks: Mark[]; links?: StageLinks; now: number }) {
  return (
    <ol aria-label="Stages" className="hidden sm:grid grid-cols-5 gap-4 px-3">
      {STAGES.map((label, i) => {
        const m = marks[i]!;
        const current = i === now;
        const Icon = m === 'done' ? Check : STAGE_ICONS[i]!;
        return (
          <li key={label} aria-current={current ? 'step' : undefined} className={cn('relative flex min-h-[4.5rem] min-w-0 items-center', m === 'done' ? 'text-on-ink' : current ? 'text-ink' : 'text-ink-faint')}>
            <span aria-hidden="true" className={cn('absolute inset-0 overflow-hidden rounded-md slant', m === 'done' ? 'bg-ink' : m === 'you' ? 'bg-you' : m === 'bad' ? 'bg-panel ring-[3px] ring-inset ring-bad' : current ? 'bg-panel ring-[3px] ring-inset ring-ink shadow-[0_16px_28px_-18px_rgb(0_0_0/0.55)]' : 'bg-panel ring-[1.5px] ring-inset ring-line-strong')}>
              {current && i === 2 && tasks.length > 0 && (
                <span className="absolute bottom-2 left-4 right-4 flex h-1.5 gap-[3px]">
                  {tasks.map((t, j) => (
                    <i key={j} className={cn('block flex-1 rounded-[2px]', markFill[t])} />
                  ))}
                </span>
              )}
            </span>
            {links?.[i] && <Link to={links[i]!.to} title={links[i]!.title} aria-label={`${label}: ${links[i]!.title}`} className="absolute inset-0 z-10 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />}
            <span className={cn('relative flex min-w-0 items-center gap-3 pb-3 pl-6 pr-3 pt-2', current && i === 2 && 'pb-5', m === 'you' && 'text-on-you')}>
              <span className={cn('hidden lg:inline-grid h-7 w-7 shrink-0 place-items-center rounded-md', m === 'done' ? 'bg-on-ink text-ink' : current && m === 'run' ? 'bg-ink text-on-ink' : 'ring-[1.5px] ring-inset ring-current')}>
                <Icon size={15} aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-col items-start">
                <b className="text-base font-extrabold leading-tight tracking-tight">{label}</b>
                <span className="truncate max-w-full text-[12.5px] leading-snug">{notes[i]}</span>
              </span>
            </span>
            {current && (
              <span className={cn('absolute -top-2.5 right-5 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.08em]', m === 'you' ? 'bg-on-you text-you' : m === 'bad' ? 'bg-bad text-on-bad' : 'bg-ink text-on-ink')}>{tagOf(m)}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** A goal's state as a plate: graphite while Foundry works, yellow while it waits for you, red when it failed. */
export function StatePlate({ state, label }: { state: GoalState; label: string }) {
  const you = state === 'awaiting_brief_approval' || state === 'awaiting_feedback' || state === 'blocked';
  const Icon = state === 'running' ? Play : state === 'goal_review' ? Eye : state === 'clarifying' || state === 'draft' ? MessageSquare : state === 'failed' ? X : state === 'cancelled' ? Ban : you ? Hand : Check;
  return (
    <span className={cn('inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] font-extrabold caps leading-none', you ? 'bg-you text-on-you' : state === 'failed' ? 'bg-bad text-on-bad' : state === 'cancelled' ? 'ring-[1.5px] ring-inset ring-line-strong text-ink-faint' : 'bg-ink text-on-ink')}>
      <Icon size={13} strokeWidth={2.5} aria-hidden="true" />
      {label}
    </span>
  );
}
