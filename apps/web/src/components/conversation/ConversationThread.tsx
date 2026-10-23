import { LoaderCircle, SendHorizontal, Square } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { Conversation, ConversationLive, ConversationMessage } from '../../api.ts';
import type { StreamItem } from '../../store.ts';
import { Button, Textarea, cn, fmtUsd } from '../../ui.tsx';
import { clock } from '../../time.ts';
import { Markdown } from '../Markdown.tsx';

/** the first string in a tool call's input whose key matches, for inputs named differently by each coding agent */
const field = (input: Record<string, unknown>, re: RegExp) => Object.entries(input).find(([k, v]) => re.test(k) && typeof v === 'string' && v)?.[1] as string | undefined;

/** a shell command as the person would type it: Codex wraps every command in its login shell */
export const plainCommand = (c: unknown) => String(c ?? '').replace(/^(?:\/bin\/)?(?:zsh|bash|sh)\s+-lc\s+/, '').replace(/^(['"])([\s\S]*)\1$/, '$2');

/**
 * What the Explainer is doing right now, from its latest tool call: a line under the answer being written. Claude's
 * tools by name; Codex's commands (wrapped by its shell) and Antigravity's (`run_command`, `view_file`, `grep_search`,
 * `find_by_name`, `list_dir`, `read_url_content`…) by what their names and inputs say.
 */
export function describeActivity(ev: { name: string; input: unknown }): string {
  const i = (ev.input && typeof ev.input === 'object' ? ev.input : {}) as Record<string, unknown>;
  const tail = (p: unknown) => String(p ?? '').split('/').filter(Boolean).slice(-2).join('/');
  const short = (s: unknown, n = 80) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
  switch (ev.name) {
    case 'Read':
      return `reading ${tail(i.file_path)}`;
    case 'Grep':
      return `searching for ${short(i.pattern, 60)}`;
    case 'Glob':
      return `looking for ${short(i.pattern, 60)}`;
    case 'LS':
      return `listing ${tail(i.path) || 'the folder'}`;
    case 'Bash':
      return `running ${short(plainCommand(i.command))}`;
    case 'WebFetch':
      return `fetching ${short(i.url, 60)}`;
    case 'WebSearch':
      return `searching the web for ${short(i.query, 60)}`;
    case 'Task':
    case 'Agent':
      return 'a helper agent is reading';
  }
  if (ev.name.startsWith('mcp__')) return `asking ${ev.name.split('__')[1] ?? 'a tool'}`;
  const name = ev.name.toLowerCase();
  const path = field(i, /path|file|dir/i);
  const command = field(i, /command/i);
  const query = field(i, /query|pattern|search/i);
  if (/command|shell|exec/.test(name)) return `running ${short(plainCommand(command ?? Object.values(i).find((v) => typeof v === 'string')))}`;
  if (/read|view|open|cat/.test(name)) return path ? `reading ${tail(path)}` : 'reading a file';
  if (/grep|search|find/.test(name)) return query ? `searching for ${short(query, 60)}` : 'searching';
  if (/list|dir|ls/.test(name)) return `listing ${tail(path) || 'the folder'}`;
  if (/url|fetch|browser|web/.test(name)) return `fetching ${short(field(i, /url/i) ?? query, 60)}`;
  return ev.name;
}

/** the answer being written, from the channel's events since its session began: the whole paragraphs, the words since, and the latest tool call */
export function liveAnswer(items: StreamItem[]): { text: string; activity: string | null; started: boolean } {
  let start = -1;
  items.forEach((it, i) => {
    if (it.event.kind === 'init') start = i;
  });
  if (start < 0) return { text: '', activity: null, started: false };
  const blocks: string[] = [];
  let delta = '';
  let activity: string | null = null;
  for (const it of items.slice(start)) {
    const ev = it.event;
    if (ev.kind === 'text_delta') {
      delta += ev.text;
      activity = null;
    } else if (ev.kind === 'text') {
      blocks.push(ev.text);
      delta = '';
      activity = null;
    } else if (ev.kind === 'tool_use') activity = describeActivity(ev);
  }
  return { text: [...blocks, delta].filter((t) => t.trim()).join('\n\n'), activity, started: true };
}

/** how an answer ended, when not as it should */
const ending = (m: ConversationMessage) => (m.status === 'cut' ? `cut short: ${m.reason ?? 'it ran out'}` : m.status === 'stopped' ? 'stopped' : m.status === 'failed' ? `failed: ${m.reason ?? 'no answer'}` : null);

/**
 * One Conversation: the questions and answers, the answer being written with what the Explainer is reading, and the
 * composer. `readOnly`: an earlier Conversation, read and not continued. Shown in the bubble's window (compact) and on
 * the Conversation tab alike.
 */
export function ConversationThread({ conversation, live, items, readOnly = false, compact = false, busy = false, onAsk, onStop }: { conversation: Conversation | null; live: ConversationLive | undefined; items: StreamItem[]; readOnly?: boolean; compact?: boolean; /** a question is on its way to the server */ busy?: boolean; onAsk: (text: string) => void | Promise<void>; onStop: () => void | Promise<void> }) {
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const messages = conversation?.messages ?? [];
  const answering = live?.answering ?? null;
  const queued = new Set(live?.queued ?? []);
  const answered = new Set(messages.filter((m) => m.role === 'explainer' && m.askedId).map((m) => m.askedId));
  const writing = answering ? liveAnswer(items) : null;
  // the thread opens at its newest message, and follows what is being written unless the person scrolled up to read
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const opened = shown.current !== (conversation?.id ?? null);
    shown.current = conversation?.id ?? null;
    if (opened || el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [conversation?.id, messages.length, writing?.text, writing?.activity]);
  const send = async () => {
    const text = draft.trim();
    if (!text || readOnly || busy) return;
    setDraft('');
    await onAsk(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };
  const working = !!answering || queued.size > 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className={cn('min-h-0 flex-1 overflow-auto', compact ? 'px-3 py-3 space-y-3' : 'px-4 py-4 space-y-4')}>
        {!messages.length && (
          <p className="text-sm leading-relaxed text-ink-faint">
            Ask anything about this goal: why a task was done the way it was, where something lives in the code, what went wrong and when. The Explainer reads the goal's code and Foundry's records of it; it changes nothing.
          </p>
        )}
        {messages.map((m) =>
          m.role === 'person' ? (
            <div key={m.id} className="flex flex-col items-end gap-1">
              <div className="max-w-[88%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-accent/10 px-3 py-2 text-sm text-ink ring-1 ring-inset ring-accent/30 [overflow-wrap:anywhere]">{m.text}</div>
              <div className="text-[11px] text-ink-faint">
                {m.by ? `${m.by} · ` : ''}
                {clock(m.at)}
                {!answered.has(m.id) && answering !== m.id && queued.has(m.id) && <span className="ml-2 rounded-sm bg-sunken px-1.5 py-0.5 font-semibold text-ink-soft ring-1 ring-inset ring-line">waiting its turn</span>}
                {!answered.has(m.id) && answering !== m.id && !queued.has(m.id) && <span className="ml-2 rounded-sm bg-sunken px-1.5 py-0.5 font-semibold text-ink-soft ring-1 ring-inset ring-line">not answered yet</span>}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex flex-col items-start gap-1">
              <div className={cn('max-w-[96%] rounded-xl rounded-bl-sm px-3 py-2 text-sm text-ink ring-1 ring-inset', m.status === 'failed' ? 'bg-bad/5 ring-bad/40' : 'bg-sunken ring-line')}>
                {m.text.trim() ? <Markdown source={m.text} /> : <span className="text-ink-faint">{m.status === 'stopped' ? 'Stopped before it said anything.' : 'No answer came.'}</span>}
              </div>
              <div className="text-[11px] text-ink-faint">
                {clock(m.at)}
                {m.model ? ` · ${m.model.replace(/^claude-/, '')}` : ''}
                {` · ${m.costAvailable ? fmtUsd(m.costUsd) : 'cost unavailable'}`}
                {ending(m) ? <span className={cn('ml-2 rounded-sm px-1.5 py-0.5 font-semibold ring-1 ring-inset', m.status === 'failed' ? 'bg-bad/10 text-bad-ink ring-bad/40' : 'bg-sunken text-ink-soft ring-line')}>{ending(m)}</span> : null}
              </div>
            </div>
          ),
        )}
        {answering && (
          <div className="flex flex-col items-start gap-1" aria-live="polite">
            {writing?.text ? <div className="max-w-[96%] rounded-xl rounded-bl-sm bg-sunken px-3 py-2 text-sm text-ink ring-1 ring-inset ring-line"><Markdown source={writing.text} /></div> : null}
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-work-ink">
              <LoaderCircle size={13} className="motion-safe:animate-spin" aria-hidden="true" />
              {writing?.activity ?? (writing?.started ? 'writing…' : 'reading the goal…')}
            </div>
          </div>
        )}
      </div>
      <div className={cn('shrink-0 border-t border-line', compact ? 'p-2' : 'p-3')}>
        {readOnly ? (
          <p className="text-xs text-ink-faint">An earlier Conversation: read it here; the newest one is the one that goes on.</p>
        ) : (
          <div className="flex items-end gap-2">
            <Textarea rows={compact ? 2 : 3} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} placeholder="Ask about this goal… (Enter sends, Shift+Enter for a new line)" aria-label="Your question" className="min-h-[2.5rem] resize-none" />
            <div className="flex shrink-0 flex-col gap-1.5">
              <Button variant="primary" size="sm" onClick={() => void send()} disabled={!draft.trim() || busy} title="Send (Enter)">
                <SendHorizontal size={14} aria-hidden="true" /> Ask
              </Button>
              {working && (
                <Button variant="danger" size="sm" onClick={() => void onStop()} title="Stop the answer being written; questions waiting their turn are let go">
                  <Square size={12} aria-hidden="true" /> Stop
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
