import { cn, code } from '../../ui.tsx';

/**
 * How a thing stands, in the theme's signal colours, the same on the Agents, Extensions, Ports and Schedules pages:
 * done, installed, up to date, connected → ok (green); working, running, starting, checking → work (blue); failed,
 * broken → bad (red); what the person must act on — an update to install, a copy to clear, a sign-in → you (yellow);
 * idle, unknown, not installed, off → none, hollow and neutral. The colour goes on the small mark (a plate, a dot, the
 * words, a thin edge), never on a row or a panel.
 */
export type Tone = 'ok' | 'work' | 'bad' | 'you' | 'none';

/** a small plate in tiny capitals, the shape of the kit's Badge */
const PLATE = 'inline-flex items-center whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[11px] font-bold uppercase leading-4 tracking-[0.08em] ring-1 ring-inset';
const PLATE_TONE: Record<Tone, string> = {
  ok: 'bg-ok/12 text-ok-ink ring-ok/45',
  work: 'bg-work/12 text-work-ink ring-work/45',
  bad: 'bg-bad/12 text-bad-ink ring-bad/45',
  you: 'bg-you/20 text-you-ink ring-you/60',
  none: 'text-ink-soft ring-line-strong',
};
/** a state as a small plate in its signal colour (hollow for `none`) */
export const statePlate = (tone: Tone) => cn(PLATE, PLATE_TONE[tone]);

const DOT_TONE: Record<Tone, string> = { ok: 'bg-ok', work: 'bg-work', bad: 'bg-bad', you: 'bg-you', none: 'inset-ring-[1.5px] inset-ring-ink-faint' };
/** a state as a small round dot, before a name or a count (hollow for `none`) */
export const stateDot = (tone: Tone) => cn('inline-block h-2 w-2 shrink-0 rounded-full', DOT_TONE[tone]);

/** a state said in words, in its colour */
export const STATE_INK: Record<Tone, string> = { ok: 'text-ok-ink', work: 'text-work-ink', bad: 'text-bad-ink', you: 'text-you-ink', none: 'text-ink-soft' };

const EDGE: Record<Tone, string> = { ok: 'border-l-ok', work: 'border-l-work', bad: 'border-l-bad', you: 'border-l-you', none: 'border-l-line-strong' };
/**
 * A notice's box on the panel's own colour, its state on a thin left edge (the words take the colour where they are the
 * state); the caller gives its padding and type size.
 */
export const notice = (tone: Tone) => cn('rounded-md border border-line border-l-[3px] bg-panel', EDGE[tone]);

/** which one — where a thing comes from, what kind it is: the same plate in a category colour (code(i), counting from 0) */
export const categoryPlate = (i: number) => cn(PLATE, code(i).chip);
/** a category colour's small square, before a name in a list, a filter or a key; `null` is a kind with no colour of its own */
export const categorySquare = (i: number | null) => cn('inline-block h-2 w-2 shrink-0 rounded-[2px]', i == null ? 'bg-line-strong' : code(i).dot);
