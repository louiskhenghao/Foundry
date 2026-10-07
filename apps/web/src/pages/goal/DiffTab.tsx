import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, fileUrl } from '../../api.ts';
import { ButtonGroup, CopyButton, Modal, cn } from '../../ui.tsx';

interface FileDiff {
  path: string;
  add: number;
  del: number;
  lines: string[];
}

/** one row of a file's diff: a changed or unchanged line with its numbers in the old and new file, or a hunk header */
interface Row {
  kind: 'add' | 'del' | 'ctx' | 'hunk';
  old: number | null;
  new: number | null;
  text: string;
}

/** the server cuts a long diff and says so on its last line */
const CUT = /^\.\.\. \[diff truncated at \d+ bytes\]$/;

function parse(diff: string): { files: FileDiff[]; cut: boolean } {
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null;
  let cut = false;
  for (const line of diff.split('\n')) {
    if (CUT.test(line)) {
      cut = true;
      continue;
    }
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
  return { files, cut };
}

/** a file's diff lines as rows with line numbers; the header lines (index, ---, +++) are dropped */
export function rowsOf(lines: string[]): Row[] {
  const rows: Row[] = [];
  let o = 0;
  let n = 0;
  let inHunk = false;
  for (const l of lines) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(l);
    if (h) {
      o = Number(h[1]);
      n = Number(h[2]);
      inHunk = true;
      rows.push({ kind: 'hunk', old: null, new: null, text: l });
    } else if (!inHunk || l === '' || l.startsWith('\\')) continue; // an unchanged line starts with a space; '' is the diff's end
    else if (l.startsWith('+')) rows.push({ kind: 'add', old: null, new: n++, text: l.slice(1) });
    else if (l.startsWith('-')) rows.push({ kind: 'del', old: o++, new: null, text: l.slice(1) });
    else rows.push({ kind: 'ctx', old: o++, new: n++, text: l.slice(1) });
  }
  return rows;
}

/** the lines' highlighted HTML, by the file's language, once the highlighter has loaded; null = plain */
function useHighlight(lines: string[], name: string): string[] | null {
  const [done, setDone] = useState<{ key: string; html: string[] | null } | null>(null);
  const key = `${name}\0${lines.join('\n')}`;
  useEffect(() => {
    let alive = true;
    import('../../components/highlight.ts')
      .then(({ highlightLines, languageOf }) => alive && setDone({ key, html: highlightLines(lines.join('\n'), languageOf(name)) }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key]);
  // another file's highlighting never shows on these lines, not even for the frame before it is redone
  return done?.key === key ? done.html : null;
}

const TINT: Record<Row['kind'], string> = { add: 'bg-emerald-500/10', del: 'bg-rose-500/10', ctx: '', hunk: 'bg-sky-500/5' };
const MARK: Record<Row['kind'], string> = { add: '+', del: '−', ctx: ' ', hunk: '' };

function Code({ rows, name }: { rows: Row[]; name: string }) {
  const code = rows.filter((r) => r.kind !== 'hunk');
  const html = useHighlight(code.map((r) => r.text), name);
  let i = -1;
  return (
    <div className="surface-card rounded-md border border-zinc-800 bg-zinc-950/60 overflow-auto max-h-[70vh]">
      <table className="mono text-xs leading-5 w-full">
        <tbody>
          {rows.map((r, k) => {
            if (r.kind === 'hunk')
              return (
                <tr key={k} className={TINT.hunk}>
                  <td colSpan={4} className="px-3 text-sky-400/80 whitespace-pre">{r.text}</td>
                </tr>
              );
            i++;
            const h = html?.[i];
            return (
              <tr key={k} className={TINT[r.kind]}>
                <td className="select-none pl-3 pr-2 text-right align-top text-zinc-600 w-0">{r.old ?? ''}</td>
                <td className="select-none pr-2 text-right align-top text-zinc-600 w-0">{r.new ?? ''}</td>
                <td className={cn('select-none pr-2 align-top w-0', r.kind === 'add' ? 'text-emerald-400' : 'text-rose-400')}>{MARK[r.kind]}</td>
                {h != null ? <td className="hl pr-3 whitespace-pre-wrap [overflow-wrap:anywhere] text-zinc-300" dangerouslySetInnerHTML={{ __html: h || ' ' }} /> : <td className="pr-3 whitespace-pre-wrap [overflow-wrap:anywhere] text-zinc-300">{r.text || ' '}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** the whole file as it is now, with the lines this goal added or changed tinted */
function WholeFile({ path, rows }: { path: string; rows: Row[] }) {
  const [got, setGot] = useState<{ path: string; text: string | 'missing' | 'binary' } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(fileUrl({ path }))
      .then(async (r) => {
        if (!r.ok) return 'missing';
        const text = await r.text();
        return text.includes('\0') ? 'binary' : text;
      })
      .catch(() => 'missing' as const)
      .then((text) => alive && setGot({ path, text }));
    return () => {
      alive = false;
    };
  }, [path]);
  const added = useMemo(() => new Set(rows.filter((r) => r.kind === 'add').map((r) => r.new)), [rows]);
  const text = got?.path === path ? got.text : null;
  if (text === null) return <div className="text-xs text-zinc-500">loading…</div>;
  if (text === 'missing') return <div className="text-xs text-zinc-500">The file is not in the goal's folder (deleted, or the folder was cleaned up).</div>;
  if (text === 'binary') return <div className="text-xs text-zinc-500">A binary file: nothing to show as text.</div>;
  if (!text) return <div className="text-xs text-zinc-500">The file is empty.</div>;
  // a final newline ends the last line; it does not start another
  const whole: Row[] = text.replace(/\n$/, '').split('\n').map((l, k) => ({ kind: added.has(k + 1) ? 'add' : 'ctx', old: null, new: k + 1, text: l }));
  return <Code rows={whole} name={path} />;
}

/** one file's diff in a window, with the files before and after it a click away */
function DiffDialog({ files, index, workspace, onIndex, onClose }: { files: FileDiff[]; index: number; workspace: string | null; onIndex: (i: number) => void; onClose: () => void }) {
  const f = files[index]!;
  const [mode, setMode] = useState<'changes' | 'file'>('changes');
  const rows = useMemo(() => rowsOf(f.lines), [f]);
  const deleted = f.lines.some((l) => l.startsWith('deleted file mode'));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t?.isContentEditable) return;
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < files.length - 1) onIndex(index + 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, files.length]);
  return (
    <Modal open wide onClose={onClose} title={<span className="mono">{f.path}</span>}>
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-emerald-400">+{f.add}</span>
          <span className="text-rose-400">−{f.del}</span>
          <CopyButton text={f.path} />
          {workspace && !deleted && <ButtonGroup label="Show" value={mode} onChange={setMode} options={[{ id: 'changes', label: 'Changes' }, { id: 'file', label: 'Whole file' }]} />}
          <span className="ml-auto flex items-center gap-1 text-zinc-500">
            <button type="button" className="rounded p-1 hover:bg-zinc-800 disabled:opacity-30" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="previous file" title="Previous file (←)">
              <ChevronLeft size={14} />
            </button>
            {index + 1} / {files.length}
            <button type="button" className="rounded p-1 hover:bg-zinc-800 disabled:opacity-30" disabled={index === files.length - 1} onClick={() => onIndex(index + 1)} aria-label="next file" title="Next file (→)">
              <ChevronRight size={14} />
            </button>
          </span>
        </div>
        {mode === 'file' && workspace && !deleted ? <WholeFile path={`${workspace}/${f.path}`} rows={rows} /> : rows.length ? <Code rows={rows} name={f.path} /> : <div className="text-xs text-zinc-500">No line changes (a rename, a mode change or a binary file).</div>}
      </div>
    </Modal>
  );
}

export function DiffTab({ goalId, baseBranch, branch, workspace }: { goalId: string; baseBranch: string; branch: string; workspace: string | null }) {
  const [raw, setRaw] = useState<string | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    api.diff(goalId).then(setRaw).catch(() => setRaw(''));
  }, [goalId]);
  const { files, cut } = useMemo(() => (raw ? parse(raw) : { files: [], cut: false }), [raw]);

  if (raw === null) return <div className="text-sm text-zinc-500">Loading diff…</div>;
  if (!files.length) return <div className="text-sm text-zinc-500">No changes on {branch} relative to {baseBranch} yet.</div>;
  const totals = files.reduce((a, f) => ({ add: a.add + f.add, del: a.del + f.del }), { add: 0, del: 0 });
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
      </div>
      <div className="surface-card rounded-md border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
        {files.map((f, i) => (
          <button key={f.path} type="button" onClick={() => setShown(i)} className="diff-file-head w-full flex items-center gap-3 px-3 py-1.5 bg-zinc-900/70 text-xs text-left hover:bg-zinc-800/70" title="Show this file's changes">
            <span className="mono text-zinc-100 flex-1 truncate">{f.path}</span>
            <span className="text-emerald-400">+{f.add}</span>
            <span className="text-rose-400">−{f.del}</span>
          </button>
        ))}
      </div>
      {cut && <div className="text-xs text-amber-400/80">The diff is too long to show whole: it stops partway, so the last file is cut short and later files are missing.</div>}
      {shown !== null && files[shown] && <DiffDialog files={files} index={shown} workspace={workspace} onIndex={setShown} onClose={() => setShown(null)} />}
    </div>
  );
}
