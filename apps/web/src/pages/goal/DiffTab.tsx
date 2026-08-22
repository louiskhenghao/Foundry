import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.ts';
import { cn } from '../../ui.tsx';

interface FileDiff {
  path: string;
  add: number;
  del: number;
  lines: string[];
}

function parse(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null;
  for (const line of diff.split('\n')) {
    const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m) {
      cur = { path: m[2]!, add: 0, del: 0, lines: [] };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    cur.lines.push(line);
    if (line.startsWith('+') && !line.startsWith('+++')) cur.add++;
    else if (line.startsWith('-') && !line.startsWith('---')) cur.del++;
  }
  return files;
}

export function DiffTab({ goalId, baseBranch, branch }: { goalId: string; baseBranch: string; branch: string }) {
  const [raw, setRaw] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    api.diff(goalId).then(setRaw).catch(() => setRaw(''));
  }, [goalId]);
  const files = useMemo(() => (raw ? parse(raw) : []), [raw]);
  useEffect(() => {
    if (files.length && files.length <= 6) setOpen(new Set(files.map((f) => f.path)));
  }, [files.length]);

  if (raw === null) return <div className="text-sm text-zinc-500">Loading diff…</div>;
  if (!files.length) return <div className="text-sm text-zinc-500">No changes on {branch} relative to {baseBranch} yet.</div>;
  const totals = files.reduce((a, f) => ({ add: a.add + f.add, del: a.del + f.del }), { add: 0, del: 0 });
  const toggle = (p: string) => setOpen((s) => {
    const n = new Set(s);
    n.has(p) ? n.delete(p) : n.add(p);
    return n;
  });
  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-400 flex gap-3">
        <span>
          {files.length} file{files.length === 1 ? '' : 's'}
        </span>
        <span className="text-emerald-400">+{totals.add}</span>
        <span className="text-rose-400">−{totals.del}</span>
        <span className="mono text-zinc-600">
          {baseBranch}…{branch}
        </span>
        <button className="ml-auto underline" onClick={() => setOpen(open.size === files.length ? new Set() : new Set(files.map((f) => f.path)))}>
          {open.size === files.length ? 'collapse all' : 'expand all'}
        </button>
      </div>
      {files.map((f) => (
        <div key={f.path} className="rounded-md border border-zinc-800 overflow-hidden">
          <button onClick={() => toggle(f.path)} className="w-full flex items-center gap-3 px-3 py-1.5 bg-zinc-900/70 text-xs text-left">
            <span className="text-zinc-500">{open.has(f.path) ? '▾' : '▸'}</span>
            <span className="mono text-zinc-100 flex-1 truncate">{f.path}</span>
            <span className="text-emerald-400">+{f.add}</span>
            <span className="text-rose-400">−{f.del}</span>
          </button>
          {open.has(f.path) && (
            <pre className="mono text-[11px] leading-4 overflow-auto max-h-[480px] p-2">
              {f.lines.map((l, i) => (
                <div key={i} className={cn(l.startsWith('+') && !l.startsWith('+++') ? 'text-emerald-300 bg-emerald-500/5' : l.startsWith('-') && !l.startsWith('---') ? 'text-rose-300 bg-rose-500/5' : l.startsWith('@@') ? 'text-sky-400' : 'text-zinc-400')}>
                  {l || ' '}
                </div>
              ))}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
