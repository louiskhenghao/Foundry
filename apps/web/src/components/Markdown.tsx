import { useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { cn } from '../ui.tsx';

type Node = { type: string; value?: string; children?: Node[] };
/** the containers whose children are words, where a stray tag is part of a sentence */
const PHRASING = new Set(['paragraph', 'heading', 'emphasis', 'strong', 'delete', 'link', 'linkReference', 'tableCell']);
/**
 * Raw HTML in the words is shown as written. Left to itself remark drops it, and a sentence about `<p>` or `<title>`
 * loses its nouns (the models here write about HTML all day). A comment stays hidden: nobody is meant to read it.
 */
function remarkHtmlAsWords() {
  const walk = (node: Node) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child): Node[] => {
      if (child.type !== 'html') {
        walk(child);
        return [child];
      }
      const value = child.value ?? '';
      if (value.trimStart().startsWith('<!--')) return [];
      const text: Node = { type: 'text', value };
      return [PHRASING.has(node.type) ? text : { type: 'paragraph', children: [text] }];
    });
  };
  return (tree: Node) => walk(tree);
}

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
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkHtmlAsWords]} rehypePlugins={[rehypeSanitize]}>
        {source}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Markdown with a Preview / Raw toggle in the corner. `local` keeps the toggle per panel instead of global;
 * `defaultRaw` is where a local toggle starts (tool output reads better raw, prose as a preview).
 */
export function MarkdownPanel({ source, title, className, maxHeight, local, defaultRaw, actions }: { source: string; title?: ReactNode; className?: string; maxHeight?: number | string; local?: boolean; defaultRaw?: boolean; actions?: ReactNode }) {
  const [globalRaw, setGlobalRaw] = useRawPref();
  const [localRaw, setLocalRaw] = useState(defaultRaw ?? false);
  const raw = local ? localRaw : globalRaw;
  const setRaw = local ? setLocalRaw : setGlobalRaw;
  return (
    <div className={cn('surface-card relative rounded-md border border-line bg-page/60', className)}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line/80">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint flex-1">{title ?? 'markdown'}</span>
        {actions}
        <div className="flex gap-0.5 rounded-md p-0.5 ring-1 ring-inset ring-line-strong text-[11px] font-semibold">
          <button className={cn('rounded-sm px-2 py-0.5', !raw ? 'bg-accent text-on-accent' : 'text-ink-soft hover:text-ink')} onClick={() => setRaw(false)}>
            Preview
          </button>
          <button className={cn('rounded-sm px-2 py-0.5', raw ? 'bg-accent text-on-accent' : 'text-ink-soft hover:text-ink')} onClick={() => setRaw(true)}>
            Raw
          </button>
        </div>
      </div>
      <div className="p-3 overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        {source.trim() ? raw ? <pre className="mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere] text-ink">{source}</pre> : <Markdown source={source} /> : <span className="text-xs text-ink-faint">—</span>}
      </div>
    </div>
  );
}
