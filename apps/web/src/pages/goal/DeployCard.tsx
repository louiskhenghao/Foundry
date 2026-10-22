import type { Deployment } from '@foundry/core/browser';
import { ExternalLink, Loader2, Rocket } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type DeployHost, type DeployInfo, type GoalDetail } from '../../api.ts';
import { Button, Card, ConfirmDialog, Loading, ago, choiceClass, cn } from '../../ui.tsx';
import { HelpLink } from '../HelpPage.tsx';
import { SmokeView } from './DeploySmoke.tsx';

const KIND: Record<'static' | 'built' | 'ssr', string> = { static: 'a folder of pages, uploaded as it is', built: 'built into files', ssr: 'rendered on the host’s servers' };
/** a deploy's state as a small plate: blue while it runs, green once live, red when it failed */
const STATUS: Record<Deployment['status'], string> = { running: 'bg-work/10 text-work-ink ring-work/30', live: 'bg-ok/10 text-ok-ink ring-ok/30', failed: 'bg-bad/10 text-bad-ink ring-bad/40' };

/** the host chosen at first: the one this goal last deployed to, while it is set up and takes the app; else the first that is */
export function defaultHost(providers: DeployInfo['providers'], deployments: Deployment[]): DeployHost | null {
  const usable = providers.filter((p) => p.configured && !p.refused);
  const last = deployments.at(-1)?.provider;
  return (usable.find((p) => p.id === last) ?? usable[0])?.id ?? null;
}

/**
 * Deploy (ADR-0041): a finished goal's web app to Vercel, Netlify or Cloudflare Pages on the person's click — what is
 * deployed (or why nothing is), the hosts set up, the exact commands before anything runs, and the deploys so far, each
 * with its smoke (ADR-0058): the goal's milestone scripts tried against the address afterwards.
 */
export function DeployCard({ d }: { d: GoalDetail }) {
  const g = d.goal;
  const finished = g.state === 'done' || g.state === 'over_delivered';
  const [info, setInfo] = useState<DeployInfo | null>(null);
  const [provider, setProvider] = useState<DeployHost | null>(null);
  const [production, setProduction] = useState(false);
  // the smoke follows the kind of deploy: a preview gets one, production only when asked (a script writes what it tries)
  const [smoke, setSmoke] = useState(true);
  useEffect(() => setSmoke(!production), [production]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const deployments = g.deployments ?? [];
  useEffect(() => {
    if (!finished) return;
    let alive = true;
    api
      .deployInfo(g.id, provider, production)
      .then((i) => {
        if (!alive) return;
        setInfo(i);
        if (!provider) {
          const pick = defaultHost(i.providers, deployments);
          if (pick) setProvider(pick);
        }
      })
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [g.id, provider, production, finished, JSON.stringify(deployments)]);
  if (!finished) return null;

  const run = async () => {
    if (!provider) return;
    setBusy(true);
    setErr(null);
    try {
      await api.deploy(g.id, provider, production, smoke && scripts > 0);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  const again = async (deployedAt: string) => {
    setBusy(true);
    setErr(null);
    try {
      await api.smokeDeployment(g.id, deployedAt);
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };
  const scripts = info?.smoke?.scripts.length ?? 0;
  const chosen = info?.providers.find((p) => p.id === provider);
  const running = info?.running || deployments.some((x) => x.status === 'running');
  const commands = d.events.filter((e) => e.type === 'deploy.command').slice(-12);
  return (
    <Card id="deploy" className="scroll-mt-16" title={<span className="flex items-center gap-1.5"><Rocket size={13} /> Deploy<HelpLink to="getting-the-result#deploy" className="ml-0.5" /></span>}>
      {!info ? (
        err ? <div className="text-xs text-ink-faint">{err}</div> : <Loading size="card" label="Reading the project…" />
      ) : !info.app.ok ? (
        <div className="text-xs text-ink-soft">Not deployed: {info.app.reason}</div>
      ) : (
        <div className="space-y-3 text-xs">
          <div className="text-[13px] font-semibold text-ink">
            {info.app.app.framework}
            {info.app.app.dir && <span className="mono font-normal text-ink-faint"> · {info.app.app.dir}</span>} <span className="font-normal text-ink-faint">— {KIND[info.app.app.kind]}</span>
          </div>
          {info.app.notes.map((n) => (
            <div key={n} className="text-[11px] font-semibold text-ink-soft">{n}</div>
          ))}
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Host">
            {info.providers.map((p) => {
              const usable = p.configured && !p.refused;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={provider === p.id}
                  disabled={!usable}
                  onClick={() => setProvider(p.id)}
                  title={p.refused ?? (p.configured ? undefined : 'Add its token in Settings → Git & delivery')}
                  // a host as a card among others: the chosen one outlined in the accent
                  className={cn('rounded-md border px-2.5 py-1 font-semibold text-ink', choiceClass(provider === p.id), !usable && 'opacity-40 cursor-not-allowed')}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          {!info.providers.some((p) => p.configured) && (
            <div className="text-[11px] text-ink-faint">
              No host is set up yet: add a token in <Link to="/settings#git" className="font-semibold text-ink-soft hover:text-ink hover:underline">Settings → Git &amp; delivery</Link>.
            </div>
          )}
          <label className="flex items-center gap-2 text-ink">
            <input type="checkbox" checked={production} onChange={(e) => setProduction(e.target.checked)} />
            Production <span className="text-ink-faint">(otherwise a preview address)</span>
          </label>
          <label className={cn('flex items-center gap-2', scripts ? 'text-ink' : 'text-ink-faint')} title={scripts ? 'The scripts run against the deployed address once it is live, with no server of their own; what they show is kept here' : undefined}>
            <input type="checkbox" checked={smoke && scripts > 0} disabled={!scripts} onChange={(e) => setSmoke(e.target.checked)} />
            Try the milestone scripts against it afterwards{' '}
            <span className="text-ink-faint">{scripts ? `(${scripts} script${scripts === 1 ? '' : 's'}; off for production by default, since a script writes what it tries)` : '(the goal has no milestone scripts)'}</span>
          </label>
          {chosen && !chosen.refused && info.plan.length > 0 && (
            <div className="rounded-lg border border-line bg-sunken p-3">
              <div className="text-[11px] text-ink-faint mb-1.5">The exact commands, in a checkout of this goal's commit — nothing else runs:</div>
              <ol className="space-y-0.5">
                {info.plan.map((s, i) => (
                  <li key={i} className="mono text-[11px] text-ink break-all">
                    <span className="text-ink-faint">{i + 1}.</span> {s.command}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" disabled={!chosen || !!chosen.refused || !chosen.configured || busy || running} onClick={() => (production ? setConfirm(true) : void run())}>
              {running ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />} {running ? 'Deploying…' : production ? `Deploy to ${chosen?.label ?? 'a host'} production` : `Deploy a preview to ${chosen?.label ?? 'a host'}`}
            </Button>
            {err && <span className="text-bad-ink">{err}</span>}
          </div>
        </div>
      )}
      {deployments.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-line pt-3">
          {[...deployments].reverse().map((x, i) => (
            <li key={i} className="text-xs min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className={cn('shrink-0 rounded-sm px-1.5 py-px text-[10.5px] font-bold uppercase tracking-[0.08em] ring-1 ring-inset', STATUS[x.status])}>{x.status}</span>
                <span className="shrink-0 font-semibold text-ink">{info?.providers.find((p) => p.id === x.provider)?.label ?? x.provider}</span>
                <span className="shrink-0 text-ink-faint">{x.production ? 'production' : 'preview'}</span>
                {x.url ? (
                  <a href={x.url} target="_blank" rel="noreferrer" className="mono truncate text-work-ink hover:underline inline-flex items-center gap-1 max-sm:min-h-8">
                    {x.url} <ExternalLink size={11} />
                  </a>
                ) : x.reason ? (
                  <span className="truncate text-bad-ink" title={x.reason}>{x.reason}</span>
                ) : null}
                <span className="mono ml-auto shrink-0 text-ink-faint">{ago(x.endedAt ?? x.at)}</span>
              </div>
              <SmokeView goalId={g.id} deployment={x} scripts={scripts} busy={busy || !!info?.smoking || running} onAgain={() => void again(x.at)} />
            </li>
          ))}
        </ul>
      )}
      {commands.length > 0 && (
        <details className="mt-3">
          <summary className="text-[11px] font-semibold text-ink-faint hover:text-ink cursor-pointer">{commands.length} deploy command{commands.length === 1 ? '' : 's'} — their output</summary>
          <ul className="mt-1.5 space-y-1">
            {commands.map((e) => {
              const p = e.payload as { label: string; command: string; exitCode: number | null; outputTail: string };
              return (
                <li key={e.id}>
                  <div className="mono text-[11px] text-ink-soft break-all">
                    <span className={p.exitCode === 0 ? 'text-ok-ink' : 'text-bad-ink'}>{p.exitCode === 0 ? '✓' : `✗ ${p.exitCode}`}</span> {p.command}
                  </div>
                  {p.outputTail && <pre className="mono text-[11px] whitespace-pre-wrap text-ink-faint bg-sunken border border-line rounded-md p-2 max-h-40 overflow-auto">{p.outputTail}</pre>}
                </li>
              );
            })}
          </ul>
        </details>
      )}
      <ConfirmDialog open={confirm} title={`Deploy to ${chosen?.label ?? 'the host'} production?`} confirmLabel="Deploy to production" busy={busy} onConfirm={() => void run()} onClose={() => setConfirm(false)}>
        This replaces what the production address of this project serves now with this goal's web app.
        {smoke && scripts > 0 && ' Afterwards the goal\'s milestone scripts run against the production address, and what they try is written there.'}
      </ConfirmDialog>
    </Card>
  );
}
