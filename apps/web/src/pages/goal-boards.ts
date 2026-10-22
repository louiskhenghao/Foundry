import { FOLLOWABLE_STATES } from '@foundry/core/browser';
import type { GoalRow } from '../api.ts';
import type { ListEntry } from './goal-chains.ts';

/** What a goal waits for from you, as its sign on the Goals page says it: the action, where it is done, one sentence. */
export interface Need {
  action: string;
  href: string;
  say: string;
}

/** a goal that waits for you, and for what; null when it needs nothing */
export function needOf(g: GoalRow): Need | null {
  if (g.state === 'awaiting_brief_approval') return { action: 'Review brief', href: `/goals/${g.id}/brief`, say: 'The Brief is ready. Approve it, or change what you want first, and the work starts.' };
  if (g.state === 'clarifying' && g.interview?.status === 'awaiting_answers') return { action: 'Answer questions', href: `/goals/${g.id}`, say: 'Some questions only you can decide. Answer them and Foundry writes the Brief.' };
  if (g.state === 'awaiting_feedback') return { action: 'Have a look', href: `/goals/${g.id}`, say: 'Something is ready to look at. Continue, or say what to change.' };
  if (g.openEscalations > 0) return { action: 'Open Inbox', href: '/inbox', say: g.openEscalations === 1 ? 'One thing waits for your decision before this goal can go on.' : `${g.openEscalations} things wait for your decision before this goal can go on.` };
  if (g.state === 'blocked') return { action: 'See why', href: `/goals/${g.id}`, say: 'It stopped and cannot go on by itself.' };
  return null;
}

/** done, over-delivered, failed or cancelled: the goal's history is written */
export const isFinished = (g: GoalRow) => FOLLOWABLE_STATES.includes(g.state);

/**
 * Which board an entry of the list sits on: a chain of follow-ups by its newest goal. A single goal that waits for you
 * hangs as a sign above the boards instead; a chain stays on its board, its waiting goal as a sign too.
 */
export function boardOf(e: ListEntry): 'working' | 'finished' | 'sign' {
  if (e.kind === 'chain') return isFinished(e.chain.latest) ? 'finished' : 'working';
  if (needOf(e.goal)) return 'sign';
  return isFinished(e.goal) ? 'finished' : 'working';
}

/** how long ago, in the fewest words: 40 s, 7 min, 3 h, 2 d */
export function waited(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}
