import { type ReactNode, useEffect, useRef, useState } from 'react';
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
        const tag = it.role && it.role !== 'worker' ? <span className="text-violet-400/80 shrink-0" title={`${it.role} session (shares this attempt's log)`}>[{it.role}]</span> : null;
        const wrap = (cls: string, node: ReactNode) => (
          <div key={i} className={cn('flex gap-1.5 min-w-0', cls)}>
            {tag}
            <span className="min-w-0 flex-1 truncate">{node}</span>
          </div>
        );
        if (ev.kind === 'text') return <div key={i} className="flex gap-1.5">{tag}<span className="text-zinc-200 whitespace-pre-wrap min-w-0 flex-1">{ev.text}</span></div>;
        if (ev.kind === 'thinking') return wrap('text-zinc-600 italic', ev.text);
        if (ev.kind === 'tool_use') return wrap('text-sky-400', <>⚙ {ev.name} <span className="text-zinc-500">{JSON.stringify(ev.input).slice(0, 160)}</span></>);
        if (ev.kind === 'tool_result') return wrap(ev.isError ? 'text-rose-400' : 'text-zinc-500', <>{ev.isError ? '✗ ' : '↳ '}{ev.content.slice(0, 200).replace(/\n/g, ' ')}{ev.isError && /does not match required schema/.test(ev.content) ? <span className="text-zinc-500"> — the model will resend it in the right shape; harmless</span> : null}</>);
        if (ev.kind === 'init') return wrap('text-emerald-500', <>● {it.role && it.role !== 'worker' ? `${it.role} ` : ''}session {ev.sessionId.slice(0, 8)} · {ev.model}</>);
        if (ev.kind === 'result') return wrap('text-emerald-400', <>■ {ev.result.subtype} · ${ev.result.costUsd.toFixed(3)} · {ev.result.numTurns} turns{ev.result.subtype === 'error_max_turns' || ev.result.subtype === 'error_max_budget_usd' ? ' — the engine resumes this session (continuation)' : ''}</>);
        if (ev.kind === 'hook') return null;
        if (ev.kind === 'rate_limit' && ev.info.status !== 'allowed') return wrap('text-amber-400', <>⏳ rate limit {ev.info.status}</>);
        if (ev.kind === 'stderr') return wrap('text-rose-300/70', ev.text);
        return null;
      })}
    </div>
  );
}
