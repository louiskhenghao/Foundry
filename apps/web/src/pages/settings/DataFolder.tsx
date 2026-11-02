import { Check, Clock, FolderOpen, HardDrive, RotateCcw, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, type DataDirMode, type DataDirStatus, type DataDirTest } from '../../api.ts';
import { FolderPicker } from '../../components/FolderPicker.tsx';
import { Button, ConfirmDialog, Input, cn } from '../../ui.tsx';

const fmt = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1024 ** 3 ? `${Math.round(n / 1024 ** 2)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * Waits for the engine to be up again after a restart or a switch (ADR-0082): the status answers with another startedAt —
 * on the folder asked for, or back on the one before with a notice that says why.
 */
export async function waitForEngine(before: string, timeoutMs = 15 * 60_000): Promise<DataDirStatus> {
  const t0 = Date.now();
  for (;;) {
    try {
      const s = await api.dataDir();
      if (s.startedAt !== before) return s;
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('the engine has not come back yet: look at the terminal it runs in');
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const refusal = (e: unknown): { goals: { id: string; title: string; state: string }[]; sessions: number } | null => (e instanceof ApiError && e.status === 409 && Array.isArray(e.body?.goals) ? { goals: e.body.goals, sessions: e.body.sessions ?? 0 } : null);

/** goals a restart was refused for, each a link, so the person can pause them */
function Refused({ goals, sessions }: { goals: { id: string; title: string; state: string }[]; sessions: number }) {
  if (!goals.length) return <span>{plural(sessions, 'session')} in flight: wait until {sessions === 1 ? 'it has' : 'they have'} finished.</span>;
  return (
    <span>
      Pause or wait for:{' '}
      {goals.map((g, i) => (
        <span key={g.id}>
          {i > 0 && ', '}
          <Link to={`/goals/${g.id}`} className="underline hover:text-ink">
            {g.title}
          </Link>{' '}
          <span className="text-ink-faint">({g.state.replace('_', ' ')})</span>
        </span>
      ))}
    </span>
  );
}

/** Restart now, on the restart banner: the Settings marked restart apply once the engine has started again in its process */
export function RestartNowButton() {
  const [restarting, setRestarting] = useState(false);
  const [err, setErr] = useState<React.ReactNode>(null);
  const go = async () => {
    setErr(null);
    try {
      const { startedAt, restart } = await api.dataDir();
      if (!restart.attached) throw new Error('this Foundry was not started with foundry serve: stop it and start it again by hand');
      await api.engineRestart();
      setRestarting(true);
      await waitForEngine(startedAt);
      location.reload();
    } catch (e: any) {
      setRestarting(false);
      const r = refusal(e);
      setErr(r ? <Refused {...r} /> : e.message);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" variant="primary" disabled={restarting} onClick={() => void go()} title="Stops the engine and starts it again in the same process, once no goal is at work; this page reloads when it is back">
        <RotateCcw size={12} strokeWidth={2.5} /> {restarting ? 'Restarting…' : 'Restart now'}
      </Button>
      {err && <span className="text-bad-ink">{err}</span>}
    </span>
  );
}

/** what the serve loop left about the data folder: a switch that fell back, one that failed, a chosen folder not there */
export function DataDirNoticeBanner() {
  const [status, setStatus] = useState<DataDirStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.dataDir().then(setStatus).catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  const n = status?.notice;
  if (!status || !n) return null;
  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await f();
      await load();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-panel py-2.5 pl-4 pr-3 text-xs text-ink inset-ring inset-ring-line shadow-[inset_4px_0_0_var(--color-you)]">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-you text-on-you" aria-hidden="true">
        <HardDrive size={13} strokeWidth={2.5} />
      </span>
      <span className="min-w-0 flex-1 break-words pt-1 space-y-1.5">
        {n.kind === 'missing' && (
          <span>
            <b className="font-bold">The data folder chosen before is not there:</b> <span className="mono">{n.chosen}</span> (a disk not mounted?). Foundry is on <span className="mono">{status.current}</span> meanwhile; the next start looks for the chosen one again.
          </span>
        )}
        {n.kind === 'fell-back' && (
          <span>
            <b className="font-bold">The switch did not take:</b> <span className="mono">{n.from}</span> could not be opened ({n.error}). Foundry is back on <span className="mono">{n.to}</span>.
          </span>
        )}
        {n.kind === 'switch-failed' && (
          <span>
            <b className="font-bold">The switch to <span className="mono">{n.to}</span> failed:</b> {n.error}. Foundry is still on <span className="mono">{status.current}</span>.
          </span>
        )}
        <span className="flex flex-wrap items-center gap-2">
          {n.kind === 'missing' && !status.readOnly && (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void act(api.dataDirKeep)} title="Forget the folder chosen before: this one is the data folder from now on">
              Keep this folder
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(api.dataDirDismiss)}>
            Dismiss
          </Button>
        </span>
      </span>
    </div>
  );
}

/**
 * Settings → Engine (install) → Data folder (ADR-0082): where this Foundry keeps everything, and another folder to move
 * to — tested first (writable, room, a Foundry folder of this coding agent or an empty one), then opened, started blank or
 * given a copy of the current data, behind a confirmation; the engine restarts on it and the page reloads.
 */
export function DataFolder() {
  const [status, setStatus] = useState<DataDirStatus | null>(null);
  const [path, setPath] = useState('');
  const [test, setTest] = useState<DataDirTest | null>(null);
  const [mode, setMode] = useState<DataDirMode>('blank');
  const [testing, setTesting] = useState(false);
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [err, setErr] = useState<React.ReactNode>(null);
  useEffect(() => {
    api
      .dataDir()
      .then(setStatus)
      .catch((e) => setErr(e.message));
  }, []);
  // any change to the path asks for a new test
  const choose = (p: string) => {
    setPath(p);
    setTest(null);
    setErr(null);
  };
  const runTest = async () => {
    setTesting(true);
    setErr(null);
    try {
      const t = await api.dataDirTest(path);
      setTest(t);
      setMode(t.modes.includes('clone') ? 'clone' : (t.modes[0] ?? 'blank'));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setTesting(false);
    }
  };
  const doSwitch = async () => {
    if (!target || !status) return;
    setBusy(true);
    setErr(null);
    try {
      await api.dataDirSwitch(target.path, mode);
      setConfirm(false);
      setSwitching(target.path);
      const after = await waitForEngine(status.startedAt);
      if (after.current === target.path) {
        location.reload();
        return;
      }
      setSwitching(null);
      setStatus(after);
      const n = after.notice;
      setErr(n?.kind === 'fell-back' ? `${n.from} could not be opened (${n.error}); Foundry is back on ${n.to}` : n?.kind === 'switch-failed' ? `the switch failed: ${n.error}` : `the engine came back on ${after.current}`);
    } catch (e: any) {
      setSwitching(null);
      setConfirm(false);
      const r = refusal(e);
      setErr(r ? <Refused {...r} /> : e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!status) return err ? <p className="text-xs text-bad-ink">{err}</p> : null;
  const tested = test && test.input === path ? test : null;
  const target = tested?.ok ? tested : null;
  const source = status.source === 'env' ? 'from FOUNDRY_DATA_DIR' : status.source === 'config' ? 'chosen here' : 'the default';
  return (
    <div className="rounded-md border border-line bg-sunken p-3 space-y-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <HardDrive size={13} className="text-ink-soft" aria-hidden="true" />
        <span className="font-bold text-ink">Data folder</span>
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint inset-ring inset-ring-line">{source}</span>
      </div>
      <div className="mono break-all text-ink">{status.current}</div>
      <p className="text-ink-faint">Everything this Foundry keeps: goals and their history, Settings, access tokens, the coding agents' added accounts, templates, themes and Memory's records. Repositories and progress folders are not in it.</p>
      {status.readOnly ? (
        <p className="text-ink-soft">{status.readOnly.detail}</p>
      ) : switching ? (
        <p className="text-ink">
          Switching to <span className="mono break-all">{switching}</span>… the engine restarts and this page reloads when it is back.{mode === 'clone' ? ' The copy is made first; a big folder takes a few minutes.' : ''}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input className="mono min-w-[14rem] flex-1" value={path} placeholder="/Volumes/Work/foundry-data" onChange={(e) => choose(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && path.trim() && !testing && void runTest()} aria-label="Another data folder" />
            <Button size="sm" onClick={() => setPicker(true)}>
              <FolderOpen size={13} /> Browse…
            </Button>
            <Button size="sm" variant="info" disabled={!path.trim() || testing} onClick={() => void runTest()} title="Looks at the folder without changing anything: writable, room on the disk, what it holds">
              {testing ? 'Testing…' : 'Test'}
            </Button>
          </div>
          {status.recent.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-faint">
              <Clock size={12} aria-hidden="true" /> Before:
              {status.recent.map((r) => (
                <button key={r} type="button" className="mono break-all text-left underline decoration-dotted hover:text-ink" onClick={() => choose(r)}>
                  {r}
                </button>
              ))}
            </div>
          )}
          {tested && (
            <ul className="space-y-1">
              {tested.checks.map((c) => (
                <li key={c.id} className="flex items-start gap-1.5">
                  {c.ok ? <Check size={13} className="mt-px shrink-0 text-ok-ink" aria-hidden="true" /> : <XCircle size={13} className="mt-px shrink-0 text-bad-ink" aria-hidden="true" />}
                  <span className={c.ok ? 'text-ink-soft' : 'text-bad-ink'}>
                    <b className="font-semibold text-ink">{c.label}:</b> {c.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {target?.kind === 'empty' && (
            <div className="space-y-1.5">
              <label className="flex cursor-pointer items-start gap-2">
                <input type="radio" name="data-dir-mode" className="mt-0.5" checked={mode === 'blank'} onChange={() => setMode('blank')} />
                <span>
                  <b className="text-ink">Start blank.</b> No goals, default Settings, no tokens or added accounts: set up again there.
                </span>
              </label>
              <label className={cn('flex items-start gap-2', target.canClone ? 'cursor-pointer' : 'opacity-60')}>
                <input type="radio" name="data-dir-mode" className="mt-0.5" disabled={!target.canClone} checked={mode === 'clone'} onChange={() => setMode('clone')} />
                <span>
                  <b className="text-ink">Copy the current data there ({fmt(target.current.bytes)}).</b> Everything carries over; the copy is made while Foundry is stopped{target.canClone ? '' : ' — not enough room on that disk'}.
                </span>
              </label>
            </div>
          )}
          {target?.kind === 'foundry' && target.folder && (
            <p className="text-ink-soft">
              Opens this folder as it is: {target.folder.goals == null ? 'its' : plural(target.folder.goals, 'goal')}
              {target.folder.version ? `, last opened by Foundry ${target.folder.version}` : ''}.
            </p>
          )}
          {err && <p className="text-bad-ink">{err}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="danger" disabled={!target || busy} onClick={() => (setSure(false), setConfirm(true))}>
              Save &amp; restart…
            </Button>
            <span className="text-ink-faint">{target ? 'Foundry restarts on the other folder; no goal may be at work.' : 'Test a folder first.'}</span>
          </div>
        </>
      )}
      {picker && (
        <FolderPicker
          initial={path || undefined}
          onPick={(p) => {
            choose(p);
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
      <ConfirmDialog open={confirm} danger title="Switch the data folder?" confirmLabel={mode === 'clone' ? 'Copy & restart' : 'Switch & restart'} busy={busy} confirmDisabled={!sure} onConfirm={() => void doSwitch()} onClose={() => !busy && setConfirm(false)}>
        <p>
          Foundry restarts on <span className="mono break-all text-ink">{target?.path}</span>.{' '}
          {mode === 'clone' ? `A copy of the current data (${fmt(target?.current.bytes ?? 0)}) is made there first; a big folder takes a few minutes.` : mode === 'blank' ? 'It starts blank there: no goals, default Settings, no tokens or added accounts.' : `It opens what that folder holds${target?.folder?.goals != null ? ` (${plural(target.folder.goals, 'goal')})` : ''}.`}
        </p>
        <p>
          <b className="text-ink">What changes with it:</b> the goals and their history, Settings, access tokens, the coding agents' added accounts, your templates and themes, Memory's records. Repositories and progress folders stay where they are: both folders point at the same ones.
        </p>
        <p>
          The folder in use, <span className="mono break-all">{status.current}</span>, is left as it is; you can come back to it from here.
        </p>
        <label className="flex cursor-pointer items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          <span>I understand that this Foundry shows other goals and settings after the restart.</span>
        </label>
        {err && <p className="text-bad-ink">{err}</p>}
      </ConfirmDialog>
    </div>
  );
}
