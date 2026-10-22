import { Check } from 'lucide-react';
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

/** something that holds the approval back, and how it stands: work under way, waiting for your answer, or a problem to fix */
export interface Hold {
  text: string;
  tone: 'work' | 'you' | 'bad';
}
const HOLD_TONE: Record<Hold['tone'], string> = { work: 'text-work-ink', you: 'font-semibold text-you-ink', bad: 'font-semibold text-bad-ink' };

/** what holds the approval back, in a line by the actions: each in its signal colour */
export function Holds({ holds }: { holds: Hold[] }) {
  return (
    <p>
      {holds.map((h, i) => (
        <span key={h.text}>
          {i > 0 && <span className="text-ink-faint"> · </span>}
          <span className={HOLD_TONE[h.tone]}>{h.text}</span>
        </span>
      ))}
    </p>
  );
}
