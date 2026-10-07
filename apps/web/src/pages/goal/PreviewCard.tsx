import { ExternalLink, Eye, EyeOff, GitBranch, Play, Plus, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type PreviewAppStatus, type PreviewEnv, type PreviewPlace, type PreviewSources, type PreviewStatus, type ServicesStatus, api } from '../../api.ts';
import { Button, Card, CopyButton, Input, Modal, Select, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { WorkspaceDetails } from './WorkspaceDetails.tsx';
import type { Goal } from '@foundry/core/browser';

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

/** this page was opened from another device (over the tailnet), where localhost is that device, not this computer */
const remote = typeof location !== 'undefined' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
/** where to open an app: its tailnet address when the page itself came over the tailnet */
const openUrl = (a: PreviewAppStatus) => (remote && a.tailnetUrl ? a.tailnetUrl : a.url);

/** why the last run ended, with the lines the app printed last; or what to know while it runs */
function Problems({ app }: { app: PreviewAppStatus }) {
  if (app.running)
    return (
      <>
        {app.warning && <div className="text-amber-300">{app.warning}</div>}
        {app.nativePort != null && app.port != null && app.nativePort !== app.port && <div className="text-[11px] text-zinc-500">Usually on port {app.nativePort}, which was taken; runs on {app.port}.</div>}
        {app.rewrites.length > 0 && (
          <div className="text-[11px] text-zinc-500">
            Pointed at the ports the apps got:{' '}
            {app.rewrites.map((r, i) => (
              <span key={`${r.key}:${r.from}`}>
                {i > 0 && ', '}
                <span className="mono text-zinc-400">{r.key}</span> {r.from} → {r.to}
              </span>
            ))}
          </div>
        )}
      </>
    );
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
 * card; on the Overview tab it is the Workspace & preview card, with the goal's folder (`goal`) at the top.
 */
export function PreviewCard({ goalId, embedded, goal }: { goalId: string; embedded?: boolean; goal?: Goal }) {
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
              <a href={openUrl(a)!} target="_blank" rel="noreferrer" onClick={visit} className="inline-flex items-center gap-1 text-emerald-300 hover:underline">
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
                <a href={openUrl(a)!} target="_blank" rel="noreferrer" onClick={visit} title={openUrl(a)!} className="inline-flex items-center gap-1 self-center text-emerald-300 hover:underline">
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

  const where = st?.workspace && <Where goalId={goalId} st={st} busy={!!busy} onChange={load} />;

  const body = (
    <div className="text-xs text-zinc-400 space-y-2">
      {goal && <WorkspaceDetails goal={goal} />}
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
    </div>
  );
  return embedded ? body : <Card title={goal ? 'Workspace & preview' : 'Preview'} actions={allButtons || null}>{body}</Card>;
}

const PLACE_LABEL: Record<PreviewPlace, string> = { auto: 'where it fits', checkout: 'your checkout', foundry: "Foundry's preview folder" };

/**
 * Which branch the preview runs and where. A finished goal can run another branch: its own folder is cleaned up after
 * the merge, and the base branch then holds the work. Another branch runs in the person's checkout when it is on that
 * branch already, else in Foundry's preview folder; the person can pin either.
 */
function Where({ goalId, st, busy, onChange }: { goalId: string; st: PreviewStatus; busy: boolean; onChange: () => Promise<void> }) {
  const w = st.workspace!;
  const [src, setSrc] = useState<PreviewSources | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.previewSources(goalId).then(setSrc).catch(() => {});
  }, [goalId, w.kind, w.branch]);
  const running = st.apps.some((a) => a.running);
  const pick = async (ref: string | undefined, place?: PreviewPlace) => {
    setSaving(true);
    setErr(null);
    try {
      await api.previewSetSource(goalId, ref, place);
      await onChange();
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    } finally {
      setSaving(false);
    }
  };
  const options = src?.options ?? [];
  const current = options.find((o) => o.ref === w.branch);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-x-1.5 gap-y-1 flex-wrap min-w-0 text-[11px] text-zinc-500" title={w.path}>
        <GitBranch size={12} className="shrink-0" />
        <span>Runs</span>
        {src?.selectable && w.place !== 'checkout' ? (
          <span className="w-60 max-w-full">
            <Select aria-label="Branch the preview runs" className="mono text-[11px] py-0.5" value={w.branch} disabled={busy || saving || running} title={running ? 'Stop the preview to pick another branch' : 'The branch the preview runs'} onChange={(e) => pick(e.target.value)}>
              {!options.some((o) => o.ref === w.branch) && <option value={w.branch}>{w.branch}</option>}
              {options.map((o) => (
                <option key={o.ref} value={o.ref} disabled={!o.available} title={o.note}>
                  {o.label}
                  {o.available ? '' : ' (gone)'}
                </option>
              ))}
            </Select>
          </span>
        ) : (
          <span className="mono text-zinc-400 break-all">{w.branch}</span>
        )}
        {w.kind === 'goal' ? <span>in the goal's folder · not your checkout</span> : !src?.selectable ? <span>{w.kind === 'checkout' ? 'in your checkout' : "in Foundry's preview folder · not your checkout"}</span> : (
          <span className="flex items-center gap-1.5">
            in
            <span className="w-48 max-w-full">
              <Select aria-label="Where the preview runs" className="text-[11px] py-0.5" value={w.place} disabled={busy || saving || running} title={running ? 'Stop the preview to change where it runs' : 'Where the preview runs'} onChange={(e) => pick(undefined, e.target.value as PreviewPlace)}>
                {(['auto', 'checkout', 'foundry'] as const).map((p) => (
                  <option key={p} value={p}>
                    {p === 'auto' ? `${w.kind === 'checkout' ? 'your checkout' : "Foundry's preview folder"} (auto)` : PLACE_LABEL[p]}
                  </option>
                ))}
              </Select>
            </span>
          </span>
        )}
        <CopyButton text={w.path} />
      </div>
      {w.kind === 'checkout' && <div className="text-[11px] text-zinc-500 pl-[1.125rem]">Runs your own folder as it is{w.checkoutBranch ? ` on ${w.checkoutBranch}` : ''}, with its dependencies and env files; Foundry never switches, resets or pulls it.</div>}
      {w.kind === 'branch' && w.place === 'auto' && w.checkoutBranch && w.checkoutBranch !== w.branch && <div className="text-[11px] text-zinc-500 pl-[1.125rem]">Your checkout is on {w.checkoutBranch}, so {w.branch} runs in Foundry's preview folder.</div>}
      {src?.selectable && current?.note && <div className="text-[11px] text-zinc-500 pl-[1.125rem]">{current.note[0]!.toUpperCase() + current.note.slice(1)}</div>}
      {w.preparing && <div className="text-[11px] text-zinc-400">Checking out {w.branch} in the preview folder…</div>}
      {w.fallback && <div className="text-[11px] text-amber-300/90">{w.fallback[0]!.toUpperCase() + w.fallback.slice(1)}.</div>}
      {err && <div className="text-[11px] text-rose-300">{err}</div>}
    </div>
  );
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
          <div className="text-zinc-300">{svc.docker === 'in-container' ? "Foundry runs inside Docker without this computer's Docker shared with it. Run the installer again and allow sharing (foundry update), or start these yourself:" : 'Docker is not installed — install it, or start these yourself:'}</div>
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

type Row = { id: number; key: string; value: string; saved: boolean; shown?: boolean; custom?: boolean };
let rowIds = 0;

/** a random secret in the browser: 32 bytes, base64 (what `openssl rand -base64 32` prints) */
const randomSecret = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

/**
 * Variables for this repository's previews, shared by its goals: a summary line on the card, edited in a dialog. The
 * server sends names only: a saved value is never shown again, an empty value field keeps it, typing replaces it.
 * Values reach only the preview's processes (never the goal's folder) and are hidden in its output. The checkout's
 * untracked env files are offered for import, not read on their own.
 */
function EnvPanel({ goalId, anyRunning }: { goalId: string; anyRunning: boolean }) {
  const [env, setEnv] = useState<PreviewEnv | null>(null);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.previewEnv(goalId).then((e) => alive && setEnv(e)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [goalId]);
  if (!env) return null;
  return (
    <div className="border-t border-zinc-800 pt-2 space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-zinc-300 font-medium">Environment</span>
        <span className="text-[11px] text-zinc-500">
          {env.keys.length} set
          {env.missing.length > 0 && <span className="text-amber-300/90"> · {env.missing.length} in example files not set</span>}
          {env.checkout.keys.length > 0 && <> · {env.checkout.keys.length} in your checkout</>}
        </span>
        <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}>
          Edit…
        </Button>
      </div>
      {saved && <div className="text-[11px] text-emerald-300">{saved}</div>}
      <EnvDialog
        open={open}
        env={env}
        goalId={goalId}
        anyRunning={anyRunning}
        onClose={() => setOpen(false)}
        onSaved={(e, msg) => {
          setEnv(e);
          setSaved(msg);
          setOpen(false);
        }}
        onReload={setEnv}
      />
    </div>
  );
}

/** The variables as a table, each name with what it is: its example file comment, a note, and the files that read it. */
function EnvDialog({ open, env, goalId, anyRunning, onClose, onSaved, onReload }: { open: boolean; env: PreviewEnv; goalId: string; anyRunning: boolean; onClose: () => void; onSaved: (e: PreviewEnv, msg: string) => void; onReload: (e: PreviewEnv) => void }) {
  const fresh = (e: PreviewEnv): Row[] => [...e.keys.map((key) => ({ id: ++rowIds, key, value: '', saved: true })), ...e.missing.map((key) => ({ id: ++rowIds, key, value: '', saved: false }))];
  const [rows, setRows] = useState<Row[]>(() => fresh(env));
  const [busy, setBusy] = useState<'save' | 'import' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (open) setMsg(null);
  }, [open]);
  useEffect(() => {
    if (open) setRows(fresh(env));
  }, [open, env.rev]);
  const take = (e: PreviewEnv) => {
    onReload(e);
    setRows(fresh(e));
  };

  const names = rows.filter((r) => r.saved || r.custom || r.value).map((r) => r.key.trim());
  // a saved name sends null (keep its value) unless a new value was typed; an unsaved one is sent only with a value
  const next = Object.fromEntries(rows.filter((r) => r.key.trim() && (r.saved || r.value)).map((r) => [r.key.trim(), r.saved && !r.value ? null : r.value]));
  const dirty = JSON.stringify(Object.keys(next).sort()) !== JSON.stringify([...env.keys].sort()) || Object.values(next).some((v) => v !== null);
  const bad = names.filter((k, i) => k && (!KEY.test(k) || names.indexOf(k) !== i));
  const unnamed = rows.some((r) => !r.key.trim() && r.value);
  const set = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const act = async (what: 'save' | 'import', fn: () => Promise<void>) => {
    setBusy(what);
    setMsg(null);
    try {
      await fn();
    } catch (e: any) {
      // changed elsewhere (another tab, another goal of this repository): show the current set, not a stale one
      if (e.status === 409) await api.previewEnv(goalId).then(take).catch(() => {});
      setMsg({ ok: false, text: e.status === 409 ? 'These variables changed elsewhere; showing the current ones. Your unsaved edits were not kept.' : (e.body?.error ?? e.message) });
    } finally {
      setBusy(null);
    }
  };
  const restartNote = anyRunning ? ' Running apps keep their old values until you stop and start them.' : ' Apps get them the next time they start.';
  const save = () => act('save', async () => onSaved(await api.previewSetEnv(goalId, next, env.rev), `Saved.${restartNote}`));
  const importCheckout = () =>
    act('import', async () => {
      const r = await api.previewImportEnv(goalId);
      take(r.view);
      setMsg({ ok: true, text: r.added.length ? `Imported ${r.added.length}: ${r.added.join(', ')}.${restartNote}` : 'Nothing new to import: every name is already set here.' });
    });
  const noManager = { autoComplete: 'new-password', 'data-1p-ignore': 'true', 'data-lpignore': 'true' } as const;
  const setRows_ = rows.filter((r) => r.saved);
  const unset = rows.filter((r) => !r.saved && !r.custom);
  const custom = rows.filter((r) => r.custom);

  const row = (r: Row) => {
    const n = env.notes[r.key.trim()];
    const lines = [n?.comment, n?.hint && n.hint !== n?.comment ? n.hint : null].filter(Boolean) as string[];
    return (
      <li key={r.id} className="py-2.5 first:pt-0 last:pb-0">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto_auto] gap-1.5 items-center">
          {/* a saved name is fixed: renaming would need its value, which the page never has; remove and add instead */}
          <Input
            aria-label="Variable name"
            value={r.key}
            readOnly={!r.custom}
            title={r.saved ? 'To rename, remove this variable and add it again with its value' : undefined}
            placeholder="NAME"
            spellCheck={false}
            {...noManager}
            onChange={(e) => set(r.id, { key: e.target.value })}
            className={cn('col-span-3 sm:col-span-1 mono text-[11px] py-1', !r.custom && 'text-zinc-200 bg-transparent border-transparent px-0', bad.includes(r.key.trim()) && 'border-rose-500/60')}
          />
          <div className="flex gap-1 min-w-0">
            <Input aria-label={`Value of ${r.key || 'variable'}`} type={r.shown ? 'text' : 'password'} spellCheck={false} {...noManager} value={r.value} placeholder={r.saved ? 'saved · type to replace' : n?.example || 'not set'} onChange={(e) => set(r.id, { value: e.target.value })} className="mono text-[11px] py-1" />
            {n?.generate === 'secret' && (
              <Button size="sm" variant="ghost" className="shrink-0" onClick={() => set(r.id, { value: randomSecret(), shown: true })} title="Fill in a random 32-byte secret">
                Generate
              </Button>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => set(r.id, { shown: !r.shown })} aria-label={r.shown ? 'Hide what you typed' : 'Show what you typed'} title={r.saved ? 'Saved values are never shown again; this shows what you type' : r.shown ? 'Hide' : 'Show'}>
            {r.shown ? <EyeOff size={12} /> : <Eye size={12} />}
          </Button>
          {r.saved || r.custom ? (
            <Button size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} aria-label={`Remove ${r.key || 'variable'}`} title="Remove">
              <X size={12} />
            </Button>
          ) : (
            <span className="w-7" />
          )}
        </div>
        {(lines.length > 0 || (n && (n.file || n.usedIn.length > 0))) && (
          <div className="mt-1 sm:ml-[13.375rem] space-y-0.5 text-[11px]">
            {lines.map((l, i) => (
              <div key={i} className="text-zinc-400">
                {l}
              </div>
            ))}
            {n && (n.file || n.usedIn.length > 0) && (
              <div className="text-zinc-600">
                {n.file && (
                  <>
                    in <span className="mono">{n.file}</span>
                    {n.example && (
                      <>
                        {' '}
                        as <span className="mono">{n.example}</span>
                      </>
                    )}
                  </>
                )}
                {n.file && n.usedIn.length > 0 && ' · '}
                {n.usedIn.length > 0 && (
                  <>
                    read by <span className="mono">{n.usedIn.join(', ')}</span>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <Modal open={open} wide title={`Environment · ${env.repo.split('/').filter(Boolean).pop()}`} onClose={onClose}>
      <div className="space-y-4 text-xs">
        <p className="text-zinc-400">
          Values the previews of this repository need, shared by its goals and stored on this computer only. They go to the preview's processes as environment, never into the goal's folder where the coding agents work, and are hidden in the preview's output.{' '}
          <span className="text-zinc-500">
            They take precedence over the project's own <span className="mono">.env</span> files; Foundry sets <span className="mono">PORT</span> and <span className="mono">FOUNDRY_APP_&lt;KEY&gt;_URL</span> itself.
          </span>
        </p>
        {env.checkout.files.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap rounded-md border border-zinc-800 px-2.5 py-2 text-[11px] text-zinc-400">
            <span className="min-w-0 flex-1">
              Your checkout has <span className="mono text-zinc-300">{env.checkout.files.join(', ')}</span> ({env.checkout.keys.length} variables), which git keeps out of the goal's folder.
            </span>
            <Button size="sm" disabled={!!busy || dirty} onClick={importCheckout} title={dirty ? 'Save or revert your changes first' : 'Copy the variables not set here yet; names already set keep their values'}>
              {busy === 'import' ? 'Importing…' : 'Import from your checkout'}
            </Button>
          </div>
        )}
        {setRows_.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-[11px] uppercase tracking-wide text-zinc-500">Set for this repository · {setRows_.length}</h4>
            <ul className="divide-y divide-zinc-800/70">{setRows_.map(row)}</ul>
          </section>
        )}
        {unset.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-[11px] uppercase tracking-wide text-zinc-500">Listed in example files, not set · {unset.length}</h4>
            <p className="text-[11px] text-zinc-500">Those without an example value come first. Not every one is needed: example files list optional settings too, and some start scripts write their own. Only the ones you fill in are saved.</p>
            <ul className="divide-y divide-zinc-800/70">{unset.map(row)}</ul>
          </section>
        )}
        {custom.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-[11px] uppercase tracking-wide text-zinc-500">Added</h4>
            <ul className="divide-y divide-zinc-800/70">{custom.map(row)}</ul>
          </section>
        )}
        {bad.length > 0 && <div className="text-rose-300 text-[11px]">Names use letters, digits and _ (not starting with a digit), each once: {bad.join(', ')}</div>}
        {unnamed && <div className="text-rose-300 text-[11px]">A value has no name yet.</div>}
        <div className="flex items-center gap-2 flex-wrap border-t border-zinc-800 pt-3">
          <Button size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, { id: ++rowIds, key: '', value: '', saved: false, shown: true, custom: true }])}>
            <Plus size={12} /> Add variable
          </Button>
          <span role="status" className={cn('text-[11px] min-w-0 flex-1', msg?.ok ? 'text-emerald-300' : 'text-rose-300')}>
            {msg?.text}
          </span>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!dirty || !!busy || bad.length > 0 || unnamed} onClick={save}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
