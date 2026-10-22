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

/** who speaks, as a small plate before the line: you in solid ink; a tool call or a command outlined, in mono */
const ROLE = 'shrink-0 rounded-sm px-1.5 py-px text-[10.5px] font-bold uppercase tracking-[0.08em] leading-4';
const TOOL = 'shrink-0 max-w-[45%] truncate rounded-sm px-1.5 py-px mono text-[11px] font-semibold leading-4 inset-ring-1';

/**
 * Parsed conversation view for a session Foundry did not spawn (or a Task subagent), fed by
 * incremental byte-offset polling of the transcript — only while this component is mounted.
 */
export function TranscriptView({ sessionId, agentId, className }: { sessionId: string; agentId?: string; className?: string }) {
  const [items, setItems] = useState<AgentLogItem[]>([]);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // which entry is open, not a copy of it: a tool result that arrives later shows up in the open window
  const [open, setOpen] = useState<number | null>(null);
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
          else if (c.status !== 'finished') timer = setTimeout(poll, c.status === 'unknown' ? 15_000 : POLL_MS);
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
      {/* prose in the reading face, code (tool calls, their results, commands) in mono; who speaks as a small plate */}
      <div ref={ref} className={cn('surface-card text-[13px] leading-6 bg-panel border border-line rounded-lg p-2 sm:p-3 overflow-auto max-h-[70vh] space-y-px', className)}>
        {items.length === 0 && <div className="px-1.5 text-ink-faint">{error ? `log unavailable: ${error}` : status === null ? 'loading…' : 'no renderable output in this transcript…'}</div>}
        {error && items.length > 0 && <div className="px-1.5 text-bad-ink">Could not refresh this conversation: {error}</div>}
        {items.map((it, i) => {
          // one line per entry, like the live log; entries with more behind them are buttons that open the full text
          const line = (cls: string, node: ReactNode, plate?: ReactNode) => {
            const full = fullOf(it, resultFor);
            const body = <span className="min-w-0 flex-1 truncate">{node}</span>;
            if (!full) return <div key={i} className={cn('flex items-center gap-2 min-w-0 rounded-md px-1.5', cls)}>{plate}{body}</div>;
            return (
              <button key={i} type="button" onClick={() => setOpen(i)} title="Show the full message" className={cn('log-row flex items-center gap-2 min-w-0 w-full text-left rounded-md px-1.5 hover:bg-line/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent cursor-pointer', cls)}>
                {plate}
                {body}
              </button>
            );
          };
          if (it.kind === 'user') return line('my-1 py-1 bg-sunken font-medium text-ink', oneLine(it.text), <span className={cn(ROLE, 'bg-ink text-on-ink')}>you</span>);
          if (it.kind === 'command') return line('mono text-[12px] text-ink-soft', it.args && oneLine(it.args), <span className={cn(TOOL, 'inset-ring-extra/50 text-extra-ink')}>/{it.name}</span>);
          if (it.kind === 'notice') return line('italic text-ink-faint', oneLine(it.text));
          if (it.kind === 'assistant') return line('text-ink', oneLine(it.text));
          if (it.kind === 'thinking') return line('italic text-ink-faint', oneLine(it.text));
          if (it.kind === 'tool_use') {
            const result = it.id ? resultFor.get(it.id) : undefined;
            const plate = (
              <>
                {result?.isError && <span className="shrink-0 font-bold text-bad-ink">✗</span>}
                <span className={cn(TOOL, result?.isError ? 'inset-ring-bad/60 text-bad-ink' : 'inset-ring-line-strong text-ink')}>⚙ {it.name}</span>
              </>
            );
            return line('mono text-[12px] text-ink-faint', oneLine(it.input), plate);
          }
          // a result whose call is on the page is shown with that call
          if (it.kind === 'tool_result') return it.forId && called.has(it.forId) ? null : line(cn('mono text-[12px]', it.isError ? 'text-bad-ink' : 'text-ink-faint'), <>{it.isError ? '✗ ' : '↳ '}{oneLine(it.content)}</>);
          if (it.kind === 'compact') return line('mono text-[12px] text-ink-soft border-t border-dashed border-line-strong rounded-none pt-1 mt-1.5', <>⇅ context compacted · {Math.round(it.preTokens / 1000)}k → {Math.round(it.postTokens / 1000)}k tokens</>);
          return null;
        })}
        {status && status !== 'finished' && (
          <div className="px-1.5 pt-1 text-ink-faint">
            {status === 'unknown' ? (
              'Live process state unknown · checking for new history periodically'
            ) : (
              <>
                {/* still working: the dot pulses in ink */}
                <span className={cn(status === 'busy' ? 'text-ink animate-pulse' : 'text-ink-faint')}>●</span> {status === 'busy' ? 'working…' : 'waiting for input…'}
              </>
            )}
          </div>
        )}
      </div>
      <FullTextDialog value={open !== null && items[open] ? fullOf(items[open]!, resultFor) : null} onClose={() => setOpen(null)} />
    </>
  );
}
