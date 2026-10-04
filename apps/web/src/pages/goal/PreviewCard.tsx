import { ExternalLink, Play, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type PreviewAppStatus, type PreviewStatus, type ServicesStatus, api } from '../../api.ts';
import { Button, Card, CopyButton, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';

const startedByText = (by: PreviewAppStatus['startedBy']) => (by === 'human' ? 'by you' : by === 'milestone' ? 'for the milestone' : by === 'integration' ? 'after a task landed' : null);

/** ready (answering) / starting / failed / stopped */
function StatusDot({ app }: { app: Pick<PreviewAppStatus, 'running' | 'ready' | 'error'> }) {
  const [color, label] = app.running ? (app.ready ? ['bg-emerald-400', 'answering'] : ['bg-amber-400 animate-pulse', 'starting…']) : app.error ? ['bg-rose-400', 'the last run failed'] : ['bg-zinc-600', 'stopped'];
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', color)} title={label} />;
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
  const load = () => api.preview(goalId).then(setSt).catch(() => {});
  const loadServices = () => api.previewServices(goalId).then(setSvc).catch(() => {});
  useEffect(() => {
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
      {st!.error && !err && <div className="text-amber-300">last run: {st!.error}</div>}
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
            {a.error && !a.running && <div className="text-amber-300">last run: {a.error}</div>}
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

  const body = (
    <div className="text-xs text-zinc-400 space-y-2">
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
