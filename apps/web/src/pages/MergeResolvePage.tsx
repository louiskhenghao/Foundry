import { AlertTriangle, ArrowLeft, Check, GitMerge, RotateCcw, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type FinishResult, type GoalDetail, type ResolveFile, type ResolveState } from '../api.ts';
import { OpenMenu } from '../components/OpenMenu.tsx';
import { markFill } from '../components/progress.tsx';
import { Badge, Button, Empty, PageHeader, cn, navItemClass } from '../ui.tsx';
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
      <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-3">
        <Link to={`/goals/${id}#tasks`} className="inline-flex text-sm font-bold text-ink hover:underline underline-offset-[3px]">
          ← back to the goal
        </Link>
        <Empty>{cannot}</Empty>
      </div>
    );
  }
  if (!state || !detail) return <Empty>Preparing the conflict in a separate worktree…</Empty>;
  const resolvedCount = state.files.length - state.remaining;
  const repoPath = detail.goal.repoPath;
  const repoName = repoPath.replace(/\/+$/, '').split('/').pop() || repoPath;

  return (
    <div className="max-w-[100rem] mx-auto p-3 sm:p-4 md:p-6 space-y-5">
      {/* the way back, as on the goal page and the Brief */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2.5 text-sm text-ink-faint min-w-0">
        <Link to="/" className="inline-flex shrink-0 items-center gap-1.5 font-bold text-ink hover:underline underline-offset-[3px]">
          <ArrowLeft size={14} aria-hidden="true" /> Goals
        </Link>
        <span aria-hidden="true">/</span>
        <span className="mono truncate" title={repoPath}>{repoName}</span>
        <span aria-hidden="true">/</span>
        <Link to={`/goals/${id}#tasks`} className="shrink-0 font-bold text-ink hover:underline underline-offset-[3px]" title="Back to the goal">
          Goal
        </Link>
      </nav>
      {/* heading: the task, where its branch lands, how far along; the actions on the right */}
      <PageHeader
        title={task?.title ?? taskId}
        summary={
          <>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
              {task && <Badge state={task.state} />}
              <GitMerge size={14} className="shrink-0" aria-hidden="true" />
              <span className="mono">{state.branch}</span> → <span className="mono">{state.into}</span> ·{' '}
              {/* files left to resolve wait for you; all resolved is done */}
              <span className={cn('font-bold', state.remaining ? 'text-you-ink' : 'text-ok-ink')}>
                <span className="mono">{resolvedCount}/{state.files.length}</span> resolved
              </span>
            </span>
            <p className="mt-2 text-sm">
              The conflict was re-created in <span className="mono break-all text-ink-soft">{state.path}</span> so the rest of the goal keeps going. <b className="text-ok-ink">Ours</b> = the goal branch ({state.into}), <b className="text-work-ink">theirs</b> = this task's branch. Resolve each file here (take a side, or edit the result and save) or in your editor, then <b className="text-ink">Finish merge</b>: the engine commits, runs the must checks and lands it on the goal branch.
            </p>
          </>
        }
        actions={
          <>
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
          </>
        }
      />
      {err && <div className="rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-xs text-bad-ink">{err}</div>}
      {finish && (
        // merged: done, in green; checks that failed hold the merge, in red, with the way to land it anyway
        <div className={cn('rounded-lg border p-3 text-sm space-y-2', finish.ok ? 'border-ok/40 bg-ok/5' : 'border-bad/40 bg-bad/5')}>
          <div className="flex items-center gap-2 font-semibold text-ink">
            {finish.ok ? <Check size={14} className="shrink-0 text-ok-ink" /> : <AlertTriangle size={14} className="shrink-0 text-bad-ink" />}
            <span>{finish.ok ? `Merged as ${finish.ref?.slice(0, 7)} — the task is done; back to the goal…` : finish.reason}</span>
          </div>
          {finish.checks.length > 0 && (
            <ul className="text-xs space-y-1">
              {finish.checks.map((c) => (
                <li key={c.name} className="flex gap-2 items-start">
                  <Badge state={c.status === 'pass' ? 'pass' : 'fail'} />
                  <span className="text-ink">{c.name}</span>
                  {c.status !== 'pass' && <span className="text-ink-faint mono whitespace-pre-wrap break-all">{c.summary}</span>}
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

      <div className="grid gap-4 md:gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
        {/* the files as a side list on the page, as the Brief's sections: the one open marked, each with its mark (yellow waits for you, solid is resolved) */}
        <section className="self-start md:sticky md:top-4 md:max-h-[calc(100dvh-5.5rem)] md:overflow-y-auto">
          <header className="px-2.5 pb-2 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint">
            <span>Files</span>
            <b className="mono text-xs tracking-normal text-ink">{state.files.length}</b>
            <span className="ml-auto no-caps font-semibold">
              <span className="mono">{state.remaining}</span> left
            </span>
          </header>
          <div className="space-y-0.5">
            {state.files.map((f) => (
              <button key={f.path} onClick={() => setSel(f.path)} className={navItemClass(sel === f.path)}>
                <span className="flex items-center gap-2">
                  <i className={cn('block h-2.5 w-2.5 shrink-0 rounded-[2px]', markFill[f.conflicted ? 'you' : 'done'])} aria-hidden="true" />
                  <span className="mono text-xs truncate" title={f.path}>
                    {f.path}
                  </span>
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

/** a panel of the page, as the kit's Card draws one */
const PANEL = 'rounded-lg border border-line bg-panel shadow-[0_1px_2px_rgb(0_0_0/0.05)] min-w-0';
/** a label in small capitals, as a figure's on Wayfinding pages */
const LABEL = 'text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint';

/** one file: its header with the sides to take, both sides coloured by language, and the result to edit */
function FilePane({ file, busy, onTake, onSave, onUndo }: { file: ResolveFile; busy: string | null; onTake: (side: 'ours' | 'theirs' | 'both') => void; onSave: (content: string) => void; onUndo: () => void }) {
  const [text, setText] = useState(file.current);
  useEffect(() => setText(file.current), [file.current]);
  const markers = useMemo(() => (text.match(MARKER) ?? []).length, [text]);
  const dirty = text !== file.current;
  const head = (
    <header className="px-3 sm:px-4 py-2.5 border-b border-line flex items-center gap-2 flex-wrap">
      <span className="mono text-sm font-bold text-ink min-w-0 truncate" title={file.path}>
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
      <section className={PANEL}>
        {head}
        <p className="p-4 text-sm text-ink-soft">A binary file cannot be merged line by line: take one side.</p>
      </section>
    );
  }
  return (
    <section className={PANEL}>
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
            <span className={LABEL}>Result</span>
            {/* markers left wait for you to remove them; none left is done */}
            <span className={cn('text-xs font-semibold', markers ? 'text-you-ink' : 'text-ok-ink')}>{markers ? `${markers} conflict marker line${markers > 1 ? 's' : ''} left — remove <<<<<<< / ======= / >>>>>>>` : 'no conflict markers'}</span>
            {markers > 0 && (
              <span className="flex items-center gap-2 text-[11px] text-ink-faint">
                <Swatch cls="bg-ok/40" /> ours <Swatch cls="bg-work/40" /> theirs <Swatch cls="bg-you/60" /> markers
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

/** one side of the conflict, coloured by language with line numbers: ours in the colour of what has landed, theirs in the colour of what comes in */
function Side({ side, text, name }: { side: 'ours' | 'theirs'; text: string | null; name: string }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className={cn('h-2 w-2 rounded-full', side === 'ours' ? 'bg-ok' : 'bg-work')} aria-hidden="true" />
        <span className={LABEL}>{side === 'ours' ? 'Ours · goal branch' : 'Theirs · task branch'}</span>
      </div>
      {text == null ? <div className="text-xs text-ink-faint italic rounded-md border border-line bg-sunken p-3">The file does not exist on this side.</div> : <CodeView text={text} name={name} className="max-h-[40vh]" />}
    </div>
  );
}
