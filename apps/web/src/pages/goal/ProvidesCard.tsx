import type { Attachment, BriefProvide } from '@foundry/core/browser';
import { CheckCircle2, Clock, PackageOpen } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api.ts';
import { AttachmentInput, AttachmentList } from '../../components/Attachments.tsx';
import { Button, Card, Textarea, cn } from '../../ui.tsx';
import { HelpLink } from '../HelpPage.tsx';

/** a material's state in one chip */
function Status({ p }: { p: BriefProvide }) {
  if (p.status === 'received') return <span className="inline-flex items-center gap-1 rounded-sm bg-ok/12 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-ok-ink ring-1 ring-inset ring-ok/40"><CheckCircle2 size={11} aria-hidden="true" /> received</span>;
  if (p.status === 'waived') return <span className="rounded-sm bg-sunken px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-soft ring-1 ring-inset ring-line">none</span>;
  return <span className="inline-flex items-center gap-1 rounded-sm bg-you/20 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-you-ink ring-1 ring-inset ring-you/55"><Clock size={11} aria-hidden="true" /> waiting for you</span>;
}

/**
 * What the person said they would provide (ADR-0074): each material with the tasks that need it, the mode (wait, or
 * build with a placeholder first) — a choice while the Brief can still change — and a slot to give it: files and
 * links, a word, or "I have none". Giving it answers the Request waiting for it and lets the task go on.
 */
export function ProvidesCard({ goalId, provides, attachments, taskTitles, editableMode = false, onMode, compact = false }: { goalId: string; provides: BriefProvide[]; /** the goal's attachments, for what a received material came as */ attachments: Attachment[]; /** task titles by key, when the plan exists */ taskTitles?: Record<string, string>; editableMode?: boolean; onMode?: (key: string, mode: BriefProvide['mode']) => void; compact?: boolean }) {
  if (!provides.length) return null;
  const title = (
    <span className="flex items-start gap-1.5">
      <span className="flex items-center gap-1.5">
        <PackageOpen size={14} aria-hidden="true" /> You will provide{provides.some((p) => p.status === 'waiting') ? ` (${provides.filter((p) => p.status === 'waiting').length} waiting)` : ''}
      </span>
      <HelpLink to="approving-the-brief#you-will-provide" className="mt-0.5 shrink-0" />
    </span>
  );
  return (
    <Card title={title} bodyClassName={compact ? '!p-3' : undefined}>
      <ul className="space-y-3">
        {provides.map((p) => (
          <ProvideRow key={p.key} goalId={goalId} p={p} attachments={attachments} taskTitles={taskTitles} editableMode={editableMode} onMode={onMode} />
        ))}
      </ul>
    </Card>
  );
}

function ProvideRow({ goalId, p, attachments, taskTitles, editableMode, onMode }: { goalId: string; p: BriefProvide; attachments: Attachment[]; taskTitles?: Record<string, string>; editableMode: boolean; onMode?: (key: string, mode: BriefProvide['mode']) => void }) {
  const [given, setGiven] = useState<Attachment[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const came = attachments.filter((a) => a.materialKey === p.key || p.attachmentIds.includes(a.id));
  const send = async (waived: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      await api.receiveMaterial(goalId, p.key, { attachments: waived ? [] : given, note: note.trim() || null, waived });
      setGiven([]);
      setNote('');
      setOpen(false);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const needed = p.neededBy.map((k) => taskTitles?.[k] ?? k);
  return (
    <li className="rounded-md border border-line bg-sunken p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{p.what}</span>
        <Status p={p} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
        {needed.length > 0 && <span>needed by {needed.join(', ')}</span>}
        {editableMode && onMode ? (
          <span className="flex items-center gap-2" title="wait: the tasks that need it do not start before it arrives · placeholder: they build with a stand-in and a swap-in task follows">
            {(['wait', 'placeholder'] as const).map((m) => (
              <label key={m} className="flex items-center gap-1 text-ink-soft">
                <input type="radio" name={`mode-${p.key}`} checked={p.mode === m} onChange={() => onMode(p.key, m)} /> {m === 'wait' ? 'wait for it' : 'placeholder first'}
              </label>
            ))}
          </span>
        ) : (
          <span>{p.mode === 'wait' ? 'the tasks wait for it' : 'built with a placeholder first'}</span>
        )}
        {p.receivedAt && <span>{new Date(p.receivedAt).toLocaleString()}</span>}
        {p.note && <span className="text-ink-soft">“{p.note}”</span>}
      </div>
      {came.length > 0 && (
        <div className="mt-2">
          <AttachmentList items={came} goalId={goalId} compact />
        </div>
      )}
      {p.status === 'waiting' && (
        <div className="mt-2">
          {!open ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
                Give it
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void send(true)} title="There is none: the tasks go on with a stand-in">
                I have none
              </Button>
            </div>
          ) : (
            <div className={cn('space-y-2 rounded-md border border-line bg-panel p-2', busy && 'opacity-60')}>
              <AttachmentInput items={given} onChange={setGiven} />
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A word with it (optional): which file is which, what to watch for…" className="resize-y" />
              {err && <p className="text-xs text-bad-ink">{err}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" disabled={busy} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" variant="primary" disabled={busy || (!given.length && !note.trim())} onClick={() => void send(false)}>
                  Send
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
