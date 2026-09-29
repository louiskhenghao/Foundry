import { Download, ExternalLink, FileWarning } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { api, fileKey, fileUrl, type FileInfo, type FileRef } from '../api.ts';
import { CopyButton } from '../ui.tsx';
import { JsonTree, parseJsonDoc } from './JsonTree.tsx';
import { MarkdownPanel } from './Markdown.tsx';

/** text bigger than this is offered as a download instead of being loaded into the page */
const TEXT_LIMIT = 2 * 1024 * 1024;

/** The file shown in the preview dialog; any screen opens one with `openFile(pathOrTaskFile)`. */
export const useFilePreview = create<{ file: FileRef | null; open: (file: FileRef) => void; close: () => void }>((set) => ({
  file: null,
  open: (file) => set({ file }),
  close: () => set({ file: null }),
}));
export const openFile = (file: FileRef) => useFilePreview.getState().open(file);

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function Body({ info, file }: { info: FileInfo; file: FileRef }) {
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
      <div className="flex justify-center rounded-md border border-zinc-800 bg-[repeating-conic-gradient(#8881_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-2">
        <img src={url} alt={info.name} className="max-h-[70vh] max-w-full object-contain" />
      </div>
    );
  if (info.kind === 'pdf') return <iframe src={url} title={info.name} className="w-full h-[72vh] rounded-md border border-zinc-800 bg-white" />;
  if (info.kind === 'video') return <video src={url} controls className="w-full max-h-[72vh] rounded-md bg-black" />;
  if (info.kind === 'audio') return <audio src={url} controls className="w-full" />;
  if (!textual || info.size > TEXT_LIMIT)
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-sm text-zinc-400">
        <FileWarning size={28} className="text-zinc-500" />
        {textual ? `Too large to show here (${fmtSize(info.size)}).` : 'No preview for this kind of file.'}
        <a href={`${url}&download=1`} className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:border-zinc-500">
          <Download size={12} /> Download
        </a>
      </div>
    );
  if (text === null) return <div className="text-xs text-zinc-500">loading…</div>;
  const json = info.kind === 'json' ? parseJsonDoc(text) : undefined;
  if (json !== undefined) return <JsonTree value={json} />;
  if (info.kind === 'markdown') return <MarkdownPanel source={text} title={fmtSize(info.size)} local />;
  return <CodeView text={text} name={info.name} />;
}

/** Source with line numbers, coloured by language once the highlighter has loaded (plain until then, or when unknown). */
function CodeView({ text, name }: { text: string; name: string }) {
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
    <div className="surface-card rounded-md border border-zinc-800 bg-zinc-950/60 overflow-auto max-h-[70vh]">
      <table className="mono text-xs leading-5">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="select-none pr-3 pl-3 text-right align-top text-zinc-600">{i + 1}</td>
              {/* highlight.js escapes the source; its output is only span tags */}
              {html?.[i] != null ? <td className="hl pr-3 whitespace-pre-wrap [overflow-wrap:anywhere] text-zinc-300" dangerouslySetInnerHTML={{ __html: html[i] || ' ' }} /> : <td className="pr-3 whitespace-pre-wrap [overflow-wrap:anywhere] text-zinc-300">{l || ' '}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The one file preview of the app, mounted once: images, PDF, video and audio play in the page; text, Markdown and JSON are shown formatted. */
export function FilePreviewHost() {
  const { file, close } = useFilePreview();
  const key = file ? fileKey(file) : null;
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setInfo(null);
    setErr(null);
    if (!file) return;
    api
      .fileStat(file)
      .then(setInfo)
      .catch((e) => setErr(e.message));
  }, [key]);
  useEffect(() => {
    if (!file) return;
    // captured and stopped: Escape closes the preview, not the dialog or task panel it opened over
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [key, close]);
  if (!file) return null;
  // what the header names: the path asked for, or the file's path in the repository
  const shown = typeof file === 'string' ? file : 'path' in file ? file.path : file.rel;
  const name = shown.split('/').pop();
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="w-full sm:max-w-5xl max-h-[94vh] rounded-t-xl sm:rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col">
        <header className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 min-w-0">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-zinc-100 truncate">{name}</h3>
            <div className="mono text-[10px] text-zinc-500 truncate" title={shown}>
              {shown}
              {info ? ` · ${fmtSize(info.size)}` : ''}
            </div>
          </div>
          <CopyButton text={info?.path ?? shown} />
          {info && (
            <>
              <a href={fileUrl(file)} target="_blank" rel="noreferrer" className="text-zinc-400 hover:text-zinc-100" title="Open in a new tab">
                <ExternalLink size={14} />
              </a>
              <a href={`${fileUrl(file)}&download=1`} className="text-zinc-400 hover:text-zinc-100" title="Download">
                <Download size={14} />
              </a>
            </>
          )}
          <button className="text-zinc-400 hover:text-zinc-100 text-lg leading-none px-1" onClick={close} aria-label="close">
            ×
          </button>
        </header>
        <div className="p-4 overflow-auto">
          {err ? (
            <div className="text-sm text-rose-400">{err}</div>
          ) : info ? (
            <>
              {info.commit && <div className="mb-2 text-xs text-amber-300/90">From the task's commit <span className="mono">{info.commit.slice(0, 7)}</span> — the version the task made. Its folders were removed after the work was delivered.</div>}
              {info.landed && <div className="mb-2 text-xs text-amber-300/90">The task's own folder was removed when it merged; this is the file as it is now in the progress folder.</div>}
              <Body info={info} file={file} />
            </>
          ) : (
            <div className="text-xs text-zinc-500">loading…</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
