import { type ReactNode, useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { type FullText, FullTextDialog } from '../components/FullTextDialog.tsx';
import { type StreamItem, useLive } from '../store.ts';
import { cn } from '../ui.tsx';

/** The full content of a stream event for the dialog; null when the line already says everything. */
function fullOf(ev: any, items: StreamItem[]): Omit<FullText, 'note' | 'loading'> | null {
  switch (ev.kind) {
    case 'text':
      return { title: 'Assistant message', text: ev.text };
    case 'thinking':
      return { title: 'Thinking', text: ev.text };
    case 'tool_use':
      return { title: `Tool call · ${ev.name}`, text: JSON.stringify(ev.input, null, 2) ?? '', raw: true };
    case 'tool_result': {
      const call = items.find((x) => x.event.kind === 'tool_use' && x.event.id === ev.toolUseId)?.event;
      return { title: `${ev.isError ? 'Tool error' : 'Tool result'}${call ? ` · ${call.name}` : ''}`, text: ev.content, raw: true };
    }
    case 'result': {
      const r = ev.result;
      const text = r.finalText ?? r.errorMessage ?? (r.structuredOutput ? JSON.stringify(r.structuredOutput, null, 2) : null);
      return text ? { title: `Session result · ${r.subtype}`, text, raw: !r.finalText && !r.errorMessage } : null;
    }
    case 'stderr':
      return { title: 'stderr', text: ev.text, raw: true };
    default:
      return null;
  }
}

/** cheap check for the render loop: does this line open a dialog? */
const hasFull = (ev: any) => ['text', 'thinking', 'tool_use', 'tool_result', 'stderr'].includes(ev.kind) || (ev.kind === 'result' && !!(ev.result.finalText ?? ev.result.errorMessage ?? ev.result.structuredOutput));

/**
 * Tail of the live stream for one attempt (or clarify/goal-review/tool pseudo-id).
 * On mount, channels that have nothing buffered are seeded from the transcript so a page refresh keeps the history.
 * Every entry is one line; a click (or Enter) opens the whole message — shortened events are read back from the transcript.
 */
export function LiveLog({ attemptId, className }: { attemptId: string; className?: string }) {
  const items = useLive((s) => s.streams[attemptId]) ?? [];
  const seed = useLive((s) => s.seedStream);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<FullText | null>(null);
  const opening = useRef(0);
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

  const show = (ev: any) => {
    const full = fullOf(ev, items);
    if (!full) return;
    const n = ++opening.current;
    if (!ev.truncated) return setOpen(full);
    const partial = <>Only the first {full.text.length.toLocaleString()} characters reached this page, and the full text could not be read from the session's transcript.</>;
    if (!ev.ref) return setOpen({ ...full, note: partial });
    setOpen({ ...full, loading: true });
    api
      .streamEvent(ev.ref)
      .then(({ event }) => n === opening.current && setOpen(fullOf(event, items) ?? full))
      .catch(() => n === opening.current && setOpen({ ...full, note: partial }));
  };
  const close = () => {
    opening.current++;
    setOpen(null);
  };

  return (
    <>
      <div ref={ref} className={cn('mono text-[12px] leading-5 bg-zinc-950 border border-zinc-800 rounded-md p-3 overflow-auto max-h-[420px]', className)}>
        {items.length === 0 && <div className="text-zinc-600">{loaded ? 'no output recorded yet…' : 'loading…'}</div>}
        {items.map((it, i) => {
          const ev = it.event;
          const tag = it.role && it.role !== 'worker' ? <span className="text-violet-400/80 shrink-0" title={`${it.role} session (shares this attempt's log)`}>[{it.role}]</span> : null;
          // one line per entry; entries with more behind them are buttons that open the full text
          const line = (cls: string, node: ReactNode) => {
            const body = (
              <>
                {tag}
                <span className="min-w-0 flex-1 truncate">{node}</span>
              </>
            );
            if (!hasFull(ev)) return <div key={i} className={cn('flex gap-1.5 min-w-0', cls)}>{body}</div>;
            return (
              <button key={i} type="button" onClick={() => show(ev)} title="Show the full message" className={cn('flex gap-1.5 min-w-0 w-full text-left rounded-sm hover:bg-zinc-900 focus-visible:outline focus-visible:outline-1 focus-visible:outline-zinc-500 cursor-pointer', cls)}>
                {body}
              </button>
            );
          };
          const oneLine = (s: string) => s.slice(0, 400).replace(/\s+/g, ' ');
          if (ev.kind === 'text') return line('text-zinc-200', oneLine(ev.text));
          if (ev.kind === 'thinking') return line('text-zinc-600 italic', oneLine(ev.text));
          if (ev.kind === 'tool_use') return line('text-sky-400', <>⚙ {ev.name} <span className="text-zinc-500">{JSON.stringify(ev.input)?.slice(0, 400)}</span></>);
          if (ev.kind === 'tool_result') return line(ev.isError ? 'text-rose-400' : 'text-zinc-500', <>{ev.isError ? '✗ ' : '↳ '}{ev.isError && /does not match required schema/.test(ev.content) ? <span className="text-zinc-500">the model will resend it in the right shape; harmless — </span> : null}{oneLine(ev.content)}</>);
          if (ev.kind === 'init') return line('text-emerald-500', <>● {it.role && it.role !== 'worker' ? `${it.role} ` : ''}session {ev.sessionId.slice(0, 8)} · {ev.model}</>);
          if (ev.kind === 'result') {
            const r = ev.result;
            const said = r.finalText ?? r.errorMessage;
            return line('text-emerald-400', <>■ {r.subtype} · ${r.costUsd.toFixed(3)} · {r.numTurns} turns{r.subtype === 'error_max_turns' || r.subtype === 'error_max_budget_usd' ? ' — the engine resumes this session (continuation)' : ''}{said ? <span className="text-zinc-300"> — {oneLine(said)}</span> : null}</>);
          }
          if (ev.kind === 'progress') {
            // one line per running tool, kept current: consecutive heartbeats of the same call replace each other
            const next = items[i + 1]?.event;
            if (next?.kind === 'progress' && next.toolUseId === ev.toolUseId) return null;
            const s = Math.round(ev.elapsedSeconds);
            return line('text-zinc-500', <>⏱ {ev.tool === 'Agent' ? 'sub-agent' : ev.tool} still working · {s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`}</>);
          }
          if (ev.kind === 'hook') return null;
          if (ev.kind === 'rate_limit' && ev.info.status !== 'allowed') return line('text-amber-400', <>⏳ rate limit {ev.info.status}</>);
          if (ev.kind === 'stderr') return line('text-rose-300/70', oneLine(ev.text));
          return null;
        })}
      </div>
      <FullTextDialog value={open} onClose={close} />
    </>
  );
}
