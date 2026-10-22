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
      .map((e) => ({ ts: e.ts, key: e.id, ...describe(e, reportsDollars(d.goal.provider)), kind: 'event' as const, type: e.type }))
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
            return { ts: s.ts, key: `${id}-${i}`, text: first, full: first === text.trim() ? undefined : text, raw: false, tone: 'muted' as Tone, kind: 'text' as const, type: 'worker' };
          }),
      );
    return [...ev, ...(onlyImportant ? [] : texts)].sort((a, b) => b.ts.localeCompare(a.ts));
  }, [d.events, streams, showNoisy, onlyImportant]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={onlyImportant} onChange={(e) => setOnlyImportant(e.target.checked)} /> important only
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showNoisy} onChange={(e) => setShowNoisy(e.target.checked)} /> show bookkeeping events
        </label>
        <span className="ml-auto">
          <span className="mono">{items.length}</span> entries
        </span>
      </div>
      <ul className="rounded-xl bg-panel shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.06)] divide-y divide-line max-h-[70vh] overflow-auto">
        {items.map((it) => {
          const row = (
            <>
              <time className="mono text-xs text-ink-faint" dateTime={it.ts} title={new Date(it.ts).toLocaleString()}>
                {clock(it.ts)}
              </time>
              <span className="justify-self-start max-w-full truncate rounded-[4px] px-1.5 mono text-[11px] leading-5 text-ink-soft ring-1 ring-inset ring-line-strong" title={it.type}>
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
