import { Check, Copy } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal, cn } from '../ui.tsx';
import { useFilePreview } from './FilePreview.tsx';
import { JsonTree, parseJsonDoc } from './JsonTree.tsx';
import { MarkdownPanel } from './Markdown.tsx';

/** What a one-line entry stands for in full. */
export interface FullText {
  title: ReactNode;
  text: string;
  /** start in Raw (tool input and output, stderr, commit messages); prose starts as a Preview */
  raw?: boolean;
  /** shown above the text, e.g. why only part of it could be found */
  note?: ReactNode;
  /** the full text is still being read; `text` is what the page already had */
  loading?: boolean;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // no async clipboard (older browser, insecure origin): the selection route still works
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function CopyTextButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button type="button" className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:text-zinc-100 hover:border-zinc-500" onClick={() => void copyText(text).then(setCopied)} title="Copy the full text">
      {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** The full text behind a one-line entry (live log, activity, commit message, escalation): Preview / Raw and Copy. */
export function FullTextDialog({ value, onClose }: { value: FullText | null; onClose: () => void }) {
  useEffect(() => {
    if (!value) return;
    // captured first and stopped, so Escape closes only this dialog, not the task panel it opened over
    const onKey = (e: KeyboardEvent) => {
      // a file preview opened from this dialog takes Escape first
      if (e.key !== 'Escape' || useFilePreview.getState().path) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [value, onClose]);
  const json = value ? parseJsonDoc(value.text) : undefined;
  const [tree, setTree] = useState(true);
  useEffect(() => setTree(true), [value?.text]);
  if (!value) return null;
  // portalled to <body>: it opens from inside the task panel, whose backdrop blur would otherwise pin a fixed overlay to the panel's scroll
  return createPortal(
    <Modal open title={value.title} onClose={onClose} wide>
      {value.note && <div className="mb-2 text-xs text-amber-300/90">{value.note}</div>}
      {json !== undefined && (
        // a JSON object or array (a tool call, most tool results) reads as a tree; the text view stays one click away
        <div className="mb-2 flex items-center gap-2">
          <div className="flex rounded border border-zinc-700 overflow-hidden text-[10px]">
            <button className={cn('px-2 py-0.5', tree ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400')} onClick={() => setTree(true)}>
              Tree
            </button>
            <button className={cn('px-2 py-0.5', !tree ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400')} onClick={() => setTree(false)}>
              Text
            </button>
          </div>
          <span className="flex-1" />
          {tree && <CopyTextButton text={value.text} />}
        </div>
      )}
      {json !== undefined && tree ? (
        <JsonTree key={value.text} value={json} />
      ) : (
      <MarkdownPanel
        key={String(value.raw)}
        source={value.text}
        title={value.loading ? 'reading the full text…' : `${value.text.length.toLocaleString()} characters`}
        local
        defaultRaw={value.raw}
        actions={<CopyTextButton text={value.text} />}
      />
      )}
    </Modal>,
    document.body,
  );
}
