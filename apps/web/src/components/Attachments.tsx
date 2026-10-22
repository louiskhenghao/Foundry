import type { Attachment } from '@foundry/core/browser';
import { attachmentKindLabel } from '@foundry/core/browser';
import { ExternalLink, File as FileIcon, FileText, Image as ImageIcon, Link2, Paperclip, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { Button, Input, Modal, chipClass, cn, code, focusFirst } from '../ui.tsx';
import { MarkdownPanel } from './Markdown.tsx';

/**
 * Viewer for one attachment: the markdown rendition (what sessions read) and/or the original
 * (image, PDF, text inline; anything else opens in a new tab).
 */
export function AttachmentViewer({ a, goalId, onClose }: { a: Attachment; goalId?: string; onClose: () => void }) {
  const kind = attachmentKindLabel(a);
  const hasMd = a.markdown?.status === 'ready';
  const original = a.kind === 'link' ? a.url! : goalId ? api.attachmentUrl(goalId, a.id) : previews.get(a.id) ?? null;
  const inline = kind === 'image' ? 'image' : kind === 'pdf' ? 'pdf' : kind === 'text' || (a.mime ?? '').startsWith('text/') ? 'text' : null;
  const [tab, setTab] = useState<'markdown' | 'original'>(hasMd ? 'markdown' : 'original');
  const [md, setMd] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (tab === 'markdown' && hasMd && md === null) api.attachmentMarkdown(goalId ?? null, a.id).then(setMd).catch((e) => setErr(e.message));
    if (tab === 'original' && inline === 'text' && original && text === null) fetch(original).then((r) => r.text()).then(setText).catch((e) => setErr(e.message));
  }, [tab]);
  const tabBtn = (id: 'markdown' | 'original', label: string, enabled: boolean) => (
    <button type="button" disabled={!enabled} onClick={() => setTab(id)} className={cn(chipClass(tab === id), !enabled && 'opacity-40 cursor-not-allowed')}>
      {label}
    </button>
  );
  return (
    <Modal open title={<span className="flex items-center gap-2 min-w-0"><AttachmentIcon a={a} /> <span className="truncate">{a.name}</span></span>} onClose={onClose} wide>
      <div className="flex items-center gap-1 mb-3 flex-wrap">
        {tabBtn('markdown', `Markdown${a.markdown?.bytes != null ? ` · ${fmtSize(a.markdown.bytes)}` : ''}`, hasMd)}
        {tabBtn('original', a.kind === 'link' ? 'Link' : 'Original', !!original)}
        {/* the conversion as it stands: under way blue, failed red */}
        {!hasMd && a.markdown?.status && a.markdown.status !== 'skipped' && <span className={cn('text-[11px] font-semibold ml-1', a.markdown.status === 'pending' ? 'text-work-ink' : 'text-bad-ink')}>{a.markdown.status === 'pending' ? 'markdown is being converted…' : `markdown conversion failed${a.markdown.error ? `: ${a.markdown.error}` : ''}`}</span>}
        {original && (
          <a href={original} target="_blank" rel="noreferrer" className="ml-auto min-h-8 sm:min-h-0 text-xs underline text-ink-soft hover:text-ink flex items-center gap-1">
            <ExternalLink size={12} /> open {a.kind === 'link' ? 'link' : 'original'}
          </a>
        )}
      </div>
      {err && <div className="text-xs text-bad-ink mb-2">{err}</div>}
      {tab === 'markdown' && (md === null ? <div className="text-xs text-ink-faint">loading…</div> : <MarkdownPanel source={md} title="what sessions read" maxHeight="70vh" local />)}
      {tab === 'original' && original && (
        <>
          {inline === 'image' && <img src={original} alt={a.name} className="max-h-[70vh] max-w-full rounded border border-line mx-auto" />}
          {inline === 'pdf' && <iframe src={original} title={a.name} className="w-full h-[70vh] rounded border border-line bg-white" />}
          {inline === 'text' && (text === null ? <div className="text-xs text-ink-faint">loading…</div> : <pre className="mono text-xs text-ink whitespace-pre-wrap max-h-[70vh] overflow-auto rounded-md border border-line bg-sunken p-3">{text}</pre>)}
          {inline === null && (
            <div className="text-sm text-ink-soft">
              This file type cannot be previewed here.{' '}
              <a href={original} target="_blank" rel="noreferrer" className="underline text-ink">
                Open {a.kind === 'link' ? 'the link' : 'the original'} in a new tab
              </a>
              .
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

const fmtSize = (n: number | null) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Local preview URL for staged images (before the goal exists) keyed by attachment id. */
const previews = new Map<string, string>();

/**
 * Each kind of attachment in a category colour of its own (ADR-0067), the hues the kinds had before themes: images blue,
 * links green, office documents violet, PDFs rose; plain text and any other file in ink.
 */
const KIND_INK: Record<ReturnType<typeof attachmentKindLabel>, string> = { image: code(0).ink, link: code(1).ink, document: code(2).ink, pdf: code(4).ink, text: 'text-ink-soft', file: 'text-ink-soft' };

export function AttachmentIcon({ a, size = 14 }: { a: Attachment; size?: number }) {
  const k = attachmentKindLabel(a);
  const I = k === 'image' ? ImageIcon : k === 'link' ? Link2 : k === 'text' || k === 'pdf' || k === 'document' ? FileText : FileIcon;
  return <I size={size} className={KIND_INK[k]} />;
}

/** Conversion-state tag for the markdown rendition (markitdown): converting blue, ready green, failed red. */
function MarkdownTag({ a, goalId, onReconvert }: { a: Attachment; goalId?: string; onReconvert?: () => void }) {
  const md = a.markdown;
  if (!md || md.status === 'skipped') return null;
  if (md.status === 'pending') return <span className="text-[11px] font-semibold text-work-ink animate-pulse">converting…</span>;
  if (md.status === 'ready')
    return (
      <span className="text-[11px] font-semibold text-ok-ink" title={`${md.tool ?? 'markitdown'} · sessions read this markdown instead of the original${md.error ? ` · ${md.error}` : ''}`}>
        md {fmtSize(md.bytes)}
        {md.bytes != null && md.bytes < 200 ? ' (nearly empty)' : ''}
      </span>
    );
  return (
    <span className="text-[11px] font-semibold text-bad-ink" title={md.error ?? 'conversion failed'}>
      md failed
      {goalId && onReconvert && (
        <button className="underline ml-1" onClick={(e) => { e.preventDefault(); onReconvert(); }}>
          retry
        </button>
      )}
    </span>
  );
}

/** Thumbnail grid / list of attachments. `goalId` makes files openable; without it only staged previews are shown. */
export function AttachmentList({ items, goalId, onRemove, onReconvert, compact }: { items: Attachment[]; goalId?: string; onRemove?: (a: Attachment) => void; onReconvert?: (a: Attachment) => void; compact?: boolean }) {
  const [view, setView] = useState<Attachment | null>(null);
  if (!items.length) return null;
  const current = view ? (items.find((x) => x.id === view.id) ?? view) : null;
  return (
    <div className={cn('flex flex-wrap gap-2', compact && 'gap-1.5')}>
      {current && <AttachmentViewer a={current} goalId={goalId} onClose={() => setView(null)} />}
      {items.map((a) => {
        const kind = attachmentKindLabel(a);
        const href = a.kind === 'link' ? a.url! : goalId ? api.attachmentUrl(goalId, a.id) : previews.get(a.id) ?? null;
        const thumb = kind === 'image' ? href : null;
        const inner = (
          <>
            {thumb ? <img src={thumb} alt={a.name} className="h-14 w-14 object-cover rounded border border-line shrink-0" /> : <span className="h-14 w-14 rounded border border-line bg-panel flex items-center justify-center shrink-0">{<AttachmentIcon a={a} size={20} />}</span>}
            <span className="min-w-0 flex flex-col justify-center">
              <span className="text-xs font-semibold text-ink truncate sm:max-w-[11rem]" title={a.kind === 'link' ? a.url! : a.name}>
                {a.name}
              </span>
              <span className="text-[11px] text-ink-faint truncate sm:max-w-[11rem]">
                {kind}
                {a.size != null ? ` · ${fmtSize(a.size)}` : ''}
                {a.note ? ` · ${a.note}` : ''}
              </span>
              <MarkdownTag a={a} goalId={goalId} onReconvert={onReconvert ? () => onReconvert(a) : undefined} />
            </span>
          </>
        );
        // a row the width of the list on a phone; open and remove sit in the row, a thumb's size there (remove used to
        // show only under a hovering pointer, which a phone has not)
        return (
          <div key={a.id} className="flex w-full sm:w-auto items-center gap-1 rounded-md border border-line bg-sunken p-1.5 hover:border-line-strong">
            <button type="button" onClick={() => setView(a)} className="mr-1 flex min-w-0 flex-1 items-center gap-2 text-left" title={a.markdown?.status === 'ready' ? 'view the extracted markdown or the original' : 'view'}>
              {inner}
            </button>
            {href && (
              <a href={href} target="_blank" rel="noreferrer" className="grid h-8 w-8 sm:h-6 sm:w-6 shrink-0 place-items-center rounded-md text-ink-faint hover:bg-panel hover:text-ink" title={a.kind === 'link' ? 'open link' : 'open original in a new tab'}>
                <ExternalLink size={12} />
              </a>
            )}
            {onRemove && (
              <button className="grid w-8 sm:h-6 sm:w-6 shrink-0 place-items-center rounded-md text-ink-faint hover:bg-panel hover:text-bad-ink" title="remove" aria-label="remove" onClick={() => onRemove(a)}>
                <X size={12} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Drop zone + paste handler + file button + "add link". Uploads immediately (staged when no goalId)
 * and reports the resulting Attachment records via onChange.
 */
export function AttachmentInput({ items, onChange, goalId, className }: { items: Attachment[]; onChange: (next: Attachment[]) => void; goalId?: string; className?: string }) {
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const addFiles = async (files: FileList | File[]) => {
    setErr(null);
    for (const f of Array.from(files)) {
      const key = `${f.name}-${f.size}-${Date.now()}`;
      setProgress((p) => ({ ...p, [key]: 0 }));
      try {
        const a = await api.upload(f, { goalId, onProgress: (pct) => setProgress((p) => ({ ...p, [key]: pct })) });
        if (f.type.startsWith('image/')) previews.set(a.id, URL.createObjectURL(f));
        onChange([...itemsRef.current, a]);
      } catch (e: any) {
        setErr(`${f.name}: ${e.message}`);
      } finally {
        setProgress((p) => {
          const { [key]: _, ...rest } = p;
          return rest;
        });
      }
    }
  };
  const addLink = async () => {
    const url = link.trim();
    if (!url) return;
    setErr(null);
    try {
      const a = await api.addLink(/^https?:\/\//i.test(url) ? url : `https://${url}`, { goalId });
      onChange([...itemsRef.current, a]);
      setLink('');
      setLinkOpen(false);
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const remove = async (a: Attachment) => {
    if (goalId) {
      try {
        await api.removeAttachment(goalId, a.id);
      } catch (e: any) {
        return setErr(e.message);
      }
    }
    onChange(itemsRef.current.filter((x) => x.id !== a.id));
  };
  const reconvert = async (a: Attachment) => {
    if (!goalId) return;
    onChange(itemsRef.current.map((x) => (x.id === a.id ? { ...x, markdown: { status: 'pending', path: null, bytes: null, tool: null, error: null, at: null } } : x)));
    try {
      const r = await api.reconvertAttachment(goalId, a.id);
      onChange(itemsRef.current.map((x) => (x.id === a.id ? { ...x, markdown: r.markdown } : x)));
    } catch (e: any) {
      setErr(e.message);
    }
  };

  // staged uploads convert in the background: poll pending ones until they settle
  useEffect(() => {
    if (goalId) return;
    const pending = items.filter((a) => a.markdown?.status === 'pending');
    if (!pending.length) return;
    const t = setInterval(async () => {
      for (const a of pending) {
        const fresh = await api.stagedAttachment(a.id).catch(() => null);
        if (fresh && fresh.markdown?.status !== 'pending') onChange(itemsRef.current.map((x) => (x.id === a.id ? fresh : x)));
      }
    }, 2000);
    return () => clearInterval(t);
  }, [items, goalId]);

  // paste images/files anywhere in the page section
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        void addFiles(files);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [goalId]);

  const uploading = Object.entries(progress);
  return (
    <div className={className}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
        }}
        className={cn('rounded-md border border-dashed px-3 py-2 flex flex-wrap items-center gap-2 text-xs transition', drag ? 'border-accent bg-accent/[0.06]' : 'border-line-strong')}
      >
        <Paperclip size={13} className="text-ink-faint" />
        <span className="text-ink-soft">Attach screenshots, PDFs, files or links — or drop / paste them here.</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" type="button" onClick={() => fileRef.current?.click()}>
            <Upload size={12} /> Files
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setLinkOpen(!linkOpen)}>
            <Link2 size={12} /> Link
          </Button>
        </div>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && void addFiles(e.target.files).then(() => (e.target.value = ''))} />
        {linkOpen && (
          <form
            className="basis-full flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addLink();
            }}
          >
            <Input autoFocus={focusFirst} className="text-xs" placeholder="https://… (docs, issue, design)" value={link} onChange={(e) => setLink(e.target.value)} />
            <Button size="sm" type="submit" disabled={!link.trim()}>
              Add
            </Button>
          </form>
        )}
        {/* an upload under way, in the blue of work at work */}
        {uploading.map(([k, pct]) => (
          <div key={k} className="basis-full h-1 rounded-xs bg-line overflow-hidden">
            <div className="h-full bg-work transition-all" style={{ width: `${pct}%` }} />
          </div>
        ))}
      </div>
      {err && <div className="text-xs text-bad-ink mt-1">{err}</div>}
      {items.length > 0 && (
        <div className="mt-2">
          <AttachmentList items={items} goalId={goalId} onRemove={remove} onReconvert={goalId ? reconvert : undefined} />
        </div>
      )}
    </div>
  );
}

export { Trash2 as _unusedTrash };
