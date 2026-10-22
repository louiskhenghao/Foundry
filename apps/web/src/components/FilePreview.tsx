import { ChevronLeft, ChevronRight, Download, ExternalLink, FileWarning } from 'lucide-react';
import { MEDIA_STAGE, StepBar, useSwipe } from './MediaLightbox.tsx';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { api, fileKey, fileUrl, type FileInfo, type FileRef } from '../api.ts';
import { CopyButton, buttonClass, cn } from '../ui.tsx';
import { JsonTree, parseJsonDoc } from './JsonTree.tsx';
import { MarkdownPanel } from './Markdown.tsx';

/** text bigger than this is offered as a download instead of being loaded into the page */
const TEXT_LIMIT = 2 * 1024 * 1024;

/**
 * The file shown in the preview dialog; any screen opens one with `openFile(pathOrTaskFile)`. Pass the list it was
 * picked from (`openFile(file, files)`) and the dialog steps through that list with its arrows or ← and →.
 */
export const useFilePreview = create<{ file: FileRef | null; list: FileRef[]; open: (file: FileRef, list?: FileRef[]) => void; close: () => void }>((set) => ({
  file: null,
  list: [],
  open: (file, list) => set({ file, list: list && list.some((f) => fileKey(f) === fileKey(file)) ? list : [] }),
  close: () => set({ file: null, list: [] }),
}));
export const openFile = (file: FileRef, list?: FileRef[]) => useFilePreview.getState().open(file, list);

/** a picture or a clip by its name: while the next one loads, the preview keeps their layout (the stage, the arrows) */
const MEDIA_NAME = /\.(png|jpe?g|gif|webp|avif|bmp|svg|mp4|webm|mov|m4v|ogv)$/i;

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** `stage`: stepping through several, a picture or a clip is fitted to a stage of one height, so the arrows under it stay put */
function Body({ info, file, stage }: { info: FileInfo; file: FileRef; stage?: boolean }) {
  const url = fileUrl(file);
  const [text, setText] = useState<string | null>(null);
  const textual = info.kind === 'markdown' || info.kind === 'json' || info.kind === 'text';
  useEffect(() => {
    setText(null);
    if (!textual || info.size > TEXT_LIMIT) return;
    fetch(url)
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText(''));
  }, [url, textual, info.size]);

  if (info.kind === 'image')
    return (
      // a checkerboard in the theme's faint ink behind the picture, so a transparent one shows its edges
      <div className={cn('flex items-center justify-center rounded-lg border border-line bg-[image:repeating-conic-gradient(color-mix(in_srgb,var(--color-ink-faint)_16%,transparent)_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-2', stage && MEDIA_STAGE)}>
        <img src={url} alt={info.name} className={stage ? 'max-h-full max-w-full object-contain' : 'max-h-[70vh] max-w-full object-contain'} />
      </div>
    );
  if (info.kind === 'pdf') return <iframe src={url} title={info.name} className="w-full h-[72vh] rounded-lg border border-line bg-white" />;
  if (info.kind === 'video') return <video src={url} controls className={cn('w-full rounded-lg bg-black', stage ? MEDIA_STAGE : 'max-h-[72vh]')} />;
  if (info.kind === 'audio') return <audio src={url} controls className="w-full" />;
  if (!textual || info.size > TEXT_LIMIT)
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-sm text-ink-soft">
        <FileWarning size={28} className="text-ink-faint" />
        {textual ? `Too large to show here (${fmtSize(info.size)}).` : 'No preview for this kind of file.'}
        <a href={`${url}&download=1`} className={buttonClass('default', 'sm')}>
          <Download size={12} /> Download
        </a>
      </div>
    );
  if (text === null) return <div className="text-xs text-ink-faint">loading…</div>;
  const json = info.kind === 'json' ? parseJsonDoc(text) : undefined;
  if (json !== undefined) return <JsonTree value={json} />;
  if (info.kind === 'markdown') return <MarkdownPanel source={text} title={fmtSize(info.size)} local />;
  return <CodeView text={text} name={info.name} />;
}

/** Source with line numbers, coloured by language once the highlighter has loaded (plain until then, or when unknown). */
export function CodeView({ text, name, className }: { text: string; name: string; className?: string }) {
  const [html, setHtml] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    setHtml(null);
    import('./highlight.ts')
      .then(({ highlightLines, languageOf }) => alive && setHtml(highlightLines(text, languageOf(name))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [text, name]);
  const lines = text.split('\n');
  return (
    <div className={cn('rounded-lg border border-line bg-inset overflow-auto', className ?? 'max-h-[70vh]')}>
      <table className="mono text-xs leading-5">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="select-none pr-3 pl-3 text-right align-top text-ink-faint">{i + 1}</td>
              {/* highlight.js escapes the source; its output is only span tags */}
              {html?.[i] != null ? <td className="hl pr-3 whitespace-pre-wrap [overflow-wrap:anywhere] text-ink" dangerouslySetInnerHTML={{ __html: html[i] || ' ' }} /> : <td className="pr-3 whitespace-pre-wrap [overflow-wrap:anywhere] text-ink">{l || ' '}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The one file preview of the app, mounted once: images, PDF, video and audio play in the page; text, Markdown and JSON are shown formatted. */
export function FilePreviewHost() {
  const { file, list, open, close } = useFilePreview();
  const key = file ? fileKey(file) : null;
  const at = key ? list.findIndex((f) => fileKey(f) === key) : -1;
  const step = (d: -1 | 1) => {
    const next = at >= 0 ? list[at + d] : undefined;
    if (next) open(next, list);
  };
  // the last file's details stay until the next one's come: its task's notes do not blink while stepping
  const [last, setInfo] = useState<(FileInfo & { key: string }) | null>(null);
  const info = last && last.key === key ? last : null;
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setErr(null);
    if (!file || !key) return setInfo(null);
    api
      .fileStat(file)
      .then((i) => setInfo({ ...i, key }))
      .catch((e) => setErr(e.message));
  }, [key]);
  useEffect(() => {
    if (!file) return;
    // captured and stopped: Escape closes the preview, not the dialog or task panel it opened over
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && list.length > 1 && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        // the arrows read a code view or a video while focus is in one; elsewhere they move through the list
        const t = e.target as HTMLElement | null;
        if (t && (t.closest('input, textarea, select, video, audio, [contenteditable="true"]') || t.isContentEditable)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        step(e.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [key, close, at, list]);
  // what the header names: the path asked for, or the file's path in the repository
  const shown = !file ? '' : typeof file === 'string' ? file : 'path' in file ? file.path : file.rel;
  // a picture or a clip steps from under it (and with a swipe on a phone); code and documents keep the arrows on top.
  // Until the next one's details come, its name tells which it is
  const media = info ? info.kind === 'image' || info.kind === 'video' : MEDIA_NAME.test(shown);
  const swipe = useSwipe((d) => step(d), info?.kind === 'video');
  if (!file) return null;
  const name = shown.split('/').pop();
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="w-full sm:max-w-5xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[94vh] rounded-xl border border-line bg-panel shadow-2xl flex flex-col">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-line min-w-0">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-ink truncate">{name}</h3>
            <div className="mono text-[11px] text-ink-faint truncate" title={shown}>
              {shown}
              {info ? ` · ${fmtSize(info.size)}` : ''}
            </div>
          </div>
          {list.length > 1 && at >= 0 && !media && (
            <span className="flex items-center gap-0.5 mono text-[11px] text-ink-faint shrink-0">
              <button type="button" className="rounded-md p-1 text-ink-soft hover:bg-inset hover:text-ink disabled:opacity-30" disabled={at === 0} onClick={() => step(-1)} aria-label="previous file" title="Previous file (←)">
                <ChevronLeft size={14} />
              </button>
              {at + 1} / {list.length}
              <button type="button" className="rounded-md p-1 text-ink-soft hover:bg-inset hover:text-ink disabled:opacity-30" disabled={at === list.length - 1} onClick={() => step(1)} aria-label="next file" title="Next file (→)">
                <ChevronRight size={14} />
              </button>
            </span>
          )}
          <CopyButton text={info?.path ?? shown} />
          {info && (
            <>
              <a href={fileUrl(file)} target="_blank" rel="noreferrer" className="rounded-md p-1 text-ink-soft hover:bg-inset hover:text-ink" title="Open in a new tab">
                <ExternalLink size={14} />
              </a>
              <a href={`${fileUrl(file)}&download=1`} className="rounded-md p-1 text-ink-soft hover:bg-inset hover:text-ink" title="Download">
                <Download size={14} />
              </a>
            </>
          )}
          <button className="rounded-md px-1.5 text-lg leading-none text-ink-faint hover:bg-inset hover:text-ink" onClick={close} aria-label="close">
            ×
          </button>
        </header>
        <div className="p-4 overflow-auto">
          {err ? (
            <div className="text-sm text-bad-ink">{err}</div>
          ) : info || (media && last) ? (
            <>
              {/* where this copy of the file comes from, on a quiet strip above it */}
              {last?.commit && <div className="mb-3 rounded-md bg-inset px-3 py-2 text-xs text-ink-soft">From the task's commit <span className="mono text-ink">{last.commit.slice(0, 7)}</span> — the version the task made. Its folders were removed after the work was delivered.</div>}
              {last?.landed && <div className="mb-3 rounded-md bg-inset px-3 py-2 text-xs text-ink-soft">The task's own folder was removed when it merged; this is the file as it is now in the progress folder.</div>}
              {media ? (
                <div className="space-y-2">
                  <div className="touch-pan-y select-none" {...swipe}>
                    {info ? <Body info={info} file={file} stage={list.length > 1} /> : <div className={cn('flex items-center justify-center rounded-lg border border-line text-xs text-ink-faint', list.length > 1 ? MEDIA_STAGE : 'h-48')}>loading…</div>}
                  </div>
                  {list.length > 1 && at >= 0 && <StepBar index={at} count={list.length} onStep={step} />}
                </div>
              ) : (
                info && <Body info={info} file={file} />
              )}
            </>
          ) : (
            <div className="text-xs text-ink-faint">loading…</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
