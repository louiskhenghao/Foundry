import { ChevronDown, ChevronRight, FileSearch, Search } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { cn } from '../ui.tsx';
import { openFile } from './FilePreview.tsx';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** The value when `text` is a JSON object or array (what tool calls and many tool results are), else undefined. */
export function parseJsonDoc(text: string): Json | undefined {
  const t = text.trim();
  if (!(t.startsWith('{') && t.endsWith('}')) && !(t.startsWith('[') && t.endsWith(']'))) return undefined;
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

/** an absolute path to a file (not a folder, not a URL): the only strings that become "open" links */
export const looksLikeFilePath = (s: string) => s.length < 1024 && !s.includes('\n') && /^(\/|~\/)[^\0]*\/?[^/]*\.[\w-]{1,10}$/.test(s) && !s.startsWith('//');

const isBranch = (v: Json): v is Json[] | { [k: string]: Json } => v !== null && typeof v === 'object';
const entries = (v: Json[] | { [k: string]: Json }): [string, Json][] => (Array.isArray(v) ? v.map((x, i) => [String(i), x]) : Object.entries(v));

/** paths ('' = root, then /key/key…) of every branch that holds a match, and the number of matches */
function findMatches(root: Json, q: string): { open: Set<string>; count: number } {
  const open = new Set<string>();
  let count = 0;
  const walk = (v: Json, path: string): boolean => {
    if (!isBranch(v)) return false;
    let hit = false;
    for (const [k, x] of entries(v)) {
      const here = `${path}/${k}`;
      const self = (!Array.isArray(v) && k.toLowerCase().includes(q)) || (!isBranch(x) && String(x).toLowerCase().includes(q));
      if (self) count++;
      if (walk(x, here) || self) hit = true;
    }
    if (hit) open.add(path);
    return hit;
  };
  walk(root, '');
  return { open, count };
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
    parts.push(text.slice(at, i), <mark key={i} className="rounded-sm bg-yellow-300 text-black">{text.slice(i, i + q.length)}</mark>);
    at = i + q.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * A JSON document as a tree: every object and array folds, the search box marks matches in keys and values and opens
 * the branches that hold them, and absolute file paths open in the file preview.
 */
export function JsonTree({ value }: { value: Json }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  // folded branches; small documents start fully open, big ones show their first two levels
  const [folded, setFolded] = useState<Set<string>>(() => {
    const f = new Set<string>();
    if (JSON.stringify(value).length < 4000) return f;
    const walk = (v: Json, path: string, depth: number) => {
      if (!isBranch(v)) return;
      if (depth >= 2) f.add(path);
      for (const [k, x] of entries(v)) walk(x, `${path}/${k}`, depth + 1);
    };
    walk(value, '', 0);
    return f;
  });
  const matches = useMemo(() => (q ? findMatches(value, q) : null), [value, q]);
  const isOpen = (path: string) => (matches ? matches.open.has(path) || !folded.has(path) : !folded.has(path));
  const toggle = (path: string) =>
    setFolded((f) => {
      const n = new Set(f);
      if (isOpen(path)) n.add(path);
      else n.delete(path);
      return n;
    });
  const setAll = (fold: boolean) => {
    if (!fold) return setFolded(new Set());
    const f = new Set<string>();
    const walk = (v: Json, path: string) => {
      if (!isBranch(v)) return;
      if (path) f.add(path);
      for (const [k, x] of entries(v)) walk(x, `${path}/${k}`);
    };
    walk(value, '');
    setFolded(f);
  };

  const leaf = (v: Json) => {
    if (typeof v === 'string') {
      const path = looksLikeFilePath(v);
      return (
        <span className="text-sky-300 whitespace-pre-wrap [overflow-wrap:anywhere]">
          "<Highlight text={v} q={q} />"
          {path && (
            <button type="button" onClick={() => openFile(v)} className="ml-1.5 inline-flex items-center gap-0.5 rounded border border-zinc-700 px-1 text-[10px] text-zinc-300 hover:text-zinc-100 hover:border-zinc-500 align-middle" title={`Open ${v}`}>
              <FileSearch size={10} /> open
            </button>
          )}
        </span>
      );
    }
    const cls = typeof v === 'number' ? 'text-amber-300' : typeof v === 'boolean' ? 'text-violet-300' : 'text-zinc-500';
    return (
      <span className={cls}>
        <Highlight text={String(v)} q={q} />
      </span>
    );
  };

  const node = (k: string | null, v: Json, path: string, last: boolean): ReactNode => {
    const keyEl = k !== null && (
      <span className="text-zinc-400">
        <Highlight text={k} q={q} />
        <span className="text-zinc-600">: </span>
      </span>
    );
    const comma = last ? '' : ',';
    if (!isBranch(v))
      return (
        <div key={path} className="pl-4">
          {keyEl}
          {leaf(v)}
          <span className="text-zinc-600">{comma}</span>
        </div>
      );
    const list = entries(v);
    const [o, c] = Array.isArray(v) ? ['[', ']'] : ['{', '}'];
    const open = isOpen(path);
    return (
      <div key={path} className={k === null ? '' : 'pl-4'}>
        <button type="button" onClick={() => toggle(path)} className="-ml-4 inline-flex w-4 justify-center text-zinc-500 hover:text-zinc-200 align-[-2px]" aria-label={open ? 'Fold' : 'Unfold'}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {keyEl}
        <span className="text-zinc-500">{o}</span>
        {open ? (
          <>
            {list.map(([ck, cv], i) => node(Array.isArray(v) ? null : ck, cv, `${path}/${ck}`, i === list.length - 1))}
            <span className="text-zinc-500">{c}</span>
          </>
        ) : (
          <button type="button" onClick={() => toggle(path)} className="text-zinc-500 hover:text-zinc-200">
            {' '}
            {list.length} {Array.isArray(v) ? (list.length === 1 ? 'item' : 'items') : list.length === 1 ? 'key' : 'keys'} {c}
          </button>
        )}
        <span className="text-zinc-600">{comma}</span>
      </div>
    );
  };

  return (
    <div className="surface-card rounded-md border border-zinc-800 bg-zinc-950/60">
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-zinc-800/80">
        <label className="flex items-center gap-1.5 flex-1 min-w-[160px] rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5">
          <Search size={11} className="text-zinc-500 shrink-0" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search keys and values" className="w-full bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none" />
        </label>
        {matches && <span className={cn('text-[11px]', matches.count ? 'text-zinc-400' : 'text-rose-400')}>{matches.count ? `${matches.count} match${matches.count === 1 ? '' : 'es'}` : 'no match'}</span>}
        <button type="button" className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:text-zinc-100 hover:border-zinc-500" onClick={() => setAll(false)}>
          Expand all
        </button>
        <button type="button" className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:text-zinc-100 hover:border-zinc-500" onClick={() => setAll(true)}>
          Collapse all
        </button>
      </div>
      <div className="mono text-xs leading-5 p-3 pl-7 overflow-auto">{node(null, value, '', true)}</div>
    </div>
  );
}
