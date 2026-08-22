import { useMemo, useState } from 'react';
import type { GoalDetail } from '../../api.ts';
import { useLive } from '../../store.ts';
import { cn } from '../../ui.tsx';
import { NOISY, describe, type Tone } from './describe.ts';

const TONE: Record<Tone, string> = { info: 'text-sky-300', ok: 'text-emerald-300', warn: 'text-amber-300', err: 'text-rose-300', muted: 'text-zinc-400' };
const DOT: Record<Tone, string> = { info: 'bg-sky-400', ok: 'bg-emerald-400', warn: 'bg-amber-400', err: 'bg-rose-400', muted: 'bg-zinc-600' };

export function ActivityTab({ d }: { d: GoalDetail }) {
  const [showNoisy, setShowNoisy] = useState(false);
  const [onlyImportant, setOnlyImportant] = useState(false);
  const streams = useLive((s) => s.streams);
  const items = useMemo(() => {
    const ev = d.events
      .filter((e) => showNoisy || !NOISY.has(e.type))
      .map((e) => ({ ts: e.ts, key: e.id, ...describe(e), kind: 'event' as const, type: e.type }))
      .filter((e) => !onlyImportant || e.tone !== 'muted');
    // fold worker text from live streams of this goal's attempts
    const texts = Object.entries(streams)
      .filter(([id]) => d.attempts.some((a) => a.id === id))
      .flatMap(([id, list]) => list.filter((s) => s.event.kind === 'text').map((s, i) => ({ ts: s.ts, key: `${id}-${i}`, text: s.event.text.split('\n')[0].slice(0, 160), tone: 'muted' as Tone, kind: 'text' as const, type: 'worker' })));
    return [...ev, ...(onlyImportant ? [] : texts)].sort((a, b) => b.ts.localeCompare(a.ts));
  }, [d.events, streams, showNoisy, onlyImportant]);

  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-xs text-zinc-400">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={onlyImportant} onChange={(e) => setOnlyImportant(e.target.checked)} /> important only
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showNoisy} onChange={(e) => setShowNoisy(e.target.checked)} /> show bookkeeping events
        </label>
        <span className="ml-auto">{items.length} entries</span>
      </div>
      <div className="rounded-lg border border-zinc-800 divide-y divide-zinc-800/60 max-h-[70vh] overflow-auto">
        {items.map((it) => (
          <div key={it.key} className="flex gap-3 px-3 py-1.5 text-xs">
            <span className="mono text-zinc-600 w-16 shrink-0">{it.ts.slice(11, 19)}</span>
            <span className={cn('mt-1.5 h-1.5 w-1.5 rounded-full shrink-0', DOT[it.tone])} />
            <span className={cn('flex-1 break-words', it.kind === 'text' ? 'text-zinc-500 italic' : TONE[it.tone])}>{it.text}</span>
            <span className="mono text-[10px] text-zinc-700 shrink-0">{it.type}</span>
          </div>
        ))}
        {items.length === 0 && <div className="text-sm text-zinc-500 py-8 text-center">Nothing yet.</div>}
      </div>
    </div>
  );
}
