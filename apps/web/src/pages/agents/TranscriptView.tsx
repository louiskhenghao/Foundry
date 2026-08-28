import type { AgentLogChunk, AgentLogItem, AgentStatus } from '@foundry/engine/agents-types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { cn } from '../../ui.tsx';

const POLL_MS = 2500;

/**
 * Parsed conversation view for a session Foundry did not spawn (or a Task subagent), fed by
 * incremental byte-offset polling of the transcript — only while this component is mounted.
 */
export function TranscriptView({ sessionId, agentId, className }: { sessionId: string; agentId?: string; className?: string }) {
  const [items, setItems] = useState<AgentLogItem[]>([]);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  // pair each tool_use with its result so one collapsible row shows both
  const resultFor = new Map<string, Extract<AgentLogItem, { kind: 'tool_result' }>>();
  for (const it of items) if (it.kind === 'tool_result' && it.forId) resultFor.set(it.forId, it);

  return (
    <div ref={ref} className={cn('mono text-[12px] leading-5 bg-zinc-950 border border-zinc-800 rounded-md p-3 overflow-auto max-h-[70vh] space-y-1', className)}>
      {items.length === 0 && <div className="text-zinc-600">{error ? `log unavailable: ${error}` : status === null ? 'loading…' : 'no renderable output in this transcript…'}</div>}
      {items.map((it, i) => {
        if (it.kind === 'user') return <div key={i} className="text-zinc-100 whitespace-pre-wrap"><span className="text-emerald-500">› </span>{it.text}</div>;
        if (it.kind === 'assistant') return <div key={i} className="text-zinc-200 whitespace-pre-wrap">{it.text}</div>;
        if (it.kind === 'thinking') return <div key={i} className="text-zinc-600 italic whitespace-pre-wrap">{it.text.length > 400 ? `${it.text.slice(0, 400)}…` : it.text}</div>;
        if (it.kind === 'tool_use') return <ToolRow key={i} use={it} result={it.id ? resultFor.get(it.id) : undefined} />;
        if (it.kind === 'tool_result') return it.forId && items.some((o) => o.kind === 'tool_use' && o.id === it.forId) ? null : <div key={i} className={cn('truncate', it.isError ? 'text-rose-400' : 'text-zinc-500')}>{it.isError ? '✗ ' : '↳ '}{it.content.slice(0, 200)}</div>;
        if (it.kind === 'compact') return <div key={i} className="text-amber-400/80 border-t border-amber-500/20 pt-1 mt-1">⇅ context compacted · {Math.round(it.preTokens / 1000)}k → {Math.round(it.postTokens / 1000)}k tokens</div>;
        return null;
      })}
      {status && status !== 'finished' && <div className="text-zinc-600 animate-pulse">● {status === 'busy' ? 'working…' : 'waiting for input…'}</div>}
    </div>
  );
}

function ToolRow({ use, result }: { use: Extract<AgentLogItem, { kind: 'tool_use' }>; result?: Extract<AgentLogItem, { kind: 'tool_result' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-sky-400 hover:text-sky-300 min-w-0 max-w-full">
        {open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
        <span className="shrink-0">⚙ {use.name}</span>
        {!open && <span className="text-zinc-500 truncate">{use.input.slice(0, 140)}</span>}
        {result?.isError && <span className="text-rose-400 shrink-0">✗</span>}
      </button>
      {open && (
        <div className="ml-4 border-l border-zinc-800 pl-2 space-y-1">
          <pre className="text-zinc-500 whitespace-pre-wrap break-all max-h-48 overflow-auto">{use.input}</pre>
          {result && <pre className={cn('whitespace-pre-wrap break-all max-h-64 overflow-auto', result.isError ? 'text-rose-400' : 'text-zinc-400')}>{result.content}</pre>}
        </div>
      )}
    </div>
  );
}
