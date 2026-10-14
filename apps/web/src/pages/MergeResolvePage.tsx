import { AlertTriangle, Check, ChevronLeft, GitMerge, RotateCcw, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type FinishResult, type GoalDetail, type ResolveFile, type ResolveState } from '../api.ts';
import { OpenMenu } from '../components/OpenMenu.tsx';
import { Badge, Button, Empty, cn } from '../ui.tsx';
import { CodeEditor } from '../components/CodeEditor.tsx';
import { CodeView } from '../components/FilePreview.tsx';

const MARKER = /^(<{7}|={7}|>{7}|\|{7})( |$)/gm;

/**
 * Resolve a task's merge conflict by hand. The conflict lives in the goal's `_resolve` worktree:
 * pick a side per file, paste a merged version, or open the worktree in your editor — then Finish merge.
 */
export function MergeResolvePage() {
  const { id = '', taskId = '' } = useParams();
  const nav = useNavigate();
  const [detail, setDetail] = useState<GoalDetail | null>(null);
  const [state, setState] = useState<ResolveState | null>(null);
  const [cannot, setCannot] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [finish, setFinish] = useState<FinishResult | null>(null);

  const load = async () => {
    setErr(null);
    try {
      const [d, r] = await Promise.all([api.goal(id), api.resolve.get(id, taskId)]);
      setDetail(d);
      if (r.state) setState(r.state);
      else if (r.can.ok) setState(await api.resolve.start(id, taskId));
      else setCannot(r.can.reason);
    } catch (e: any) {
      setErr(e.message);
    }
  };
  useEffect(() => {
    void load();
  }, [id, taskId]);
  useEffect(() => {
    if (state && (!sel || !state.files.some((f) => f.path === sel))) setSel(state.files.find((f) => f.conflicted)?.path ?? state.files[0]?.path ?? null);
  }, [state]);

  const task = detail?.tasks.find((t) => t.id === taskId) ?? null;
  const file = state?.files.find((f) => f.path === sel) ?? null;

  const run = async (label: string, fn: () => Promise<ResolveState | void>) => {
    setBusy(label);
    setErr(null);
    try {
      const s = await fn();
      if (s) setState(s);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };
  const doFinish = async (force: boolean) => {
    setBusy('finish');
    setErr(null);
    try {
      const r = await api.resolve.finish(id, taskId, force);
      setFinish(r);
      if (r.ok) setTimeout(() => nav(`/goals/${id}#tasks`), 1200);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (err && !state) return <Empty>{err}</Empty>;
  if (cannot) {
    return (
      <div className="max-w-6xl mx-auto p-6 space-y-3">
        <Link to={`/goals/${id}#tasks`} className="text-xs text-zinc-400 underline">
          ← back to the goal
        </Link>
        <Empty>{cannot}</Empty>
      </div>
    );
  }
  if (!state || !detail) return <Empty>Preparing the conflict in a separate worktree…</Empty>;
  const resolvedCount = state.files.length - state.remaining;

  return (
    <div className="max-w-[100rem] mx-auto p-3 sm:p-4 md:p-6 space-y-4">
      {/* heading: the task, where its branch lands, how far along; the actions on the right */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link to={`/goals/${id}#tasks`} className="text-zinc-400 hover:text-zinc-200" title="Back to the goal">
          <ChevronLeft size={18} />
        </Link>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-orange-500/15 text-orange-300">
          <GitMerge size={14} aria-hidden="true" />
        </span>
        <h1 className="text-lg font-semibold min-w-0 truncate">{task?.title ?? taskId}</h1>
        {task && <Badge state={task.state} />}
        <span className="text-xs text-zinc-500">
          <span className="mono">{state.branch}</span> → <span className="mono">{state.into}</span> · <span className={state.remaining ? 'text-orange-300' : 'text-emerald-300'}>{resolvedCount}/{state.files.length} resolved</span>
        </span>
        <span className="ml-auto flex items-center gap-1.5 flex-wrap">
          <OpenMenu goalId={id} places={[{ which: `resolve:${taskId}`, label: 'Resolve worktree', path: state.path, hint: 'edit here, then Finish merge' }]} label="Open in editor" />
          <Button size="sm" disabled={!!busy} onClick={() => run('restart', () => api.resolve.start(id, taskId, true))} title="Throw away every resolution and re-create the conflict from the current goal branch">
            <RotateCcw size={13} /> Start over
          </Button>
          <Button size="sm" variant="danger" disabled={!!busy} onClick={() => run('abort', async () => { await api.resolve.abort(id, taskId); nav(`/goals/${id}#tasks`); })} title="Drop the resolve worktree; the task stays blocked in the Inbox">
            <X size={13} /> Abort
          </Button>
          <Button size="sm" variant="primary" disabled={!!busy || state.remaining > 0} onClick={() => doFinish(false)} title={state.remaining ? 'Resolve every file first' : 'Commit the resolution as the task commit, run the must checks and land it on the goal branch'}>
            <Check size={13} /> {busy === 'finish' ? 'Finishing…' : 'Finish merge'}
          </Button>
        </span>
      </div>
      <p className="text-xs text-zinc-500 -mt-2">
        The conflict was re-created in <span className="mono break-all">{state.path}</span> so the rest of the goal keeps going. <b className="text-emerald-300/90">Ours</b> = the goal branch ({state.into}), <b className="text-sky-300/90">theirs</b> = this task's branch. Resolve each file here (take a side, or edit the result and save) or in your editor, then <b>Finish merge</b>: the engine commits, runs the must checks and lands it on the goal branch.
      </p>
      {err && <div className="rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-200">{err}</div>}
      {finish && (
        <div className={cn('rounded-lg border p-3 text-sm space-y-2', finish.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5')}>
          <div className="flex items-center gap-2">
            {finish.ok ? <Check size={14} className="text-emerald-300" /> : <AlertTriangle size={14} className="text-amber-300" />}
            <span>{finish.ok ? `Merged as ${finish.ref?.slice(0, 7)} — the task is done; back to the goal…` : finish.reason}</span>
          </div>
          {finish.checks.length > 0 && (
            <ul className="text-xs space-y-1">
              {finish.checks.map((c) => (
                <li key={c.name} className="flex gap-2 items-start">
                  <Badge state={c.status === 'pass' ? 'pass' : 'fail'} />
                  <span className="text-zinc-300">{c.name}</span>
                  {c.status !== 'pass' && <span className="text-zinc-500 mono whitespace-pre-wrap break-all">{c.summary}</span>}
                </li>
              ))}
            </ul>
          )}
          {!finish.ok && finish.checks.some((c) => c.status !== 'pass') && (
            <Button size="sm" variant="danger" disabled={!!busy} onClick={() => doFinish(true)} title="Land the resolution even though checks fail; the goal review will judge the result">
              Finish anyway
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 self-start md:sticky md:top-16 md:max-h-[calc(100dvh-5rem)] md:overflow-y-auto">
          <header className="px-3 py-2.5 border-b border-zinc-800 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">Files</span>
            <span className="text-[10px] text-zinc-600">{state.files.length}</span>
            <span className="ml-auto text-[10px] text-zinc-500">{state.remaining} left</span>
          </header>
          <div className="p-1.5 space-y-0.5">
            {state.files.map((f) => (
              <button key={f.path} onClick={() => setSel(f.path)} className={cn('w-full text-left rounded-md px-2 py-1.5 text-xs flex items-center gap-2', sel === f.path ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/60')}>
                <span className={cn('w-2 h-2 rounded-full shrink-0', f.conflicted ? 'bg-orange-400' : 'bg-emerald-400')} />
                <span className="mono truncate" title={f.path}>
                  {f.path}
                </span>
              </button>
            ))}
          </div>
        </section>
        {file ? <FilePane key={file.path} file={file} busy={busy} onTake={(side) => run(side, () => api.resolve.take(id, taskId, file.path, side))} onSave={(content) => run('save', () => api.resolve.file(id, taskId, file.path, content))} onUndo={() => run('undo', () => api.resolve.unresolve(id, taskId, file.path))} /> : <Empty>Pick a file.</Empty>}
      </div>
    </div>
  );
}

/** one file: its header with the sides to take, both sides coloured by language, and the result to edit */
function FilePane({ file, busy, onTake, onSave, onUndo }: { file: ResolveFile; busy: string | null; onTake: (side: 'ours' | 'theirs' | 'both') => void; onSave: (content: string) => void; onUndo: () => void }) {
  const [text, setText] = useState(file.current);
  useEffect(() => setText(file.current), [file.current]);
  const markers = useMemo(() => (text.match(MARKER) ?? []).length, [text]);
  const dirty = text !== file.current;
  const head = (
    <header className="px-3 sm:px-4 py-2.5 border-b border-zinc-800 flex items-center gap-2 flex-wrap">
      <span className="mono text-sm font-semibold text-zinc-100 min-w-0 truncate" title={file.path}>
        {file.path}
      </span>
      {file.conflicted ? <Badge state="warn">conflicted</Badge> : <Badge state="done">resolved</Badge>}
      {file.binary && <Badge state="optional">binary</Badge>}
      <span className="ml-auto flex gap-1.5 flex-wrap">
        {file.conflicted ? (
          <>
            <Button size="sm" variant="info" disabled={!!busy} onClick={() => onTake('ours')} title="Keep the goal branch's version of this file">
              Use ours
            </Button>
            <Button size="sm" variant="info" disabled={!!busy} onClick={() => onTake('theirs')} title="Keep this task's version of this file">
              Use theirs
            </Button>
            {!file.binary && (
              <Button size="sm" disabled={!!busy} onClick={() => onTake('both')} title="Ours followed by theirs (for files where both sides appended)">
                Use both
              </Button>
            )}
          </>
        ) : (
          <Button size="sm" disabled={!!busy} onClick={onUndo} title="Re-create the conflict markers for this file">
            <Undo2 size={13} /> Undo resolution
          </Button>
        )}
      </span>
    </header>
  );
  if (file.binary) {
    return (
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 min-w-0">
        {head}
        <p className="p-4 text-sm text-zinc-400">A binary file cannot be merged line by line: take one side.</p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 min-w-0">
      {head}
      <div className="p-3 sm:p-4 space-y-4">
        {file.conflicted && (
          <div className="grid gap-3 lg:grid-cols-2 min-w-0">
            <Side side="ours" text={file.ours} name={file.path} />
            <Side side="theirs" text={file.theirs} name={file.path} />
          </div>
        )}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">Result</span>
            <span className={cn('text-[11px]', markers ? 'text-orange-300' : 'text-emerald-300/80')}>{markers ? `${markers} conflict marker line${markers > 1 ? 's' : ''} left — remove <<<<<<< / ======= / >>>>>>>` : 'no conflict markers'}</span>
            {markers > 0 && (
              <span className="flex items-center gap-2 text-[10px] text-zinc-500">
                <Swatch cls="bg-emerald-500/40" /> ours <Swatch cls="bg-sky-500/40" /> theirs <Swatch cls="bg-orange-500/50" /> markers
              </span>
            )}
            <span className="ml-auto flex gap-1.5">
              {dirty && (
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setText(file.current)}>
                  Discard edits
                </Button>
              )}
              <Button size="sm" variant="primary" disabled={!!busy || markers > 0 || (!dirty && !file.conflicted)} onClick={() => onSave(text)} title="Write this content and mark the file resolved (git add)">
                <Check size={13} /> {busy === 'save' ? 'Saving…' : 'Save & mark resolved'}
              </Button>
            </span>
          </div>
          <CodeEditor value={text} onChange={setText} name={file.path} className="max-h-[65vh]" />
        </div>
      </div>
    </section>
  );
}

function Swatch({ cls }: { cls: string }) {
  return <span className={cn('inline-block h-2.5 w-2.5 rounded-sm', cls)} aria-hidden="true" />;
}

/** one side of the conflict, coloured by language with line numbers */
function Side({ side, text, name }: { side: 'ours' | 'theirs'; text: string | null; name: string }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className={cn('h-2 w-2 rounded-full', side === 'ours' ? 'bg-emerald-400' : 'bg-sky-400')} />
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">{side === 'ours' ? 'Ours · goal branch' : 'Theirs · task branch'}</span>
      </div>
      {text == null ? <div className="text-xs text-zinc-500 italic rounded-md border border-zinc-800 p-3">The file does not exist on this side.</div> : <CodeView text={text} name={name} className="max-h-[40vh]" />}
    </div>
  );
}
