import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { useLive } from '../store.ts';
import { cn } from '../ui.tsx';

/**
 * Tail of the live stream for one attempt (or clarify/goal-review/tool pseudo-id).
 * On mount, channels that have nothing buffered are seeded from the transcript so a page refresh keeps the history.
 */
export function LiveLog({ attemptId, className }: { attemptId: string; className?: string }) {
  const items = useLive((s) => s.streams[attemptId]) ?? [];
  const seed = useLive((s) => s.seedStream);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setLoaded(false);
    let alive = true;
    api
      .streamHistory(attemptId)
      .then((h) => alive && h.events.length && !(useLive.getState().streams[attemptId]?.length) && seed(attemptId, h.events))
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [attemptId]);
  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [items.length]);
  return (
    <div ref={ref} className={cn('mono text-[12px] leading-5 bg-zinc-950 border border-zinc-800 rounded-md p-3 overflow-auto max-h-[420px]', className)}>
      {items.length === 0 && <div className="text-zinc-600">{loaded ? 'no output recorded yet…' : 'loading…'}</div>}
      {items.map((it, i) => {
        const ev = it.event;
        if (ev.kind === 'text') return <div key={i} className="text-zinc-200 whitespace-pre-wrap">{ev.text}</div>;
        if (ev.kind === 'thinking') return <div key={i} className="text-zinc-600 italic truncate">{ev.text}</div>;
        if (ev.kind === 'tool_use') return <div key={i} className="text-sky-400 truncate">⚙ {ev.name} <span className="text-zinc-500">{JSON.stringify(ev.input).slice(0, 160)}</span></div>;
        if (ev.kind === 'tool_result') return <div key={i} className={cn('truncate', ev.isError ? 'text-rose-400' : 'text-zinc-500')}>{ev.isError ? '✗ ' : '↳ '}{ev.content.slice(0, 200).replace(/\n/g, ' ')}</div>;
        if (ev.kind === 'init') return <div key={i} className="text-emerald-500">● session {ev.sessionId.slice(0, 8)} · {ev.model}</div>;
        if (ev.kind === 'result') return <div key={i} className="text-emerald-400">■ {ev.result.subtype} · ${ev.result.costUsd.toFixed(3)} · {ev.result.numTurns} turns</div>;
        if (ev.kind === 'hook') return null;
        if (ev.kind === 'rate_limit' && ev.info.status !== 'allowed') return <div key={i} className="text-amber-400">⏳ rate limit {ev.info.status}</div>;
        if (ev.kind === 'stderr') return <div key={i} className="text-rose-300/70 truncate">{ev.text}</div>;
        return null;
      })}
    </div>
  );
}
