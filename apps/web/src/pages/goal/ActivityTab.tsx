import { reportsDollars } from '@foundry/core/browser';
import { useMemo, useState } from 'react';
import type { GoalDetail } from '../../api.ts';
import { type FullText, FullTextDialog } from '../../components/FullTextDialog.tsx';
import { useLive } from '../../store.ts';
import { BOARD_ROW, cn } from '../../ui.tsx';
import { clock } from '../../time.ts';
import { NOISY, describe, type Tone } from './describe.ts';

/** a line's colour: green what passed, red what failed, ink the rest; a warning is ink in bold, since yellow is only for what waits for you */
const TONE: Record<Tone, string> = { info: 'text-ink', ok: 'text-ok-ink', warn: 'font-semibold text-ink', err: 'text-bad-ink', muted: 'text-ink-soft' };
/**
 * the plate of its kind, in the signal of how it went: blue for news, green for what passed, red for what failed, yellow
 * for what put something in your hands, outlined in ink for a warning, quiet for the rest
 */
const PLATE: Record<Tone | 'you', string> = {
  info: 'bg-work/10 text-work-ink ring-work/40',
  ok: 'bg-ok/10 text-ok-ink ring-ok/45',
  warn: 'font-bold text-ink ring-ink/60',
  err: 'bg-bad/10 text-bad-ink ring-bad/45',
  muted: 'text-ink-soft ring-line-strong',
  you: 'bg-you/25 font-bold text-ink ring-you',
};
/** the states in which a goal or a task waits for you */
const YOU_STATES = ['blocked', 'awaiting_brief_approval', 'awaiting_feedback'];
/** an Inbox item, a round of questions, a Brief or a milestone to look at: what the event put in your hands */
const waitsForYou = (e: { type: string; payload: unknown }) => e.type === 'escalation.raised' || e.type === 'interview.round_asked' || e.type === 'revise.round_asked' || ((e.type === 'goal.state_changed' || e.type === 'task.state_changed') && YOU_STATES.includes(String((e.payload as { to?: unknown }).to)));
/** a warning that reports a failure (an attempt, the goal's review, the audit, a Revise, a second opinion, a delegated goal) is red, as failures are */
function reportsFailure(e: { type: string; payload: unknown }): boolean {
  const p = e.payload as Record<string, unknown>;
  return (e.type === 'attempt.concluded' && (p.state === 'failed' || p.state === 'error')) || (e.type === 'review.goal.finished' && p.passed === false) || (e.type === 'goal.audit_finished' && p.status === 'failed') || (e.type === 'revise.finished' && p.reason === 'failed') || e.type === 'brief.second_opinion_failed' || e.type === 'task.delegation_restarted';
}
/** a log line: its time, its kind on a small plate, then what happened (on a phone the text goes under the plate) */
const LINE = 'grid grid-cols-[4.25rem_minmax(0,1fr)] sm:grid-cols-[4.25rem_13rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 px-4 py-1.5';

export function ActivityTab({ d }: { d: GoalDetail }) {
  const [showNoisy, setShowNoisy] = useState(false);
  const [onlyImportant, setOnlyImportant] = useState(false);
  const [open, setOpen] = useState<FullText | null>(null);
  const streams = useLive((s) => s.streams);
  const items = useMemo(() => {
    const ev = d.events
      .filter((e) => showNoisy || !NOISY.has(e.type))
      .map((e) => {
        const said = describe(e, reportsDollars(d.goal.provider));
        return { ts: e.ts, key: e.id, ...said, tone: said.tone === 'warn' && reportsFailure(e) ? ('err' as Tone) : said.tone, kind: 'event' as const, type: e.type, you: waitsForYou(e) };
      })
      .filter((e) => !onlyImportant || e.tone !== 'muted');
    // fold worker text from live streams of this goal's attempts
    const texts = Object.entries(streams)
      .filter(([id]) => d.attempts.some((a) => a.id === id))
      .flatMap(([id, list]) =>
        list
          .filter((s) => s.event.kind === 'text')
          .map((s, i) => {
            const text: string = s.event.text;
            const first = text.split('\n')[0]!.slice(0, 160);
            return { ts: s.ts, key: `${id}-${i}`, text: first, full: first === text.trim() ? undefined : text, raw: false, tone: 'muted' as Tone, kind: 'text' as const, type: 'worker', you: false };
          }),
      );
    return [...ev, ...(onlyImportant ? [] : texts)].sort((a, b) => b.ts.localeCompare(a.ts));
  }, [d.events, streams, showNoisy, onlyImportant]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
        {/* a phone's thumb gets a 32px row to tap */}
        <label className="flex items-center gap-1.5 min-h-8 sm:min-h-0">
          <input type="checkbox" checked={onlyImportant} onChange={(e) => setOnlyImportant(e.target.checked)} /> important only
        </label>
        <label className="flex items-center gap-1.5 min-h-8 sm:min-h-0">
          <input type="checkbox" checked={showNoisy} onChange={(e) => setShowNoisy(e.target.checked)} /> show bookkeeping events
        </label>
        <span className="ml-auto">
          <span className="mono">{items.length}</span> entries
        </span>
      </div>
      <ul className="rounded-xl bg-panel shadow-[0_0_0_1px_var(--color-line),var(--surface-shadow)] divide-y divide-line max-h-[70vh] overflow-auto">
        {items.map((it) => {
          const row = (
            <>
              <time className="mono text-xs text-ink-faint" dateTime={it.ts} title={new Date(it.ts).toLocaleString()}>
                {clock(it.ts)}
              </time>
              <span className={cn('justify-self-start max-w-full truncate rounded-[4px] px-1.5 mono text-[11px] leading-5 ring-1 ring-inset', PLATE[it.you ? 'you' : it.tone])} title={it.type}>
                {it.type}
              </span>
              <span className={cn('col-start-2 sm:col-start-auto min-w-0 break-words text-[13px] leading-snug', it.kind === 'text' ? 'italic text-ink-faint' : TONE[it.tone])}>
                {it.text}
                {it.full && <span className="not-italic text-ink-faint"> …</span>}
              </span>
            </>
          );
          // a row that shows only part of its text opens the whole of it
          if (!it.full) return <li key={it.key} className={cn(BOARD_ROW, LINE)}>{row}</li>;
          const full = it.full;
          return (
            <li key={it.key} className={BOARD_ROW}>
              <button type="button" title="Show the full text" onClick={() => setOpen({ title: it.kind === 'text' ? 'Worker message' : it.type, text: full, raw: it.raw })} className={cn(LINE, 'w-full text-left cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent')}>
                {row}
              </button>
            </li>
          );
        })}
        {items.length === 0 && <li className="text-sm text-ink-faint py-8 text-center">Nothing yet.</li>}
      </ul>
      <FullTextDialog value={open} onClose={() => setOpen(null)} />
    </div>
  );
}
