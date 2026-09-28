import type { AgentLogChunk, AgentLogItem, AgentStatus } from '@foundry/engine/agents-types';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { type FullText, FullTextDialog } from '../../components/FullTextDialog.tsx';
import { cn } from '../../ui.tsx';

const POLL_MS = 2500;

type ToolUse = Extract<AgentLogItem, { kind: 'tool_use' }>;
type ToolResult = Extract<AgentLogItem, { kind: 'tool_result' }>;

/** A tool call and, once it arrived, its result: one entry in the log, one text in the dialog. */
function toolText(use: ToolUse, result?: ToolResult): string {
  return result ? `${use.input}\n\n── ${result.isError ? 'error' : 'result'} ──\n${result.content}` : use.input;
}

/** The full content of a transcript entry for the dialog; null when the line already says everything. */
function fullOf(it: AgentLogItem, resultFor: Map<string, ToolResult>): FullText | null {
  switch (it.kind) {
    case 'user':
      return { title: 'You', text: it.text };
    case 'command':
      return it.args ? { title: `/${it.name}`, text: it.args, raw: true } : null;
    case 'notice':
      return { title: 'Notice', text: it.text, raw: true };
    case 'assistant':
      return { title: 'Assistant message', text: it.text };
    case 'thinking':
      return { title: 'Thinking', text: it.text };
    case 'tool_use':
      return { title: `Tool call · ${it.name}`, text: toolText(it, it.id ? resultFor.get(it.id) : undefined), raw: true };
    case 'tool_result':
      return { title: it.isError ? 'Tool error' : 'Tool result', text: it.content, raw: true };
    default:
      return null;
  }
}

const oneLine = (s: string) => s.slice(0, 400).replace(/\s+/g, ' ');

/**
 * Parsed conversation view for a session Foundry did not spawn (or a Task subagent), fed by
 * incremental byte-offset polling of the transcript — only while this component is mounted.
 */
export function TranscriptView({ sessionId, agentId, className }: { sessionId: string; agentId?: string; className?: string }) {
  const [items, setItems] = useState<AgentLogItem[]>([]);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<FullText | null>(null);
  const offsetRef = useRef(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setItems([]);
    setStatus(null);
    setError(null);
    offsetRef.current = 0;
    const poll = () => {
      api
        .agentLog(sessionId, offsetRef.current, agentId)
        .then((c: AgentLogChunk) => {
          if (!alive) return;
          offsetRef.current = c.offset;
          if (c.items.length) setItems((prev) => [...prev, ...c.items]);
          setStatus(c.status);
          setError(null);
          if (!c.eof) poll();
          else if (c.status !== 'finished') timer = setTimeout(poll, POLL_MS);
        })
        .catch((e) => {
          if (!alive) return;
          setError(String(e?.message ?? e));
          timer = setTimeout(poll, POLL_MS * 2);
        });
    };
    poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, agentId]);

  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  // pair each tool_use with its result so one line (and one dialog) shows both
  const resultFor = new Map<string, ToolResult>();
  for (const it of items) if (it.kind === 'tool_result' && it.forId) resultFor.set(it.forId, it);
  const called = new Set(items.flatMap((it) => (it.kind === 'tool_use' && it.id ? [it.id] : [])));

  return (
    <>
      <div ref={ref} className={cn('surface-card mono text-[12px] leading-5 bg-zinc-950 border border-zinc-800 rounded-md p-3 overflow-auto max-h-[70vh] space-y-0.5', className)}>
        {items.length === 0 && <div className="text-zinc-600">{error ? `log unavailable: ${error}` : status === null ? 'loading…' : 'no renderable output in this transcript…'}</div>}
        {items.map((it, i) => {
          // one line per entry, like the live log; entries with more behind them are buttons that open the full text
          const line = (cls: string, node: ReactNode) => {
            const full = fullOf(it, resultFor);
            const body = <span className="min-w-0 flex-1 truncate">{node}</span>;
            if (!full) return <div key={i} className={cn('flex gap-1.5 min-w-0', cls)}>{body}</div>;
            return (
              <button key={i} type="button" onClick={() => setOpen(full)} title="Show the full message" className={cn('flex gap-1.5 min-w-0 w-full text-left rounded-sm hover:bg-zinc-900 focus-visible:outline focus-visible:outline-1 focus-visible:outline-zinc-500 cursor-pointer', cls)}>
                {body}
              </button>
            );
          };
          if (it.kind === 'user') return line('text-zinc-100 surface-inset bg-zinc-900 border border-zinc-800 px-2 py-0.5 my-1', <><span className="text-[10px] uppercase tracking-wide text-zinc-500 mr-1.5">you</span>{oneLine(it.text)}</>);
          if (it.kind === 'command') return line('text-violet-300', <>/{it.name} {it.args && <span className="text-zinc-400">{oneLine(it.args)}</span>}</>);
          if (it.kind === 'notice') return line('text-zinc-600 italic', oneLine(it.text));
          if (it.kind === 'assistant') return line('text-zinc-200', oneLine(it.text));
          if (it.kind === 'thinking') return line('text-zinc-600 italic', oneLine(it.text));
          if (it.kind === 'tool_use') {
            const result = it.id ? resultFor.get(it.id) : undefined;
            return line('text-sky-400', <>{result?.isError && <span className="text-rose-400">✗ </span>}⚙ {it.name} <span className="text-zinc-500">{oneLine(it.input)}</span></>);
          }
          // a result whose call is on the page is shown with that call
          if (it.kind === 'tool_result') return it.forId && called.has(it.forId) ? null : line(it.isError ? 'text-rose-400' : 'text-zinc-500', <>{it.isError ? '✗ ' : '↳ '}{oneLine(it.content)}</>);
          if (it.kind === 'compact') return line('text-amber-400/80 border-t border-amber-500/20 pt-1 mt-1', <>⇅ context compacted · {Math.round(it.preTokens / 1000)}k → {Math.round(it.postTokens / 1000)}k tokens</>);
          return null;
        })}
        {status && status !== 'finished' && <div className="text-zinc-600 animate-pulse">● {status === 'busy' ? 'working…' : 'waiting for input…'}</div>}
      </div>
      <FullTextDialog value={open} onClose={() => setOpen(null)} />
    </>
  );
}
