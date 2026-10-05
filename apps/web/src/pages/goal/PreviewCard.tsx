import { ChevronRight, ExternalLink, Eye, EyeOff, GitBranch, Play, Plus, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type PreviewAppStatus, type PreviewEnv, type PreviewStatus, type ServicesStatus, api } from '../../api.ts';
import { Button, Card, CopyButton, Input, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';

const startedByText = (by: PreviewAppStatus['startedBy']) => (by === 'human' ? 'by you' : by === 'milestone' ? 'for the milestone' : by === 'integration' ? 'after a task landed' : null);

/** ready (answering) / starting / failed / stopped */
function StatusDot({ app }: { app: Pick<PreviewAppStatus, 'running' | 'ready' | 'error'> }) {
  const [color, label] = app.running ? (app.ready ? ['bg-emerald-400', 'answering'] : ['bg-amber-400 animate-pulse', 'starting…']) : app.error ? ['bg-rose-400', 'the last run failed'] : ['bg-zinc-600', 'stopped'];
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', color)} title={label} />;
}

/** the other servers an app's command started (a demo script's admin, API…), each with its own link */
function AlsoServing({ app, onVisit }: { app: PreviewAppStatus; onVisit: () => void }) {
  if (!app.running || !app.discovered.length) return null;
  return (
    <div className="flex items-center gap-x-1.5 gap-y-1 flex-wrap text-[11px]">
      <span className="text-zinc-500">Also serving</span>
      {app.discovered.map((d) => (
        <a key={d.port} href={d.url} target="_blank" rel="noreferrer" onClick={onVisit} title={`${d.url}${d.dir ? ` · started in ${d.dir}` : ''}`} className="inline-flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-emerald-300 hover:border-emerald-500/50">
          {d.name}
          <span className="mono text-zinc-500">:{d.port}</span>
          <ExternalLink size={10} />
        </a>
      ))}
    </div>
  );
}

/** why the last run ended, with the lines the app printed last; or what to know while it runs */
function Problems({ app }: { app: PreviewAppStatus }) {
  if (app.running) return app.warning ? <div className="text-amber-300">{app.warning}</div> : null;
  if (!app.error) return app.stopped ? <div className="text-[11px] text-zinc-500">Foundry stopped it: {app.stopped}.</div> : null;
  return (
    <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 space-y-1">
      <div className="text-rose-300">The last run failed: {app.error}</div>
      {app.errorDetail.length > 0 && <pre className="mono text-[11px] leading-snug text-zinc-300 whitespace-pre-wrap break-all max-h-40 overflow-auto">{app.errorDetail.join('\n')}</pre>}
    </div>
  );
}

/**
 * The goal's preview, started by the engine in the progress folder: one dev server per app (a monorepo has several),
 * and the Docker services they need. What would run, whether it runs, where to open it. Embedded in the milestone
 * card, and its own card on the Overview tab.
 */
export function PreviewCard({ goalId, selfCheck, embedded }: { goalId: string; selfCheck?: boolean; embedded?: boolean }) {
  const [st, setSt] = useState<PreviewStatus | null>(null);
  const [svc, setSvc] = useState<ServicesStatus | null>(null);
  // what is being done: start:<app key> / stop:<app key>, '*' = every app
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [logs, setLogs] = useState<Set<string>>(new Set());
  // answers for a goal the card no longer shows are dropped (the goal page is reused across goals)
  const shown = useRef(goalId);
  shown.current = goalId;
  const load = () => api.preview(goalId).then((v) => { if (shown.current === goalId) setSt(v); }).catch(() => {});
  const loadServices = () => api.previewServices(goalId).then((v) => { if (shown.current === goalId) setSvc(v); }).catch(() => {});
  useEffect(() => {
    setSt(null);
    setSvc(null);
    setErr(null);
    setLogs(new Set());
    void load();
    void loadServices();
    const t = setInterval(() => void load(), 5000);
    // `docker compose ps` behind it: poll gently
    const s = setInterval(() => void loadServices(), 10_000);
    return () => {
      clearInterval(t);
      clearInterval(s);
    };
  }, [goalId]);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    } finally {
      setBusy(null);
      // starting an app brings the services up first
      void loadServices();
    }
  };
  const toggleLog = (key: string) =>
    setLogs((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const visit = () => void api.previewVisit(goalId);

  const apps = st?.apps ?? [];
  const multi = apps.length > 1;
  const anyRunning = apps.some((a) => a.running);
  const allRunning = apps.every((a) => a.running || !a.run.command);
  const fromText = st?.source === 'brief' ? 'the Brief' : multi ? 'package.json workspaces' : 'package.json';
  const allButtons = multi && (
    <>
      <Button size="sm" variant="primary" disabled={!!busy || allRunning} onClick={() => run('start:*', () => api.previewStart(goalId))} title="Start every app that is not running (Docker services first)">
        <Play size={12} /> {busy === 'start:*' ? 'Starting…' : 'Start all'}
      </Button>
      <Button size="sm" variant="ghost" disabled={!!busy || !anyRunning} onClick={() => run('stop:*', () => api.previewStop(goalId))} title="Stop every app; Docker services keep running">
        <Square size={12} className="fill-current" /> Stop all
      </Button>
    </>
  );

  const single = (a: PreviewAppStatus | undefined) => (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {st!.running && a ? (
          <>
            <StatusDot app={a} />
            <span className="text-zinc-200">
              Running on port {a.port}
              {startedByText(a.startedBy) && <span className="text-zinc-500"> · started {startedByText(a.startedBy)}</span>}
            </span>
            {a.url && (
              <a href={a.url} target="_blank" rel="noreferrer" onClick={visit} className="inline-flex items-center gap-1 text-emerald-300 hover:underline">
                Open preview <ExternalLink size={12} />
              </a>
            )}
            <Button size="sm" variant="ghost" className="ml-auto" disabled={!!busy} onClick={() => run('stop:*', () => api.previewStop(goalId))}>
              <Square size={12} className="fill-current" /> Stop
            </Button>
          </>
        ) : (
          <>
            <span className="text-zinc-300">{st!.run?.command ? 'Not running' : 'Nothing to run yet'}</span>
            <Button size="sm" variant="primary" className="ml-auto" disabled={!!busy || !st!.run?.command} onClick={() => run('start:*', () => api.previewStart(goalId))} title={st!.run?.command ? `runs: ${st!.run.command}` : 'no dev/start script in package.json — the Brief\'s "How to run it" can set a command'}>
              <Play size={12} /> {busy === 'start:*' ? 'Starting…' : 'Start preview'}
            </Button>
          </>
        )}
      </div>
      {st!.run?.command ? (
        <div className="text-[11px] text-zinc-500">
          <span className="mono text-zinc-400 break-all">{st!.running ? st!.command : st!.run.command}</span> <span>· from {fromText}{st!.run.platform === 'expo' ? ' · Expo web' : ''}</span>
        </div>
      ) : (
        <div className="text-[11px] text-zinc-500">No dev or start script in package.json. Once a task adds one, or the Brief's "How to run it" names a command, the preview can start.</div>
      )}
      {a && <AlsoServing app={a} onVisit={visit} />}
      {a && !err && <Problems app={a} />}
    </>
  );

  const appRow = (a: PreviewAppStatus) => {
    const command = a.running ? a.command : a.run.command;
    const showLog = logs.has(a.key);
    return (
      <li key={a.key} className="py-2 first:pt-0 last:pb-0">
        <div className="flex items-start gap-2">
          <span className="flex shrink-0 pt-1">
            <StatusDot app={a} />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
              <span className="text-zinc-200 font-medium">{a.name}</span>
              {a.dir && <span className="mono text-[11px] text-zinc-500 truncate max-w-[14rem]" title={a.dir}>{a.dir}</span>}
              {a.running && a.port != null && <span className="text-[11px] text-zinc-500">:{a.port}</span>}
              {a.running && a.url && (
                <a href={a.url} target="_blank" rel="noreferrer" onClick={visit} title={a.url} className="inline-flex items-center gap-1 self-center text-emerald-300 hover:underline">
                  Open <ExternalLink size={12} />
                </a>
              )}
            </div>
            <div className="flex items-baseline gap-x-2 flex-wrap text-[11px] text-zinc-500">
              {command && <span className="mono text-zinc-400 break-all">{command}</span>}
              {a.running && startedByText(a.startedBy) && <span>· started {startedByText(a.startedBy)}</span>}
              {(a.running || a.log.length > 0) && (
                <button type="button" className="text-zinc-500 hover:text-zinc-300" onClick={() => toggleLog(a.key)}>
                  {showLog ? '▾ hide output' : '▸ output'}
                </button>
              )}
            </div>
            <AlsoServing app={a} onVisit={visit} />
            <Problems app={a} />
          </div>
          {a.running ? (
            <Button size="sm" variant="ghost" className="shrink-0" disabled={!!busy} onClick={() => run(`stop:${a.key}`, () => api.previewStop(goalId, a.key))}>
              <Square size={12} className="fill-current" /> Stop
            </Button>
          ) : (
            <Button size="sm" variant="ghost" className="shrink-0" disabled={!!busy || !a.run.command} onClick={() => run(`start:${a.key}`, () => api.previewStart(goalId, a.key))} title={a.run.command ? `runs: ${a.run.command}` : 'no start command'}>
              <Play size={12} /> {busy === `start:${a.key}` ? 'Starting…' : 'Start'}
            </Button>
          )}
        </div>
        {showLog && <LiveLog attemptId={a.channel} className="mt-1 max-h-48" />}
      </li>
    );
  };

  const where = st?.workspace && (
    <div className="flex items-center gap-x-1.5 gap-y-0.5 flex-wrap min-w-0 text-[11px] text-zinc-500" title={st.workspace.path}>
      <GitBranch size={12} className="shrink-0" />
      <span>Runs in the goal's folder, branch</span>
      <span className="mono text-zinc-400 break-all">{st.workspace.branch}</span>
      <span>· not your checkout</span>
      <CopyButton text={st.workspace.path} />
    </div>
  );

  const body = (
    <div className="text-xs text-zinc-400 space-y-2">
      {where}
      {!st ? (
        <div className="text-zinc-500">…</div>
      ) : multi ? (
        <>
          {embedded && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-zinc-300">
                {apps.length} apps · {apps.filter((a) => a.running).length} running
              </span>
              <span className="ml-auto flex items-center gap-2">{allButtons}</span>
            </div>
          )}
          <ul className="divide-y divide-zinc-800">{apps.map(appRow)}</ul>
          <div className="text-[11px] text-zinc-500">
            From {fromText}. Each app gets the others' addresses as <span className="mono">FOUNDRY_APP_&lt;KEY&gt;_URL</span>.
          </div>
        </>
      ) : (
        single(apps[0])
      )}
      {err && <div className="text-rose-300">{err}</div>}
      {st && !multi && st.running && apps[0] && (
        <div>
          <button type="button" className="text-[11px] text-zinc-500 hover:text-zinc-300" onClick={() => toggleLog(apps[0]!.key)}>
            {logs.has(apps[0].key) ? '▾ hide output' : '▸ server output'}
          </button>
          {logs.has(apps[0].key) && <LiveLog attemptId={apps[0].channel} className="mt-1 max-h-48" />}
        </div>
      )}
      {svc && <Services goalId={goalId} svc={svc} onChange={setSvc} reload={loadServices} />}
      {st && <EnvPanel key={goalId} goalId={goalId} anyRunning={anyRunning} />}
      {selfCheck !== undefined && (
        <label className="flex items-center gap-2 text-[11px] text-zinc-400 cursor-pointer" title="After every task lands, the engine opens this preview in headless Chromium, takes a screenshot and fails a must check on console or network errors. Needs Playwright's Chromium (Settings → Preview & self-check).">
          <input type="checkbox" className="accent-emerald-500" checked={selfCheck} onChange={(e) => run('selfcheck', () => api.setSelfCheck(goalId, e.target.checked))} /> Self-check after each task (screenshot + console errors)
        </label>
      )}
    </div>
  );
  return embedded ? body : <Card title="Preview" actions={allButtons || null}>{body}</Card>;
}

const STATE_CHIP: Record<ServicesStatus['services'][number]['state'], string> = {
  running: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  stopped: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  external: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  unknown: 'bg-zinc-800 text-zinc-500 border-zinc-700',
};

/** The Docker services from the repository's compose file: shared by every goal of the repository, kept running when previews stop. */
function Services({ goalId, svc, onChange, reload }: { goalId: string; svc: ServicesStatus; onChange: (s: ServicesStatus | null) => void; reload: () => Promise<void> }) {
  // start:<name> / stop:<name>, '*' = every service
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const docker = svc.docker === 'available';
  const act = async (key: string, fn: () => Promise<ServicesStatus | null>) => {
    setBusy(key);
    setErr(null);
    try {
      onChange(await fn());
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
      await reload();
    } finally {
      setBusy(null);
    }
  };
  const anyStopped = svc.services.some((s) => s.state === 'stopped' || s.state === 'unknown');
  const anyRunning = svc.services.some((s) => s.state === 'running');
  return (
    <div className="border-t border-zinc-800 pt-2 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-zinc-300 font-medium">Services</span>
        <span className="mono text-[11px] text-zinc-500" title={`Docker Compose project ${svc.project}`}>
          {svc.file}
        </span>
        {docker && (
          <span className="ml-auto flex items-center gap-1">
            <Button size="sm" disabled={!!busy || !anyStopped} onClick={() => act('start:*', () => api.previewServicesStart(goalId))}>
              <Play size={12} /> {busy === 'start:*' ? 'Starting…' : 'Start services'}
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy || !anyRunning} onClick={() => act('stop:*', () => api.previewServicesStop(goalId))} title="Stops the containers; their data is kept">
              <Square size={12} className="fill-current" /> Stop services
            </Button>
          </span>
        )}
      </div>
      <ul className="space-y-1">
        {svc.services.map((s) => {
          const unhealthy = s.state === 'running' && s.health && s.health !== 'healthy';
          const label = s.state === 'running' ? (s.health === 'healthy' ? 'healthy' : s.health || 'running') : s.state === 'external' ? 'in use elsewhere' : s.state;
          return (
            <li key={s.name} className="flex items-center gap-2 min-h-7">
              <div className="min-w-0 flex-1 flex items-center gap-x-2 gap-y-1 flex-wrap">
                <span className="text-zinc-200">{s.name}</span>
                <span className="hidden sm:inline mono text-[11px] text-zinc-500 truncate max-w-[12rem]" title={s.image}>
                  {s.image}
                </span>
                {s.ports.length > 0 && <span className="mono text-[11px] text-zinc-500">{s.ports.map((p) => `:${p}`).join(' ')}</span>}
                <span
                  className={cn('rounded border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide whitespace-nowrap', unhealthy ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : STATE_CHIP[s.state])}
                  title={s.state === 'external' ? `Port ${s.ports.join(', ')} is already taken by something else on this computer (your own ${s.name}?). The apps use that one; Foundry does not start this service.` : undefined}
                >
                  {label}
                </span>
              </div>
              {docker && (s.state === 'running' || s.state === 'stopped') && (
                s.state === 'running' ? (
                  <Button size="sm" variant="ghost" className="shrink-0" disabled={!!busy} onClick={() => act(`stop:${s.name}`, () => api.previewServicesStop(goalId, [s.name]))}>
                    <Square size={12} className="fill-current" /> Stop
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="shrink-0" disabled={!!busy} onClick={() => act(`start:${s.name}`, () => api.previewServicesStart(goalId, [s.name]))}>
                    <Play size={12} /> {busy === `start:${s.name}` ? 'Starting…' : 'Start'}
                  </Button>
                )
              )}
            </li>
          );
        })}
      </ul>
      {!docker && (
        <div className="space-y-1">
          <div className="text-zinc-300">{svc.docker === 'in-container' ? 'Foundry runs inside Docker without access to Docker — start these yourself:' : 'Docker is not installed — install it, or start these yourself:'}</div>
          <div className="flex items-start gap-2 rounded bg-zinc-950/60 border border-zinc-800 px-2 py-1">
            <span className="mono text-[11px] text-zinc-300 break-all grow">{svc.command}</span>
            <CopyButton text={svc.command} />
          </div>
        </div>
      )}
      {(err || svc.error) && <div className="text-rose-300">{err ?? svc.error}</div>}
      <div className="text-[11px] text-zinc-500">Services keep running when previews stop, and are shared by every goal of this repository.</div>
    </div>
  );
}

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

type Row = { id: number; key: string; value: string; saved: boolean; shown?: boolean };
let rowIds = 0;

/**
 * Variables for this repository's previews, shared by its goals. The server sends names only: a saved value is never
 * shown again, an empty value field keeps it, typing replaces it. Values reach only the preview's processes (never the
 * goal's folder) and are hidden in its output. The checkout's untracked env files are offered for import, not read on
 * their own.
 */
function EnvPanel({ goalId, anyRunning }: { goalId: string; anyRunning: boolean }) {
  const [env, setEnv] = useState<PreviewEnv | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'save' | 'import' | null>(null);
  const [allMissing, setAllMissing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const take = (e: PreviewEnv) => {
    setEnv(e);
    setRows(e.keys.map((key) => ({ id: ++rowIds, key, value: '', saved: true })));
  };
  useEffect(() => {
    let alive = true;
    api.previewEnv(goalId).then((e) => alive && take(e)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [goalId]);
  if (!env) return null;

  const names = rows.map((r) => r.key.trim());
  // a saved name sends null (keep its value) unless a new value was typed
  const next = Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.saved && !r.value ? null : r.value]));
  const dirty = JSON.stringify(Object.keys(next).sort()) !== JSON.stringify([...env.keys].sort()) || Object.values(next).some((v) => v !== null);
  const bad = names.filter((k, i) => k && (!KEY.test(k) || names.indexOf(k) !== i));
  const unnamed = rows.some((r) => !r.key.trim() && r.value);
  const missing = env.missing.filter((k) => !(k in next));
  const set = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const add = (key = '') => {
    setOpen(true);
    setRows((rs) => [...rs, { id: ++rowIds, key, value: '', saved: false, shown: true }]);
  };
  const act = async (what: 'save' | 'import', fn: () => Promise<string>) => {
    setBusy(what);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e: any) {
      // changed elsewhere (another tab, another goal of this repository): show the current set, not a stale one
      if (e.status === 409) await api.previewEnv(goalId).then(take).catch(() => {});
      setMsg({ ok: false, text: e.status === 409 ? 'These variables changed elsewhere; showing the current ones. Your unsaved edits were not kept.' : (e.body?.error ?? e.message) });
    } finally {
      setBusy(null);
    }
  };
  const restartNote = anyRunning ? ' Running apps keep their old values until you stop and start them.' : ' Apps get them the next time they start.';
  const save = () =>
    act('save', async () => {
      take(await api.previewSetEnv(goalId, next, env.rev));
      return `Saved.${restartNote}`;
    });
  const importCheckout = () =>
    act('import', async () => {
      const r = await api.previewImportEnv(goalId);
      take(r.view);
      return r.added.length ? `Imported ${r.added.length}: ${r.added.join(', ')}.${restartNote}` : 'Nothing new to import: every name is already set here.';
    });
  const hint = (k: string) => env.example.find((e) => e.key === k);
  const noManager = { autoComplete: 'new-password', 'data-1p-ignore': 'true', 'data-lpignore': 'true' } as const;

  return (
    <div className="border-t border-zinc-800 pt-2 space-y-2">
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ChevronRight size={12} className={cn('shrink-0 text-zinc-500 transition-transform', open && 'rotate-90')} />
        <span className="text-zinc-300 font-medium">Environment</span>
        <span className="text-[11px] text-zinc-500">
          {env.keys.length} set here
          {env.checkout.keys.length > 0 && <> · {env.checkout.keys.length} in your checkout</>}
          {env.example.length > 0 && <> · {env.example.length} in example files</>}
        </span>
      </button>
      {open && (
        <div className="space-y-2 pl-5">
          <p className="text-[11px] text-zinc-500">
            For this repository's previews, shared by its goals, and stored on this computer only. Values go to the preview's processes, never into the goal's folder where the coding agents work, and are hidden in its output and the self-check's report. The preview runs the goal's code, so that code can read them. They take precedence over the project's own <span className="mono">.env</span> files. Foundry sets{' '}
            <span className="mono">PORT</span> and <span className="mono">FOUNDRY_APP_&lt;KEY&gt;_URL</span> itself.
          </p>
          {env.checkout.files.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-zinc-500">
              <span>
                Your checkout has <span className="mono text-zinc-400">{env.checkout.files.join(', ')}</span> ({env.checkout.keys.length} variables), which git keeps out of the goal's folder.
              </span>
              <Button size="sm" variant="ghost" disabled={!!busy || dirty} onClick={importCheckout} title={dirty ? 'Save or revert your changes first' : 'Copy the variables not set here yet; names already set keep their values'}>
                {busy === 'import' ? 'Importing…' : 'Import from your checkout'}
              </Button>
            </div>
          )}
          {rows.length > 0 && (
            <ul className="space-y-1.5">
              {rows.map((r) => (
                <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto_auto] gap-1.5 items-center">
                  {/* a saved name is fixed: renaming would need its value, which the page never has; remove and add instead */}
                  <Input aria-label="Variable name" value={r.key} readOnly={r.saved} title={r.saved ? 'To rename, remove this variable and add it again with its value' : undefined} placeholder="NAME" spellCheck={false} {...noManager} onChange={(e) => set(r.id, { key: e.target.value })} className={cn('col-span-3 sm:col-span-1 mono text-[11px] py-1', r.saved && 'text-zinc-300 bg-transparent', bad.includes(r.key.trim()) && 'border-rose-500/60')} />
                  <Input
                    aria-label={`Value of ${r.key || 'variable'}`}
                    type={r.shown ? 'text' : 'password'}
                    spellCheck={false}
                    {...noManager}
                    value={r.value}
                    placeholder={r.saved ? 'saved · type to replace' : hint(r.key.trim())?.example || 'value'}
                    onChange={(e) => set(r.id, { value: e.target.value })}
                    className="mono text-[11px] py-1"
                  />
                  <Button size="sm" variant="ghost" onClick={() => set(r.id, { shown: !r.shown })} aria-label={r.shown ? 'Hide what you typed' : 'Show what you typed'} title={r.saved ? 'Saved values are never shown again; this shows what you type' : r.shown ? 'Hide' : 'Show'}>
                    {r.shown ? <EyeOff size={12} /> : <Eye size={12} />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} aria-label={`Remove ${r.key || 'variable'}`} title="Remove">
                    <X size={12} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {missing.length > 0 && (
            <div className="space-y-1 text-[11px]">
              <div className="text-zinc-400">
                Listed in example files, not set yet ({missing.length}). Those without an example value come first. Not every one is needed: example files list optional settings too, and some start scripts write their own.
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {(allMissing ? missing : missing.slice(0, 12)).map((k) => (
                  <button key={k} type="button" onClick={() => add(k)} title={`Add ${k} · ${hint(k)?.file ?? ''}${hint(k)?.example ? ` · example: ${hint(k)!.example}` : ' · no example value'}`} className={cn('mono rounded border px-1.5 py-0.5 hover:border-zinc-500', hint(k)?.example ? 'border-zinc-800 text-zinc-500' : 'border-zinc-700 text-zinc-300')}>
                    + {k}
                  </button>
                ))}
                {missing.length > 12 && (
                  <button type="button" className="text-zinc-500 hover:text-zinc-300" onClick={() => setAllMissing((v) => !v)}>
                    {allMissing ? 'Show fewer' : `Show all ${missing.length}`}
                  </button>
                )}
              </div>
            </div>
          )}
          {bad.length > 0 && <div className="text-rose-300 text-[11px]">Names use letters, digits and _ (not starting with a digit), each once: {bad.join(', ')}</div>}
          {unnamed && <div className="text-rose-300 text-[11px]">A value has no name yet.</div>}
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="ghost" onClick={() => add()}>
              <Plus size={12} /> Add variable
            </Button>
            <Button size="sm" variant="primary" disabled={!dirty || !!busy || bad.length > 0 || unnamed} onClick={save}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
            {dirty && (
              <Button size="sm" variant="ghost" onClick={() => take(env)}>
                Revert
              </Button>
            )}
            <span role="status" className={cn('text-[11px]', msg?.ok ? 'text-emerald-300' : 'text-rose-300')}>
              {msg?.text}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
