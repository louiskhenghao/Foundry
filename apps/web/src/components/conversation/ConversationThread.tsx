import type { Attachment } from '@foundry/core/browser';
import { CONVERSATION_ATTACHMENTS_MAX, attachmentKindLabel, withoutProposalBlocks } from '@foundry/core/browser';
import { LoaderCircle, Paperclip, SendHorizontal, Square } from 'lucide-react';
import { type ClipboardEvent, type DragEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { api } from '../../api.ts';
import type { Conversation, ConversationLive, ConversationMessage } from '../../api.ts';
import type { StreamItem } from '../../store.ts';
import { Button, cn, fmtUsd } from '../../ui.tsx';
import { clock } from '../../time.ts';
import { AttachmentList, previews } from '../Attachments.tsx';
import { Markdown } from '../Markdown.tsx';
import { ProposalCard } from './ProposalCard.tsx';

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
  const text = [...blocks, delta].filter((t) => t.trim()).join('\n\n');
  // a proposal block being written is not words for the person: the card comes with the finished answer
  return { text: withoutProposalBlocks(text).replace(/```foundry-proposal[\s\S]*$/, '').trimEnd(), activity, started: true };
}

/** how an answer ended, when not as it should */
const ending = (m: ConversationMessage) => (m.status === 'cut' ? `cut short: ${m.reason ?? 'it ran out'}` : m.status === 'stopped' ? 'stopped' : m.status === 'failed' ? `failed: ${m.reason ?? 'no answer'}` : null);

/** three ways into an empty Conversation; each is sent as it stands */
export const STARTER_QUESTIONS = ['Summarise what this goal did, and why.', 'Which task was the hardest, and why?', 'Where in the code did the changes land?'];

/** the thread's measure: prose reads best under about 90 characters a line, whatever the card's width */
const COLUMN = 'mx-auto w-full max-w-[44rem]';

/** what the person attached to a question: pictures shown, the rest as chips; all open from the goal's attachments */
function QuestionFiles({ goalId, items }: { goalId: string; items: Attachment[] }) {
  const pictures = items.filter((a) => attachmentKindLabel(a) === 'image');
  const rest = items.filter((a) => attachmentKindLabel(a) !== 'image');
  return (
    <div className="flex max-w-[85%] flex-col items-end gap-1.5">
      {pictures.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {pictures.map((a) => (
            <a key={a.id} href={api.attachmentUrl(goalId, a.id)} target="_blank" rel="noreferrer" title={a.name} className="block overflow-hidden rounded-lg border border-line bg-sunken">
              <img src={api.attachmentUrl(goalId, a.id)} alt={a.name} className="max-h-44 max-w-full object-contain" />
            </a>
          ))}
        </div>
      )}
      {rest.length > 0 && <AttachmentList items={rest} goalId={goalId} compact />}
    </div>
  );
}

/**
 * One Conversation: the questions and answers, the answer being written with what the Explainer is reading, and the
 * composer, which takes pictures and files too (the clip, a paste, a drop). `readOnly`: an earlier Conversation, read
 * and not continued. Shown in the bubble's window (compact) and on the Conversation tab alike; on the tab the thread
 * keeps to a readable column in the middle of the card.
 */
export function ConversationThread({ conversation, live, items, readOnly = false, compact = false, busy = false, onAsk, onStop }: { conversation: Conversation | null; live: ConversationLive | undefined; items: StreamItem[]; readOnly?: boolean; compact?: boolean; /** a question is on its way to the server */ busy?: boolean; onAsk: (text: string, attachments: Attachment[]) => void | Promise<void>; onStop: () => void | Promise<void> }) {
  const [draft, setDraft] = useState('');
  /** uploads already staged on the server, waiting to go with the next question */
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // the composer grows with the draft, one line to about eight
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [draft, readOnly]);
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
  const addFiles = async (list: FileList | File[]) => {
    setUploadError(null);
    const room = CONVERSATION_ATTACHMENTS_MAX - files.length;
    const picked = Array.from(list);
    if (picked.length > room) setUploadError(`a question takes at most ${CONVERSATION_ATTACHMENTS_MAX} files`);
    for (const f of picked.slice(0, Math.max(0, room))) {
      setUploading((n) => n + 1);
      try {
        const a = await api.upload(f);
        if (f.type.startsWith('image/')) previews.set(a.id, URL.createObjectURL(f));
        setFiles((cur) => (cur.length < CONVERSATION_ATTACHMENTS_MAX ? [...cur, a] : cur));
      } catch (e: any) {
        setUploadError(`${f.name}: ${e.message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const canSend = !readOnly && !busy && uploading === 0 && (!!draft.trim() || files.length > 0);
  const send = async () => {
    if (!canSend) return;
    const text = draft.trim();
    const attachments = files;
    setDraft('');
    setFiles([]);
    setUploadError(null);
    await onAsk(text, attachments);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(e.clipboardData?.files ?? []);
    if (!pasted.length) return;
    e.preventDefault();
    void addFiles(pasted);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
  };
  const working = !!answering || queued.size > 0;
  const prose = compact ? 'text-sm' : 'text-[15px] leading-relaxed';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className={cn('min-h-0 flex-1 overflow-auto', compact ? 'px-3 py-3' : 'px-5 py-5')}>
        <div className={cn(COLUMN, compact ? 'space-y-3' : 'space-y-5')}>
        {!messages.length && !readOnly && (
          <div className={cn('space-y-3', compact ? 'pt-1' : 'pt-6')}>
            <p className={cn('text-ink-faint', prose)}>
              Ask anything about this goal: why a task was done the way it was, where something lives in the code, what went wrong and when. The Explainer reads the goal's code and Foundry's records of it; it changes nothing.
            </p>
            <div className="flex flex-wrap gap-2">
              {STARTER_QUESTIONS.map((q) => (
                <button key={q} type="button" disabled={busy} onClick={() => void onAsk(q, [])} className="rounded-full border border-line-strong bg-panel px-3 py-1.5 text-left text-[13px] font-semibold text-ink-soft transition-colors hover:border-accent hover:text-ink disabled:opacity-40">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'person' ? (
            <div key={m.id} className="flex flex-col items-end gap-1">
              <div className={cn('max-w-[85%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-accent/10 px-3.5 py-2 text-ink ring-1 ring-inset ring-accent/30 [overflow-wrap:anywhere]', prose)}>{m.text}</div>
              {m.attachments?.length && conversation ? <QuestionFiles goalId={conversation.goalId} items={m.attachments} /> : null}
              <div className="text-[11px] text-ink-faint">
                {m.by ? `${m.by} · ` : ''}
                {clock(m.at)}
                {!answered.has(m.id) && answering !== m.id && queued.has(m.id) && <span className="ml-2 rounded-sm bg-sunken px-1.5 py-0.5 font-semibold text-ink-soft ring-1 ring-inset ring-line">waiting its turn</span>}
                {!answered.has(m.id) && answering !== m.id && !queued.has(m.id) && <span className="ml-2 rounded-sm bg-sunken px-1.5 py-0.5 font-semibold text-ink-soft ring-1 ring-inset ring-line">not answered yet</span>}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex flex-col items-start gap-1">
              <div className={cn('max-w-full rounded-xl rounded-bl-sm px-3.5 py-2.5 text-ink ring-1 ring-inset', prose, m.status === 'failed' ? 'bg-bad/5 ring-bad/40' : 'bg-sunken ring-line')}>
                {m.text.trim() ? <Markdown source={withoutProposalBlocks(m.text) || m.text} /> : <span className="text-ink-faint">{m.status === 'stopped' ? 'Stopped before it said anything.' : 'No answer came.'}</span>}
              </div>
              {/* what it proposed: cards the person applies (ADR-0075) */}
              {(m.proposals?.length ?? 0) > 0 && conversation && (
                <div className="flex w-full max-w-full flex-col gap-2 pl-1">
                  {m.proposals!.map((p) => (
                    <ProposalCard key={p.id} goalId={conversation.goalId} conversationId={conversation.id} proposal={p} compact={compact} />
                  ))}
                </div>
              )}
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
            {writing?.text ? <div className={cn('max-w-full rounded-xl rounded-bl-sm bg-sunken px-3.5 py-2.5 text-ink ring-1 ring-inset ring-line', prose)}><Markdown source={writing.text} /></div> : null}
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-work-ink">
              <LoaderCircle size={13} className="motion-safe:animate-spin" aria-hidden="true" />
              {writing?.activity ?? (writing?.started ? 'writing…' : 'reading the goal…')}
            </div>
          </div>
        )}
        </div>
      </div>
      <div className={cn('shrink-0 border-t border-line', compact ? 'p-2' : 'px-5 py-3')}>
        {readOnly ? (
          <p className={cn(COLUMN, 'text-xs text-ink-faint')}>An earlier Conversation: read it here; the newest one is the one that goes on.</p>
        ) : (
          <div className={COLUMN}>
            {/* one box: the files going with the question, the words, and the clip and the send button on one row below them */}
            <div
              className={cn('rounded-xl border bg-panel transition-colors', drag ? 'border-accent ring-2 ring-accent/30' : 'border-line-strong focus-within:border-accent')}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
            >
              {files.length > 0 && (
                <div className="px-2 pt-2">
                  <AttachmentList items={files} compact onRemove={(a) => setFiles((cur) => cur.filter((x) => x.id !== a.id))} />
                </div>
              )}
              <textarea
                ref={box}
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                onPaste={onPaste}
                placeholder={files.length ? 'Say what to look at in them… (or just send)' : 'Ask about this goal…'}
                aria-label="Your question"
                className="block w-full min-h-[2.5rem] max-h-48 resize-none overflow-auto bg-transparent px-3 pt-2.5 pb-1 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
              />
              <div className="flex items-center gap-1.5 px-1.5 pb-1.5">
                <button type="button" onClick={() => picker.current?.click()} disabled={busy || files.length >= CONVERSATION_ATTACHMENTS_MAX} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-soft transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40" title="Attach pictures or files; pasting or dropping them here works too" aria-label="Attach files">
                  <Paperclip size={15} aria-hidden="true" />
                </button>
                <input ref={picker} type="file" multiple className="hidden" onChange={(e) => e.target.files && void addFiles(e.target.files).then(() => (e.target.value = ''))} />
                {uploading > 0 && <span className="text-[11px] text-ink-faint">uploading…</span>}
                {uploadError && <span className="min-w-0 truncate text-[11px] text-bad-ink">{uploadError}</span>}
                <span className="flex-1" />
                {working && (
                  <Button variant="danger" size="sm" onClick={() => void onStop()} title="Stop the answer being written; questions waiting their turn are let go">
                    <Square size={12} aria-hidden="true" /> Stop
                  </Button>
                )}
                <button type="button" onClick={() => void send()} disabled={!canSend} aria-label="Ask" title="Send (Enter)" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-on-accent transition hover:bg-accent/85 disabled:cursor-not-allowed disabled:opacity-40">
                  <SendHorizontal size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
            {!compact && <p className="mt-1.5 text-[11px] text-ink-faint">Enter sends · Shift+Enter for a new line · pictures and files can be pasted or dropped in</p>}
          </div>
        )}
      </div>
    </div>
  );
}
