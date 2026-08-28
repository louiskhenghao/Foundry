import { useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { cn } from '../ui.tsx';

const PREF_KEY = 'foundry.md.raw';
let rawPref: boolean | null = null;
function readPref(): boolean {
  if (rawPref !== null) return rawPref;
  try {
    rawPref = localStorage.getItem(PREF_KEY) === '1';
  } catch {
    rawPref = false;
  }
  return rawPref;
}
const subs = new Set<(v: boolean) => void>();
function setPref(v: boolean) {
  rawPref = v;
  try {
    localStorage.setItem(PREF_KEY, v ? '1' : '0');
  } catch {}
  for (const s of subs) s(v);
}
/** Global preview/raw preference shared by every MarkdownPanel (persisted). */
export function useRawPref(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(readPref());
  useEffect(() => {
    subs.add(setV);
    return () => {
      subs.delete(setV);
    };
  }, []);
  return [v, setPref];
}

/** Sanitized GFM markdown (content comes from models). */
export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn('md', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {source}
      </ReactMarkdown>
    </div>
  );
}

/** Markdown with a Preview / Raw toggle in the corner. `local` keeps the toggle per panel instead of global. */
export function MarkdownPanel({ source, title, className, maxHeight, local, actions }: { source: string; title?: ReactNode; className?: string; maxHeight?: number | string; local?: boolean; actions?: ReactNode }) {
  const [globalRaw, setGlobalRaw] = useRawPref();
  const [localRaw, setLocalRaw] = useState(false);
  const raw = local ? localRaw : globalRaw;
  const setRaw = local ? setLocalRaw : setGlobalRaw;
  return (
    <div className={cn('relative rounded-md border border-zinc-800 bg-zinc-950/60', className)}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/80">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500 flex-1">{title ?? 'markdown'}</span>
        {actions}
        <div className="flex rounded border border-zinc-700 overflow-hidden text-[10px]">
          <button className={cn('px-2 py-0.5', !raw ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400')} onClick={() => setRaw(false)}>
            Preview
          </button>
          <button className={cn('px-2 py-0.5', raw ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400')} onClick={() => setRaw(true)}>
            Raw
          </button>
        </div>
      </div>
      <div className="p-3 overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        {source.trim() ? raw ? <pre className="mono text-xs whitespace-pre-wrap text-zinc-300">{source}</pre> : <Markdown source={source} /> : <span className="text-xs text-zinc-600">—</span>}
      </div>
    </div>
  );
}
