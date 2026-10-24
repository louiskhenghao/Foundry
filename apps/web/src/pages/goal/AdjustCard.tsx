import type { Attachment } from '@foundry/core/browser';
import { ADJUST_ATTACHMENTS_MAX, reportsDollars } from '@foundry/core/browser';
import { Paperclip, SlidersHorizontal } from 'lucide-react';
import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type AdjustView, type GoalDetail } from '../../api.ts';
import { AttachmentList, previews } from '../../components/Attachments.tsx';
import { BetaChip } from '../../components/conversation/ConversationBubble.tsx';
import { Button, Card, cn, fmtUsd } from '../../ui.tsx';

const FINISHED = new Set(['done', 'over_delivered', 'failed']);
const MODE_LABEL: Record<NonNullable<AdjustView['mode']>, string> = { resume: 'the finished task carried on', task: 'a task was appended', restart: 'the failed tasks ran again' };
const firstLine = (text: string, max = 90): string => {
  const line = text.split('\n').find((l) => l.trim())?.trim() ?? text.trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};
const basename = (p: string) => p.split('/').pop() ?? p;

/**
 * Adjust the result (ADR-0077, beta): on a finished goal, the person says what should change, with pictures or files, and
 * the goal carries it out itself — the finished task's session resumed, a task appended, or the failed tasks run again.
 * Below the box, the Adjustments made so far, each with the version of the result kept before it.
 */
export function AdjustCard({ d, onChanged }: { d: GoalDetail; onChanged?: () => void }) {
  const g = d.goal;
  const view = d.adjust;
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  if (!view?.enabled) return null;
  const finished = FINISHED.has(g.state);
  if (!finished && !view.history.length) return null;
  const addFiles = async (list: FileList | File[]) => {
    setUploadError(null);
    const room = ADJUST_ATTACHMENTS_MAX - files.length;
    const picked = Array.from(list);
    if (picked.length > room) setUploadError(`an adjustment takes at most ${ADJUST_ATTACHMENTS_MAX} files`);
    for (const f of picked.slice(0, Math.max(0, room))) {
      setUploading((n) => n + 1);
      try {
        const a = await api.upload(f);
        if (f.type.startsWith('image/')) previews.set(a.id, URL.createObjectURL(f));
        setFiles((cur) => (cur.length < ADJUST_ATTACHMENTS_MAX ? [...cur, a] : cur));
      } catch (e: any) {
        setUploadError(`${f.name}: ${e.message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const canSend = view.can && !busy && uploading === 0 && !!text.trim();
  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    setErr(null);
    try {
      await api.adjust(g.id, { text: text.trim(), attachments: files });
      setText('');
      setFiles([]);
      onChanged?.();
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    } finally {
      setBusy(false);
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
  const remaining = d.budget.remainingUsd;
  const budgetLine = !reportsDollars(g.provider) ? 'It costs the goal, inside its budget.' : remaining == null ? 'It costs the goal; this goal has no cost limit.' : `It costs the goal, inside its budget: ${fmtUsd(remaining)} left of ${fmtUsd(g.budgets.maxCostUsd ?? 0)}.`;
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal size={15} aria-hidden="true" /> Adjust the result <BetaChip />
        </span>
      }
    >
      {finished && view.can && (
        <>
          <p className="mb-2 text-sm text-ink-soft">
            Say what should change in the result, with pictures or files if they help. The goal carries it out itself{view.mode === 'resume' ? ': the session that did the work picks up where it left off' : view.mode === 'task' ? ': a task is added after the finished ones' : view.mode === 'restart' ? ': the failed tasks run again with your words' : ''}, and the checks and reviews run again.
          </p>
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
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={onPaste}
              placeholder={`What should change? (adjustment ${view.next})`}
              aria-label="What should change"
              className="block w-full min-h-[4.5rem] max-h-64 resize-y bg-transparent px-3 pt-2.5 pb-1 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <div className="flex items-center gap-1.5 px-1.5 pb-1.5">
              <button type="button" onClick={() => picker.current?.click()} disabled={busy || files.length >= ADJUST_ATTACHMENTS_MAX} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-soft transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40" title="Attach pictures or files; pasting or dropping them here works too" aria-label="Attach files">
                <Paperclip size={15} aria-hidden="true" />
              </button>
              <input ref={picker} type="file" multiple className="hidden" onChange={(e) => e.target.files && void addFiles(e.target.files).then(() => (e.target.value = ''))} />
              {uploading > 0 && <span className="text-[11px] text-ink-faint">uploading…</span>}
              {uploadError && <span className="min-w-0 truncate text-[11px] text-bad-ink">{uploadError}</span>}
              {err && <span className="min-w-0 truncate text-[11px] text-bad-ink">{err}</span>}
              <span className="flex-1" />
              <Button size="sm" variant="primary" disabled={!canSend} onClick={() => void send()} title="The goal runs again with your words">
                {busy ? 'Starting…' : 'Adjust'}
              </Button>
            </div>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-faint">{budgetLine} The result as it is now is kept, so you can go back to it.</p>
        </>
      )}
      {finished && !view.can && view.reason && (
        <p className="text-sm text-ink-soft">
          Not now: {view.reason}.{' '}
          {/merged|follow-up|progress folder/.test(view.reason) && (
            <Link to={`/goals/new?follows=${g.id}`} className="font-semibold text-work-ink hover:underline">
              Continue with a follow-up…
            </Link>
          )}
        </p>
      )}
      {view.history.length > 0 && (
        <div className={cn(finished && 'mt-4')}>
          <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint">Adjustments</div>
          <ol className="mt-1.5 space-y-2 text-sm">
            {view.history.map((a) => (
              <li key={a.id} className="min-w-0">
                <span className="font-semibold text-ink">{a.n}.</span> <span className="text-ink" title={a.text}>{firstLine(a.text)}</span>
                <span className="block text-[11px] text-ink-faint">
                  {MODE_LABEL[a.mode]} · {new Date(a.at).toLocaleString()}
                  {a.by ? ` · ${a.by}` : ''}
                  {a.attachmentIds.length ? ` · ${a.attachmentIds.length} file${a.attachmentIds.length === 1 ? '' : 's'}` : ''}
                </span>
                {a.files.length > 0 && (
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-faint">
                    <span>Before it:</span>
                    {a.files.map((f) => (
                      <a key={f} href={api.artifactUrl(g.id, `.history/${a.n}/${f}`)} target="_blank" rel="noreferrer" className="mono text-ink-soft hover:text-ink hover:underline" title={f}>
                        {basename(f)}
                      </a>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}
