import type { DeployReadiness, Deployment } from '@foundry/core/browser';
import { AlertTriangle, Check, ExternalLink, Loader2, RefreshCw, Rocket, ShieldAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type DeployEnvView, type DeployInfo, type DeployPlace, type GoalDetail, type PaasId, type StoreId } from '../../api.ts';
import { EnvDialog } from './EnvDialog.tsx';
import { Button, Card, ConfirmDialog, Loading, ago, choiceClass, cn } from '../../ui.tsx';
import { HelpLink } from '../HelpPage.tsx';
import { RecipeDialog } from '../settings/RecipeDialog.tsx';
import { SmokeView } from './DeploySmoke.tsx';

const KIND: Record<'static' | 'built' | 'ssr', string> = { static: 'a folder of pages, uploaded as it is', built: 'built into files', ssr: 'rendered on the host’s servers' };
/** a platform's runtime in words (ADR-0095) */
const RUNTIME: Record<string, string> = { docker: 'the Dockerfile', node: 'Node.js', python: 'Python', go: 'Go', ruby: 'Ruby', rust: 'Rust', elixir: 'Elixir' };
/** a deploy's state as a small plate: blue while it runs, green once live, red when it failed */
const STATUS: Record<Deployment['status'], string> = { running: 'bg-work/10 text-work-ink ring-work/30', live: 'bg-ok/10 text-ok-ink ring-ok/30', failed: 'bg-bad/10 text-bad-ink ring-bad/40', submitted: 'bg-you/10 text-you-ink ring-you/30' };
/** the stores' names when the card no longer lists them (a deploy made before the project stopped being an Expo app) */
const STORE_NAME: Record<string, string> = { appstore: 'App Store (TestFlight)', play: 'Google Play' };

/** the follow-up goal that makes a project deployable to a server (ADR-0091): a Dockerfile and a compose file, by a coding session that knows the stack */
export const MAKE_DEPLOYABLE_PROMPT =
  'Make this project deployable to a server with Docker, without changing how the application itself works: add a Dockerfile that builds and runs it (a small base image, EXPOSE on the port it listens on, a HEALTHCHECK) and a compose.yaml that starts it with the services it needs (a database, a queue, a cache) and publishes its port, keeping data in named volumes. `docker compose config` and `docker compose build` must pass. Never mount the Docker socket, run privileged, use the host network or bind-mount paths outside the project folder.';

/** one place among the card's, as a key: the host's id, or `server:<its id>` */
export const placeKey = (p: { id: string; target?: string | null }) => (p.target ? `${p.id}:${p.target}` : p.id);
/** how a deploy names its place: the server's name then, or the host's */
export const placeLabel = (x: Pick<Deployment, 'provider' | 'target'>, providers: DeployPlace[] = []) => (x.target ? `${x.target.label} (server)` : (providers.find((p) => p.id === x.provider && !p.target)?.label ?? STORE_NAME[x.provider] ?? x.provider));

/** the place chosen at first: the one this goal last deployed to, while it is set up and takes the code; else the first that is */
export function defaultHost(providers: DeployPlace[], deployments: Deployment[]): string | null {
  const usable = providers.filter((p) => p.configured && !p.refused);
  const last = deployments.at(-1);
  const lastKey = last ? placeKey({ id: last.provider, target: last.target?.id ?? null }) : null;
  const pick = usable.find((p) => placeKey(p) === lastKey) ?? usable[0];
  return pick ? placeKey(pick) : null;
}

/** the readiness check's items (ADR-0091): what the place needs, each found or not, and where to put it right; a warn item is told, never blocks; a recipe (ADR-0092) puts one right from here */
function ReadinessList({ r, checking, subject, onAgain, onRecipe }: { r: DeployReadiness | null; checking: boolean; /** what is checked: the server, or the platform */ subject: string; onAgain: () => void; onRecipe?: (recipe: string, params: Record<string, string>) => void }) {
  const warns = r?.items.filter((i) => !i.ok && i.severity === 'warn').length ?? 0;
  return (
    <div className="rounded-lg border border-line bg-sunken p-3 space-y-1.5">
      <div className="flex items-center gap-2 text-[11px] text-ink-faint">
        <span>{checking ? `Checking ${subject}…` : r ? (r.ok ? (warns ? `Ready; ${warns} thing${warns === 1 ? '' : 's'} to know.` : 'Ready: every check passed.') : 'Not ready yet: put the items below right, then check again.') : 'Not checked yet.'}</span>
        <button type="button" className="ml-auto inline-flex items-center gap-1 font-semibold text-ink-soft hover:text-ink disabled:opacity-50" disabled={checking} onClick={onAgain}>
          {checking ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Check again
        </button>
      </div>
      {r && (
        <ul className="space-y-1">
          {r.items.map((it) => (
            <li key={it.id} className="flex items-start gap-2 text-[11px]">
              {it.ok ? <Check size={12} className="mt-px shrink-0 text-ok-ink" /> : it.severity === 'warn' ? <AlertTriangle size={12} className="mt-px shrink-0 text-you-ink" /> : <X size={12} className="mt-px shrink-0 text-bad-ink" />}
              <span className="min-w-0">
                <span className={cn('font-semibold', it.ok ? 'text-ink' : it.severity === 'warn' ? 'text-you-ink' : 'text-bad-ink')}>{it.label}</span>
                {it.detail && <span className="text-ink-faint"> — {it.detail}</span>}
                {!it.ok && it.fix?.settings && (
                  <>
                    {' '}
                    <Link to={`/settings#${it.fix.settings}`} className="font-semibold text-ink-soft hover:text-ink hover:underline">Settings → Git &amp; delivery</Link>
                  </>
                )}
                {!it.ok && it.fix?.url && (
                  <>
                    {' '}
                    <a href={it.fix.url} target="_blank" rel="noreferrer" className="font-semibold text-ink-soft hover:text-ink hover:underline">how to</a>
                  </>
                )}
                {!it.ok && it.fix?.recipe && onRecipe && (
                  <>
                    {' '}
                    <button type="button" className="font-semibold text-work-ink hover:underline" onClick={() => onRecipe(it.fix!.recipe!, it.fix!.recipeParams ?? {})}>
                      Set it up with a script…
                    </button>
                  </>
                )}
                {!it.ok && it.fix?.command && <pre className="mono mt-1 whitespace-pre-wrap rounded-md border border-line bg-surface p-2 text-[11px] text-ink">{it.fix.command}</pre>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Deploy (ADR-0041, ADR-0091): a finished goal to Vercel, Netlify, Cloudflare Pages or a server of the person's own,
 * on their click — what is deployed (or why nothing is), the places set up, the readiness check and the compose review
 * of a server, the exact commands before anything runs, and the deploys so far, each with its smoke (ADR-0058): the
 * goal's milestone scripts tried against the address afterwards.
 */
export function DeployCard({ d }: { d: GoalDetail }) {
  const g = d.goal;
  const finished = g.state === 'done' || g.state === 'over_delivered';
  const [info, setInfo] = useState<DeployInfo | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [productionAsked, setProduction] = useState(false);
  // the smoke follows the kind of deploy: a preview gets one, production only when asked (a script writes what it tries)
  const [smoke, setSmoke] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState<DeployReadiness | null>(null);
  const [checking, setChecking] = useState(false);
  // a recipe (ADR-0092) opened from a readiness item: which script, with the project's values
  const [recipe, setRecipe] = useState<{ id: string; params: Record<string, string> } | null>(null);
  // the runtime variables of the chosen place (ADR-0095): names only, edited in the dialog
  const [env, setEnv] = useState<DeployEnvView | null>(null);
  const [envOpen, setEnvOpen] = useState(false);
  const [envSaved, setEnvSaved] = useState<string | null>(null);
  const deployments = g.deployments ?? [];
  const chosen = info?.providers.find((p) => placeKey(p) === choice) ?? null;
  const isServer = chosen?.kind === 'server';
  // a platform (ADR-0095) takes the whole project like a server, with a preview beside production like a host
  const isPaas = chosen?.kind === 'paas';
  const paasApp = isPaas && chosen && info ? info.paas[chosen.id as PaasId] : null;
  // a store (ADR-0096): an Expo app built on EAS; iOS goes to TestFlight either way, Android to an APK or to Google Play
  const isStore = chosen?.kind === 'store';
  const storeApp = isStore && chosen && info ? info.stores[chosen.id as StoreId] : null;
  const ios = chosen?.id === 'appstore';
  // a server has no preview: its deploy is production whatever the box says
  const production = isServer || productionAsked;
  useEffect(() => setSmoke(!production && !isStore), [production, isStore]);
  useEffect(() => {
    if (!finished) return;
    let alive = true;
    const [id, target] = (choice ?? '').split(':') as [DeployPlace['id'] | '', string | undefined];
    api
      .deployInfo(g.id, id || null, production, target ?? null)
      .then((i) => {
        if (!alive) return;
        setInfo(i);
        if (!choice) {
          const pick = defaultHost(i.providers, deployments);
          if (pick) setChoice(pick);
        }
      })
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [g.id, choice, production, finished, JSON.stringify(deployments)]);
  // a server is tried over SSH when it is chosen; the button waits for every item that blocks
  const check = async (place: DeployPlace | null) => {
    if (!place) return;
    setChecking(true);
    setReady(null);
    try {
      setReady(await api.deployReadiness(g.id, place.id, place.target));
    } catch (e: any) {
      setReady({ ok: false, at: new Date().toISOString(), items: [{ id: 'check', label: 'Readiness check', ok: false, severity: 'error', detail: e.body?.error ?? e.message, fix: null }] });
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    setReady(null);
    if ((chosen?.kind === 'server' || chosen?.kind === 'paas' || chosen?.kind === 'store') && chosen.configured && !chosen.refused) void check(chosen);
  }, [choice, chosen?.configured, chosen?.refused]);
  // the variables belong to the place: a server's, a platform's (the hosts keep their own environment settings)
  const envPlace = chosen && (chosen.kind === 'server' || chosen.kind === 'paas') ? placeKey(chosen) : null;
  useEffect(() => {
    setEnv(null);
    setEnvSaved(null);
    if (!envPlace || !finished) return;
    let alive = true;
    api.deployEnv(g.id, envPlace).then((e) => alive && setEnv(e)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [envPlace, g.id, finished]);
  if (!finished) return null;

  const run = async () => {
    if (!chosen) return;
    setBusy(true);
    setErr(null);
    try {
      await api.deploy(g.id, chosen.id, production, smoke && scripts > 0, chosen.target);
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
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
  const running = info?.running || deployments.some((x) => x.status === 'running');
  const commands = d.events.filter((e) => e.type === 'deploy.command').slice(-12);
  const nothing = info && !info.app.ok && !info.server.ok && !Object.values(info.paas).some((p) => p.ok) && !Object.values(info.stores).some((p) => p.ok);
  const hosts = info?.providers.filter((p) => p.kind === 'host') ?? [];
  const servers = info?.providers.filter((p) => p.kind === 'server') ?? [];
  const platforms = info?.providers.filter((p) => p.kind === 'paas') ?? [];
  const stores = info?.providers.filter((p) => p.kind === 'store') ?? [];
  // the compose review (ADR-0091): what the file would reach outside its project, refused unless the server allows it
  const review = info?.server.ok ? info.server.app.review : null;
  const dangers = review?.dangers ?? [];
  const blocked = isServer && dangers.length > 0 && !chosen?.permissive;
  const canRun = !!chosen && !chosen.refused && chosen.configured && !busy && !running && !blocked && (!(isServer || isPaas || isStore) || !!ready?.ok);
  const label = running ? (isStore ? 'Building…' : 'Deploying…') : isStore ? (ios ? `Build and upload to TestFlight${production ? ' (production)' : ''}` : production ? 'Build and submit to Google Play' : 'Build an APK for testing') : isServer ? `Deploy to ${chosen?.label}` : production ? `Deploy to ${chosen?.label ?? 'a host'} production` : `Deploy a preview to ${chosen?.label ?? 'a host'}`;
  const followUp = `/goals/new?follows=${g.id}&prompt=${encodeURIComponent(MAKE_DEPLOYABLE_PROMPT)}`;
  const facts = review
    ? [
        `It starts ${info!.server.ok ? info!.server.app.services.join(', ') : ''}${review.built.length ? ` (${review.built.join(', ')} built there from the repository${review.pulled.length ? `; ${review.pulled.join(', ')} pulled as images` : ''})` : review.pulled.length ? ` (pulled as images)` : ''}`,
        review.ports.length ? `publishes port${review.ports.length === 1 ? '' : 's'} ${review.ports.join(', ')}` : 'publishes no port',
        review.volumes.length ? `keeps data in the named volume${review.volumes.length === 1 ? '' : 's'} ${review.volumes.join(', ')}` : '',
        review.binds.length ? `mounts ${review.binds.join(', ')} from the project folder` : '',
      ]
        .filter(Boolean)
        .join('; ')
    : '';
  return (
    <Card id="deploy" className="scroll-mt-16" title={<span className="flex items-center gap-1.5"><Rocket size={13} /> Deploy<HelpLink to="getting-the-result#deploy" className="ml-0.5" /></span>}>
      {!info ? (
        err ? <div className="text-xs text-ink-faint">{err}</div> : <Loading size="card" label="Reading the project…" />
      ) : nothing ? (
        <div className="space-y-1 text-xs text-ink-soft">
          <div>Not deployed to a web host: {info.app.ok ? '' : info.app.reason}</div>
          <div>Not deployed to a server: {info.server.ok ? '' : info.server.reason}</div>
          <div>Not deployed to a platform: {info.paas.railway.ok ? '' : info.paas.railway.reason}</div>
          <div className="pt-1">
            <Link to={followUp} className="font-semibold text-work-ink hover:underline">Add a Dockerfile and a compose file with a follow-up goal</Link>
            <span className="text-ink-faint"> — a coding session writes them for this stack; then a server can run it.</span>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-xs">
          {info.app.ok && (
            <div className="text-[13px] font-semibold text-ink">
              {info.app.app.framework}
              {info.app.app.dir && <span className="mono font-normal text-ink-faint"> · {info.app.app.dir}</span>} <span className="font-normal text-ink-faint">— {KIND[info.app.app.kind]}, for a web host</span>
            </div>
          )}
          {info.server.ok && (
            <div className="text-[13px] font-semibold text-ink">
              {info.server.app.kind === 'compose' ? 'docker compose' : info.server.app.kind === 'dockerfile' ? 'Dockerfile' : `PM2 · ${info.server.app.pm2?.manager}`}
              <span className="mono font-normal text-ink-faint"> · {info.server.app.file}</span>{' '}
              <span className="font-normal text-ink-faint">
                {info.server.app.kind === 'pm2'
                  ? `— ${info.server.app.pm2?.install}${info.server.app.pm2?.build ? `, ${info.server.app.pm2.build}` : ''}, then pm2 startOrReload${info.server.app.port != null ? `, port ${info.server.app.port}` : ''}, on a server of your own in PM2 mode`
                  : `— ${info.server.app.services.length} service${info.server.app.services.length === 1 ? '' : 's'} (${info.server.app.services.join(', ')})${info.server.app.port != null ? `, port ${info.server.app.port}` : ''}, for a server of your own`}
              </span>
            </div>
          )}
          {paasApp?.ok && chosen && (
            <div className="text-[13px] font-semibold text-ink">
              {chosen.label}
              {paasApp.app.dir && <span className="mono font-normal text-ink-faint"> · {paasApp.app.dir}</span>}{' '}
              <span className="font-normal text-ink-faint">
                — the whole project, {paasApp.app.runtime === 'docker' ? 'built from the Dockerfile' : `${RUNTIME[paasApp.app.runtime]} from ${paasApp.app.from}, built by ${chosen.label}`}
                {paasApp.app.port != null ? `, port ${paasApp.app.port}` : ''}
                {chosen.id === 'render' ? ", from the repository's branch on GitHub" : ', from a checkout here'}; {production ? 'production' : chosen.id === 'fly' ? 'a preview app beside production' : chosen.id === 'railway' ? 'the preview environment of the project' : 'a preview service beside production'}
              </span>
            </div>
          )}
          {storeApp?.ok && chosen && (
            <div className="text-[13px] font-semibold text-ink">
              Expo app{storeApp.app.name ? ` ${storeApp.app.name}` : ''}
              {storeApp.app.dir && <span className="mono font-normal text-ink-faint"> · {storeApp.app.dir}</span>}
              {(ios ? storeApp.app.bundleId : storeApp.app.package) && <span className="mono font-normal text-ink-faint"> · {ios ? storeApp.app.bundleId : storeApp.app.package}</span>}{' '}
              <span className="font-normal text-ink-faint">— built in the cloud by EAS from a checkout here; {ios ? (production ? 'uploaded to App Store Connect, into TestFlight: the build you then submit for review there' : 'uploaded to App Store Connect, into TestFlight') : production ? "submitted to Google Play's production track" : 'an APK to install, from the build page (no store)'}</span>
            </div>
          )}
          {(info.app.ok ? info.app.notes : [])
            .concat(info.server.ok && isServer ? info.server.notes : [])
            .concat(paasApp?.ok ? paasApp.notes : [])
            .concat(storeApp?.ok ? storeApp.notes : [])
            .map((n) => (
              <div key={n} className="text-[11px] font-semibold text-ink-soft">{n}</div>
            ))}
          {!info.server.ok && servers.length > 0 && (
            <div className="text-[11px] text-ink-faint">
              Not for a server: {info.server.reason}{' '}
              <Link to={followUp} className="font-semibold text-ink-soft hover:text-ink hover:underline">Add a Dockerfile and a compose file with a follow-up goal</Link>
            </div>
          )}
          {platforms
            .concat(stores)
            .filter((p) => p.configured && p.refused)
            .map((p) => (
              <div key={p.id} className="text-[11px] text-ink-faint">
                Not for {p.label}: {p.refused}
              </div>
            ))}
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Where">
            {hosts.map((p) => (
              <PlaceButton key={placeKey(p)} p={p} chosen={choice === placeKey(p)} onPick={() => setChoice(placeKey(p))} />
            ))}
            <span className="text-[11px] text-ink-faint">· platforms:</span>
            {platforms.map((p) => (
              <PlaceButton key={placeKey(p)} p={p} chosen={choice === placeKey(p)} onPick={() => setChoice(placeKey(p))} />
            ))}
            {stores.length > 0 && <span className="text-[11px] text-ink-faint">· stores:</span>}
            {stores.map((p) => (
              <PlaceButton key={placeKey(p)} p={p} chosen={choice === placeKey(p)} onPick={() => setChoice(placeKey(p))} />
            ))}
            {servers.length > 0 && <span className="text-[11px] text-ink-faint">· servers:</span>}
            {servers.map((p) => (
              <PlaceButton key={placeKey(p)} p={p} chosen={choice === placeKey(p)} onPick={() => setChoice(placeKey(p))} />
            ))}
          </div>
          {!info.providers.some((p) => p.configured) && (
            <div className="text-[11px] text-ink-faint">
              Nothing is set up yet: add a host's or a platform's token, or a server, in <Link to="/settings#git" className="font-semibold text-ink-soft hover:text-ink hover:underline">Settings → Git &amp; delivery</Link>.
            </div>
          )}
          <label className={cn('flex items-center gap-2', isServer ? 'text-ink-faint' : 'text-ink')}>
            <input type="checkbox" checked={production} disabled={isServer} onChange={(e) => setProduction(e.target.checked)} />
            Production <span className="text-ink-faint">{isServer ? '(a server deploy is always production: it replaces what runs there)' : isStore ? (ios ? '(a preview goes to TestFlight too; production is the build you then submit for review)' : '(otherwise an APK to install, no store)') : '(otherwise a preview address)'}</span>
          </label>
          <label className={cn('flex items-center gap-2', scripts && !isStore ? 'text-ink' : 'text-ink-faint')} title={scripts ? 'The scripts run against the deployed address once it is live, with no server of their own; what they show is kept here' : undefined}>
            <input type="checkbox" checked={smoke && scripts > 0 && !isStore} disabled={!scripts || isStore} onChange={(e) => setSmoke(e.target.checked)} />
            Try the milestone scripts against it afterwards{' '}
            <span className="text-ink-faint">{isStore ? '(a store build has no address to try)' : scripts ? `(${scripts} script${scripts === 1 ? '' : 's'}; off for production by default, since a script writes what it tries)` : '(the goal has no milestone scripts)'}</span>
          </label>
          {isServer && dangers.length > 0 && (
            <div className={cn('rounded-lg border p-3 space-y-1', blocked ? 'border-bad/40 bg-bad/5' : 'border-you/40 bg-you/5')} data-testid="compose-review">
              <div className={cn('flex items-center gap-1.5 text-[11px] font-semibold', blocked ? 'text-bad-ink' : 'text-you-ink')}>
                <ShieldAlert size={12} /> {info.server.ok ? info.server.app.file : 'The compose file'} reaches outside its project{blocked ? ', which this server does not allow' : ' — allowed for this server, so it runs'}:
              </div>
              <ul className="list-disc pl-5 text-[11px] text-ink space-y-0.5">
                {dangers.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              {blocked && (
                <div className="text-[11px] text-ink-faint">
                  Edit the file, or allow it for this server under <Link to="/settings#git" className="font-semibold text-ink-soft hover:text-ink hover:underline">Settings → Git &amp; delivery → Servers</Link>.
                </div>
              )}
            </div>
          )}
          {envPlace && env && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-sunken px-3 py-2">
              <span className="text-[11px] font-semibold text-ink">Runtime variables for {chosen?.label}</span>
              <span className="text-[11px] text-ink-faint">
                <span className="mono">{env.keys.length}</span> set
                {env.missing.length > 0 && <span className="font-semibold text-ink-soft"> · <span className="mono">{env.missing.length}</span> in example files not set</span>}
                {env.fromPreview.length > 0 && <> · <span className="mono">{env.fromPreview.length}</span> the previews have</>}
              </span>
              {envSaved && <span className="text-[11px] text-ok-ink">{envSaved}</span>}
              <Button size="sm" className="ml-auto" onClick={() => setEnvOpen(true)}>
                Edit…
              </Button>
            </div>
          )}
          {(isServer || isPaas || isStore) && chosen && !chosen.refused && chosen.configured && <ReadinessList r={ready} checking={checking} subject={isServer ? 'the server' : chosen.label} onAgain={() => void check(chosen)} onRecipe={(id, params) => setRecipe({ id, params })} />}
          {chosen && !chosen.refused && info.plan.length > 0 && (
            <div className="rounded-lg border border-line bg-sunken p-3">
              <div className="text-[11px] text-ink-faint mb-1.5">
                {isServer
                  ? "The exact commands, from a checkout of this goal's commit over SSH — nothing else runs, nothing outside the project's folder is written, and the key file exists only while they do:"
                  : isStore
                    ? 'The commands, in a checkout of this goal\'s commit — EAS builds in the cloud and holds the signing; the token reaches the CLI through its environment, the keys as files that exist only while it runs:'
                    : isPaas && chosen.id === 'render'
                    ? "The calls to Render's API, in order — the service is made once from the repository on GitHub, then this commit is deployed and watched:"
                    : isPaas
                      ? "The exact commands, in a checkout of this goal's commit — the token reaches the CLI through its environment and the variables' values through its input, never a command line:"
                      : "The exact commands, in a checkout of this goal's commit — nothing else runs:"}
              </div>
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
            <Button size="sm" variant="primary" disabled={!canRun} onClick={() => (production ? setConfirm(true) : void run())}>
              {running ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />} {label}
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
                <span className="shrink-0 font-semibold text-ink">{placeLabel(x, info?.providers)}</span>
                <span className="shrink-0 text-ink-faint">{x.production ? 'production' : 'preview'}</span>
                {x.url ? (
                  <a href={x.url} target="_blank" rel="noreferrer" className="mono truncate text-work-ink hover:underline inline-flex items-center gap-1 max-sm:min-h-8">
                    {x.url} <ExternalLink size={11} />
                  </a>
                ) : x.reason ? (
                  <span className="truncate text-bad-ink" title={x.reason}>{x.reason}</span>
                ) : x.status === 'live' ? (
                  <span className="truncate text-ink-faint">running, with no address to open</span>
                ) : null}
                <span className="mono ml-auto shrink-0 text-ink-faint">{ago(x.endedAt ?? x.at)}</span>
              </div>
              {x.store && <StoreLine goalId={g.id} deployment={x} />}
              {!x.store && <SmokeView goalId={g.id} deployment={x} scripts={scripts} busy={busy || !!info?.smoking || running} onAgain={() => void again(x.at)} />}
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
      <ConfirmDialog open={confirm} title={isServer ? `Deploy to the server ${chosen?.label}?` : isStore ? (ios ? 'Build the production app and upload it to TestFlight?' : 'Build and submit to Google Play?') : `Deploy to ${chosen?.label ?? 'the host'} production?`} confirmLabel={isServer ? 'Deploy to the server' : isStore ? (ios ? 'Build and upload' : 'Build and submit') : 'Deploy to production'} busy={busy} onConfirm={() => void run()} onClose={() => setConfirm(false)}>
        {isStore ? (
          <div className="space-y-2">
            {ios ? (
              <>
                <p>This builds the app on EAS from this goal's commit and uploads it to App Store Connect, where it appears in TestFlight once Apple has processed it. Nothing changes for the people who have the app.</p>
                <p>Foundry does not submit it for review: you attach this build to a version in App Store Connect and submit it there. The card follows it from then on — waiting for review, in review, approved, live or rejected — and tells you at each step.</p>
              </>
            ) : (
              <>
                <p>This builds the app bundle on EAS from this goal's commit and submits it to Google Play's production track, to be released to everyone once Google's review is done.</p>
                <p>Google tells no review state through an API: the Play Console shows where it stands, and the card points there.</p>
              </>
            )}
          </div>
        ) : isServer ? (
          <div className="space-y-2">
            {info?.server.ok && info.server.app.kind === 'pm2' ? (
              <>
                <p>This copies the goal's commit to {chosen?.label}, into its own folder under the server's deploy folder, runs {info.server.app.pm2?.install}{info.server.app.pm2?.build ? ` and ${info.server.app.pm2.build}` : ''} there, and starts or reloads it under PM2{info.server.app.port != null ? ` on port ${info.server.app.port}` : ''}.</p>
                <p>The process runs as {chosen?.label}'s ssh user on the host itself, with no container around it: what the project does, it does with that user's rights. Foundry touches this project's folder and its PM2 process only; it never deletes files on the server or changes its configuration.</p>
              </>
            ) : (
              <>
                <p>This copies the goal's commit to {chosen?.label}, into its own folder under the server's deploy folder, and runs docker compose up there. {facts}.</p>
                <p>It replaces this project's own containers only. It never deletes files on the server, and never touches other containers, other projects or the system's configuration; named volumes and files beside the code stay.</p>
              </>
            )}
            {dangers.length > 0 && <p className="text-you-ink">The compose file reaches outside its project, as allowed for this server: {dangers.join('; ')}.</p>}
            {smoke && scripts > 0 && <p>Afterwards the goal's milestone scripts run against the address, and what they try is written there.</p>}
          </div>
        ) : isPaas ? (
          <div className="space-y-2">
            <p>This replaces what the production {chosen?.id === 'railway' ? 'environment' : chosen?.id === 'render' ? 'service' : 'app'} of this project on {chosen?.label} runs now with this goal's commit{chosen?.id === 'render' ? ", built by Render from the base branch on GitHub (which must hold this commit: merge the goal first)" : ''}.</p>
            <p>The preview beside it stays as it is. The runtime variables kept for this place go to {chosen?.label}'s own store first.</p>
            {smoke && scripts > 0 && <p>Afterwards the goal's milestone scripts run against the production address, and what they try is written there.</p>}
          </div>
        ) : (
          <>
            This replaces what the production address of this project serves now with this goal's web app.
            {smoke && scripts > 0 && " Afterwards the goal's milestone scripts run against the production address, and what they try is written there."}
          </>
        )}
      </ConfirmDialog>
      {envPlace && env && (
        <EnvDialog
          open={envOpen}
          env={env}
          title={`Runtime variables · ${chosen?.label}`}
          intro={
            <>
              What the project needs online at this place — a database address, an API key — kept on this computer only and sent with each deploy: a server gets them as an env file its services read (or the environment PM2 starts the process with), a platform through its own secrets. They never enter the goal's folder where the coding agents work, and are hidden in the deploy's record.
            </>
          }
          savedNote=" The next deploy carries them."
          sectionTitle="Set for this place"
          actions={{
            reload: () => api.deployEnv(g.id, envPlace),
            save: (vars, rev) => api.deploySetEnv(g.id, envPlace, vars, rev),
            importCheckout: () => api.deployEnvImport(g.id, envPlace),
            extra: env.fromPreview.length ? [{ label: 'Copy from the previews', title: `The previews of this repository have ${env.fromPreview.length} variable${env.fromPreview.length === 1 ? '' : 's'} this place does not: ${env.fromPreview.join(', ')}.`, run: () => api.deployEnvFromPreview(g.id, envPlace) }] : [],
          }}
          onClose={() => setEnvOpen(false)}
          onSaved={(e, msg) => {
            setEnv(e);
            setEnvSaved(msg);
            setEnvOpen(false);
            if (chosen?.kind === 'server') void check(chosen);
          }}
          onReload={setEnv}
        />
      )}
      {recipe && chosen?.kind === 'server' && (
        <RecipeDialog
          open
          server={{ id: chosen.target!, name: chosen.label, host: chosen.host ?? '', user: chosen.user ?? '' }}
          recipe={recipe.id}
          params={recipe.params}
          onClose={() => setRecipe(null)}
          onFinished={() => void check(chosen)}
        />
      )}
    </Card>
  );
}

/** a store deploy's standing (ADR-0096): the words from the store, the pages to open, when it was last asked, and a way to ask now */
function StoreLine({ goalId, deployment: x }: { goalId: string; deployment: Deployment }) {
  const st = x.store!;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const check = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.deployStoreCheck(goalId);
      setMsg(r.changed ? 'Changed.' : 'No change.');
    } catch (e: any) {
      setMsg(e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };
  const link = (href: string | null, text: string) =>
    href ? (
      <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-work-ink hover:underline inline-flex items-center gap-1">
        {text} <ExternalLink size={10} />
      </a>
    ) : null;
  const watching = x.provider === 'appstore' && x.status === 'submitted' && !st.done;
  return (
    <div className="ml-1 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-soft">
      <span className="min-w-0">{st.state}</span>
      {link(st.buildUrl, 'Build')}
      {st.platform === 'android' && st.artifactUrl && !x.production && link(st.artifactUrl, 'Install the APK')}
      {link(st.submissionUrl, 'Submission')}
      {link(st.consoleUrl, st.platform === 'ios' ? 'App Store Connect' : x.production ? 'Play Console' : 'Build page')}
      {st.checkedAt && <span className="text-ink-faint">checked {ago(st.checkedAt)}</span>}
      {watching && (
        <button type="button" className="inline-flex items-center gap-1 font-semibold text-ink-soft hover:text-ink disabled:opacity-50" disabled={busy} onClick={() => void check()}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Check now
        </button>
      )}
      {msg && <span className="text-ink-faint">{msg}</span>}
    </div>
  );
}

/** a place as a card among others: the chosen one outlined in the accent; one not set up or refusing the code greyed, with the reason as its tooltip */
function PlaceButton({ p, chosen, onPick }: { p: DeployPlace; chosen: boolean; onPick: () => void }) {
  const usable = p.configured && !p.refused;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      disabled={!usable}
      onClick={onPick}
      title={p.refused ?? (p.configured ? undefined : p.kind === 'server' ? 'Add its SSH key in Settings → Git & delivery' : 'Add its token in Settings → Git & delivery')}
      className={cn('rounded-md border px-2.5 py-1 font-semibold text-ink', choiceClass(chosen), !usable && 'opacity-40 cursor-not-allowed')}
    >
      {p.label}
    </button>
  );
}
