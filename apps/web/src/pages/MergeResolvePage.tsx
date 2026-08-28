import { AlertTriangle, Check, ChevronLeft, GitMerge, RotateCcw, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type FinishResult, type GoalDetail, type ResolveFile, type ResolveState } from '../api.ts';
import { OpenMenu } from '../components/OpenMenu.tsx';
import { Badge, Button, Empty, Textarea, cn } from '../ui.tsx';

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
    <div className="max-w-[100rem] mx-auto p-3 sm:p-4 md:p-6 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to={`/goals/${id}#tasks`} className="text-zinc-400 hover:text-zinc-200" title="Back to the goal">
          <ChevronLeft size={18} />
        </Link>
        <GitMerge size={16} className="text-orange-300" />
        <h1 className="text-lg font-semibold min-w-0 truncate">{task?.title ?? taskId}</h1>
        {task && <Badge state={task.state} />}
        <span className="text-xs text-zinc-500 mono">
          {state.branch} → {state.into}
        </span>
        <span className={cn('text-xs rounded-full border px-2 py-0.5', state.remaining ? 'border-orange-500/50 text-orange-300' : 'border-emerald-500/50 text-emerald-300')}>
          {resolvedCount}/{state.files.length} resolved
        </span>
        <span className="ml-auto flex items-center gap-1.5 flex-wrap">
          <OpenMenu goalId={id} places={[{ which: `resolve:${taskId}`, label: 'Resolve worktree', path: state.path, hint: 'edit here, then Finish merge' }]} label="Open in editor" />
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run('restart', () => api.resolve.start(id, taskId, true))} title="Throw away every resolution and re-create the conflict from the current goal branch">
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
      <p className="text-xs text-zinc-500">
        The conflict was re-created in <span className="mono">{state.path}</span> so the rest of the goal keeps going. <b>Ours</b> = the goal branch ({state.into}), <b>theirs</b> = this task's branch. Resolve each file here (take a side, or edit the result and save) or in your editor, then <b>Finish merge</b>: the engine commits, runs the must checks and lands it on the goal branch.
      </p>
      {err && <div className="text-sm text-rose-300">{err}</div>}
      {finish && (
        <div className={cn('rounded-md border p-3 text-sm space-y-2', finish.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5')}>
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
            <Button size="sm" disabled={!!busy} onClick={() => doFinish(true)} title="Land the resolution even though checks fail; the goal review will judge the result">
              Finish anyway
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 space-y-0.5 self-start">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 px-2 py-1">Conflicted files</div>
          {state.files.map((f) => (
            <button key={f.path} onClick={() => setSel(f.path)} className={cn('w-full text-left rounded-md px-2 py-1.5 text-xs flex items-center gap-2', sel === f.path ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900')}>
              <span className={cn('w-2 h-2 rounded-full shrink-0', f.conflicted ? 'bg-orange-400' : 'bg-emerald-400')} />
              <span className="mono truncate" title={f.path}>
                {f.path}
              </span>
            </button>
          ))}
        </div>
        {file ? <FilePane key={file.path} file={file} busy={busy} onTake={(side) => run(side, () => api.resolve.take(id, taskId, file.path, side))} onSave={(content) => run('save', () => api.resolve.file(id, taskId, file.path, content))} onUndo={() => run('undo', () => api.resolve.unresolve(id, taskId, file.path))} /> : <Empty>Pick a file.</Empty>}
      </div>
    </div>
  );
}

function FilePane({ file, busy, onTake, onSave, onUndo }: { file: ResolveFile; busy: string | null; onTake: (side: 'ours' | 'theirs' | 'both') => void; onSave: (content: string) => void; onUndo: () => void }) {
  const [text, setText] = useState(file.current);
  useEffect(() => setText(file.current), [file.current]);
  const markers = useMemo(() => (text.match(MARKER) ?? []).length, [text]);
  const dirty = text !== file.current;
  if (file.binary) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-400 space-y-2">
        <div className="mono text-zinc-200">{file.path}</div>
        <p>Binary file — take one side.</p>
        <div className="flex gap-2">
          <Button size="sm" disabled={!!busy} onClick={() => onTake('ours')}>Use ours (goal branch)</Button>
          <Button size="sm" disabled={!!busy} onClick={() => onTake('theirs')}>Use theirs (task)</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-3 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="mono text-sm text-zinc-100 min-w-0 truncate">{file.path}</span>
        <span className={cn('text-[11px] rounded-full border px-2 py-0.5', file.conflicted ? 'border-orange-500/50 text-orange-300' : 'border-emerald-500/50 text-emerald-300')}>{file.conflicted ? 'conflicted' : 'resolved'}</span>
        <span className="ml-auto flex gap-1.5 flex-wrap">
          {file.conflicted ? (
            <>
              <Button size="sm" disabled={!!busy} onClick={() => onTake('ours')} title="Keep the goal branch's version of this file">
                Use ours
              </Button>
              <Button size="sm" disabled={!!busy} onClick={() => onTake('theirs')} title="Keep this task's version of this file">
                Use theirs
              </Button>
              <Button size="sm" disabled={!!busy} onClick={() => onTake('both')} title="Ours followed by theirs (for files where both sides appended)">
                Use both
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={onUndo} title="Re-create the conflict markers for this file">
              <Undo2 size={13} /> Undo resolution
            </Button>
          )}
        </span>
      </div>
      {file.conflicted && (
        <div className="grid gap-2 md:grid-cols-2 min-w-0">
          <Side title={`ours · goal branch`} text={file.ours} />
          <Side title={`theirs · task branch`} text={file.theirs} />
        </div>
      )}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-zinc-300">Result</span>
          <span className={cn('text-[11px]', markers ? 'text-orange-300' : 'text-zinc-500')}>{markers ? `${markers} conflict marker line${markers > 1 ? 's' : ''} left — remove <<<<<<< / ======= / >>>>>>>` : 'no conflict markers'}</span>
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
        <Textarea rows={22} className="mono text-xs leading-5" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
    </div>
  );
}

function Side({ title, text }: { title: string; text: string | null }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">{title}</div>
      {text == null ? <div className="text-xs text-zinc-500 italic border border-zinc-800 rounded-md p-2">file does not exist on this side</div> : <pre className="mono text-[11px] leading-4 border border-zinc-800 rounded-md p-2 max-h-[40vh] overflow-auto whitespace-pre text-zinc-300">{text}</pre>}
    </div>
  );
}
