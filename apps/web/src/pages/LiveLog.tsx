import { type ReactNode, useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { type FullText, FullTextDialog } from '../components/FullTextDialog.tsx';
import { type StreamItem, useLive } from '../store.ts';
import { CODES, cn } from '../ui.tsx';

/** each session role's category colour (ADR-0067), the hues they had before themes: the worker blue, the reviewer violet, the merger magenta */
export const ROLE_INK: Record<string, string> = { worker: CODES[0].ink, reviewer: CODES[2].ink, merger: CODES[6].ink };

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
/** only a task attempt's worker session is continued by the engine; a review or draft cut short is not */
const resumes = (channel: string, role: string | undefined) => /^a_/.test(channel) && (!role || role === 'worker');

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
      {/* a box inside the panel, ink on the inset grey in light and dark alike: what the agent said in ink, its tools in blue,
          failures in red, the rest quiet */}
      <div ref={ref} className={cn('mono text-[12px] leading-5 text-ink bg-sunken border border-line rounded-lg p-3 overflow-auto max-h-[420px]', className)}>
        {items.length === 0 && <div className="text-ink-faint">{loaded ? 'no output recorded yet…' : 'loading…'}</div>}
        {items.map((it, i) => {
          const ev = it.event;
          const tag = it.role && it.role !== 'worker' ? <span className={cn('shrink-0', ROLE_INK[it.role] ?? 'text-ink-soft')} title={`${it.role} session (shares this attempt's log)`}>[{it.role}]</span> : null;
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
              // its line in the middle of the 32px a phone gives a button
              <button key={i} type="button" onClick={() => show(ev)} title="Show the full message" className={cn('log-row flex items-center gap-1.5 min-w-0 w-full text-left rounded-sm hover:bg-panel focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent cursor-pointer', cls)}>
                {body}
              </button>
            );
          };
          const oneLine = (s: string) => s.slice(0, 400).replace(/\s+/g, ' ');
          if (ev.kind === 'text') return line('text-ink', oneLine(ev.text));
          if (ev.kind === 'thinking') return line('text-ink-faint italic', oneLine(ev.text));
          if (ev.kind === 'tool_use') return line('text-work-ink', <>⚙ {ev.name} <span className="text-ink-faint">{JSON.stringify(ev.input)?.slice(0, 400)}</span></>);
          if (ev.kind === 'tool_result') return line(ev.isError ? 'text-bad-ink' : 'text-ink-faint', <>{ev.isError ? '✗ ' : '↳ '}{ev.isError && /does not match required schema/.test(ev.content) ? <span className="text-ink-faint">the model will resend it in the right shape; harmless — </span> : null}{oneLine(ev.content)}</>);
          if (ev.kind === 'init') return line('font-bold text-ink', <>● {it.role && it.role !== 'worker' ? `${it.role} ` : ''}session {ev.sessionId.slice(0, 8)} · {ev.model}</>);
          if (ev.kind === 'result') {
            const r = ev.result;
            const said = r.finalText ?? r.errorMessage;
            // a session cut by its own cap is not a failure of the work: ink in bold, not red, and what happens next said for
            // the log it is in; one that ended in an error is red
            const cut = r.subtype === 'error_max_turns' || r.subtype === 'error_max_budget_usd';
            const next = cut && resumes(attemptId, it.role) ? ' — the engine resumes this session (continuation)' : '';
            const cap = r.subtype === 'error_max_budget_usd' ? " · the cost cap per session (Settings → Models & limits), not the goal's budget" : '';
            return line(r.subtype === 'success' ? 'font-bold text-ok-ink' : cut ? 'font-bold text-ink' : 'font-bold text-bad-ink', <>■ {r.subtype} · {r.costStatus === 'unavailable' ? 'cost unavailable' : `$${r.costUsd.toFixed(3)}`} · {r.costStatus === 'unavailable' ? 'turn count unavailable' : `${r.numTurns} turns`}{cap}{next}{said ? <span className="font-normal text-ink-soft"> — {oneLine(said)}</span> : null}</>);
          }
          if (ev.kind === 'progress') {
            // one line per running tool, kept current: consecutive heartbeats of the same call replace each other
            const next = items[i + 1]?.event;
            if (next?.kind === 'progress' && next.toolUseId === ev.toolUseId) return null;
            const s = Math.round(ev.elapsedSeconds);
            return line('text-ink-faint', <>⏱ {ev.tool === 'Agent' ? 'sub-agent' : ev.tool} still working · {s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`}</>);
          }
          if (ev.kind === 'hook') return null;
          if (ev.kind === 'rate_limit' && ev.info.status !== 'allowed') return line('font-bold text-ink', <>⏳ rate limit {ev.info.status}</>);
          if (ev.kind === 'stderr') return line('text-bad-ink/80', oneLine(ev.text));
          return null;
        })}
      </div>
      <FullTextDialog value={open} onClose={close} />
    </>
  );
}
