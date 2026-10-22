import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { markFill } from '../../components/progress.tsx';
import { chipClass, cn } from '../../ui.tsx';

/**
 * How the Brief marks where things stand, the same in both views: in the signal colours, on the small mark (a tag, a tick,
 * a chip, the words), never on a whole card. An answer given and an assumption accepted are green; a question that blocks
 * waits for you, in yellow; what holds the approval back is blue at work, yellow yours, red a problem.
 */

/** a question's options: the answer given a green chip (its word and edge green over a faint tint), the others quiet chips */
export const answerChip = (chosen: boolean) => (chosen ? 'rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset bg-ok/12 text-ok-ink ring-ok transition-colors' : chipClass(false));

/** a blocking question's tag: a yellow plate while it waits for your answer, an outline once it has one */
export const blockingTag = (answered: boolean) =>
  cn('inline-flex items-center whitespace-nowrap rounded-sm border border-transparent px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em]', answered ? 'text-ink-faint ring-1 ring-inset ring-line-strong' : 'bg-you text-on-you');

/** a question that has its answer: a green tick before it */
export function AnsweredTick({ answer }: { answer: string | null | undefined }) {
  if (!answer?.trim()) return null;
  return (
    <span className="mt-0.5 shrink-0 text-ok-ink" title="answered">
      <Check size={14} strokeWidth={2.75} aria-label="answered" />
    </span>
  );
}

/** an accepted assumption's tick in green (the stylesheet gives every checkbox the accent, so a class cannot) */
export const ACCEPTED_TICK = { accentColor: 'var(--color-ok)' };

/** the same tick where the Brief can no longer change: the browser greys a disabled box, so a small tile shows it (the box stays, for screen readers) */
export function ReadOnlyTick({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" className={cn('mt-[3px] grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[3px]', on ? 'bg-ok text-on-ok' : 'ring-1 ring-inset ring-line-strong')}>
      {on && <Check size={11} strokeWidth={3} />}
    </span>
  );
}

/** something that holds the approval back (or asks a look before it), and how it stands: work under way, waiting for your answer, or a problem to fix */
export interface Hold {
  text: string;
  /** what it means for you, after the words in plain ink */
  detail?: string;
  tone: 'work' | 'you' | 'bad';
}
/** the holds that apply, from a list where each is written `condition && { … }` */
export const holdsOf = (list: (Hold | false)[]): Hold[] => list.filter((h): h is Hold => !!h);
const HOLD_TONE: Record<Hold['tone'], string> = { work: 'text-work-ink', you: 'text-you-ink', bad: 'text-bad-ink' };
/** the goal page's marks: at work hatched blue, waiting for you yellow, a problem red */
const HOLD_MARK: Record<Hold['tone'], string> = { work: markFill.run, you: markFill.you, bad: markFill.bad };

/**
 * The Brief's actions, docked at the foot of the screen while the page scrolls (both views): on the left a line for each
 * thing that holds the approval back, then each note worth a look before approving, its square and words in its signal
 * colour; on the right the buttons.
 */
export function ApprovalBar({ holds, notes = [], children }: { holds: Hold[]; /** what does not hold the approval back but asks a look first */ notes?: Hold[]; children: ReactNode }) {
  const lines = [...holds, ...notes];
  return (
    <div className="sticky bottom-3 z-20 flex flex-col gap-3 rounded-xl border border-line bg-panel px-3 py-3 shadow-lg sm:flex-row sm:items-center sm:px-4">
      {lines.length > 0 && (
        <ul className="min-w-0 flex-1 space-y-1.5 text-xs leading-snug">
          {lines.map((h) => (
            <li key={h.text} className="flex items-start gap-2">
              <i className={cn('mt-[2px] h-3 w-3 shrink-0 rounded-[3px]', HOLD_MARK[h.tone])} aria-hidden="true" />
              <p className="min-w-0 first-letter:uppercase">
                <b className={cn('font-semibold', HOLD_TONE[h.tone])}>{h.text}</b>
                {h.detail && <span className="text-ink-soft"> — {h.detail}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
      {/* on a phone the buttons share the width, the last (the approval) on a row of its own */}
      <div className="grid grid-cols-2 gap-2 [&>*]:justify-center [&>*:last-child]:col-span-2 sm:ml-auto sm:flex sm:flex-wrap sm:items-center sm:justify-end">{children}</div>
    </div>
  );
}
