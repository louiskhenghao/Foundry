import type { GoalState, TaskState } from '@foundry/core/browser';
import { Ban, Check, Eye, FileText, GitMerge, Hand, MessageSquare, Play, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
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

/**
 * The five stages as large leaning plates (the goal page): done ones filled, the current one outlined heavily with its
 * note, and the Run plate carrying the tasks as a bar while it is the current one.
 */
export function StageRail({ marks, notes, tasks, links }: { marks: Mark[]; notes: ReactNode[]; tasks: Mark[]; /** where each stage's work shows */ links?: ({ to: string; title: string } | null)[] }) {
  const now = marks.findIndex((m) => m !== 'done');
  return (
    <ol aria-label="Stages" className="grid grid-cols-5 gap-2 sm:gap-4 px-1.5 sm:px-3">
      {STAGES.map((label, i) => {
        const m = marks[i]!;
        const current = i === now && m !== 'off';
        const Icon = m === 'done' ? Check : STAGE_ICONS[i]!;
        return (
          <li key={label} aria-current={current ? 'step' : undefined} className={cn('relative flex min-h-12 sm:min-h-[4.5rem] min-w-0 items-center', m === 'done' ? 'text-on-ink' : current ? 'text-ink' : 'text-ink-faint')}>
            <span aria-hidden="true" className={cn('absolute inset-0 overflow-hidden rounded-md slant', m === 'done' ? 'bg-ink' : m === 'you' ? 'bg-you' : m === 'bad' ? 'bg-panel ring-[3px] ring-inset ring-bad' : current ? 'bg-panel ring-[3px] ring-inset ring-ink shadow-[0_16px_28px_-18px_rgb(0_0_0/0.55)]' : 'bg-panel ring-[1.5px] ring-inset ring-line-strong')}>
              {current && i === 2 && tasks.length > 0 && (
                <span className="absolute bottom-1.5 left-3 right-3 sm:bottom-2 sm:left-4 sm:right-4 flex h-1 sm:h-1.5 gap-0.5 sm:gap-[3px]">
                  {tasks.map((t, j) => (
                    <i key={j} className={cn('block flex-1 rounded-[2px]', markFill[t])} />
                  ))}
                </span>
              )}
            </span>
            {links?.[i] && <Link to={links[i]!.to} title={links[i]!.title} aria-label={`${label}: ${links[i]!.title}`} className="absolute inset-0 z-10 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />}
            <span className={cn('relative flex min-w-0 items-center justify-center gap-3 px-1 pb-3 pt-2 sm:justify-start sm:pl-6 sm:pr-3', current && i === 2 && 'sm:pb-5', m === 'you' && 'text-on-you')}>
              <span className={cn('hidden lg:inline-grid h-7 w-7 shrink-0 place-items-center rounded-md', m === 'done' ? 'bg-on-ink text-ink' : current && m === 'run' ? 'bg-ink text-on-ink' : 'ring-[1.5px] ring-inset ring-current')}>
                <Icon size={15} aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-col items-center sm:items-start">
                <b className="text-[12.5px] sm:text-base font-extrabold leading-tight tracking-tight">{label}</b>
                <span className="hidden sm:block truncate max-w-full text-[12.5px] leading-snug">{notes[i]}</span>
              </span>
            </span>
            {current && (
              <span className={cn('absolute -top-2.5 right-1/2 translate-x-1/2 sm:right-5 sm:translate-x-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em]', m === 'you' ? 'bg-on-you text-you' : m === 'bad' ? 'bg-bad text-on-bad' : 'bg-ink text-on-ink')}>
                {m === 'you' ? 'You' : m === 'bad' ? 'Failed' : 'Now'}
              </span>
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
    <span className={cn('inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] font-extrabold uppercase leading-none tracking-[0.12em]', you ? 'bg-you text-on-you' : state === 'failed' ? 'bg-bad text-on-bad' : state === 'cancelled' ? 'ring-[1.5px] ring-inset ring-line-strong text-ink-faint' : 'bg-ink text-on-ink')}>
      <Icon size={13} strokeWidth={2.5} aria-hidden="true" />
      {label}
    </span>
  );
}
