/**
 * The hosts a finished goal's web app is deployed to (ADR-0041), as their CLIs are run. Vercel takes the source and
 * builds it; Netlify's CLI builds here with Netlify's build (framework plugins included) and uploads; Cloudflare Pages
 * takes a folder built here, so only static output goes there. Each CLI is pinned to a major version so its flags do not
 * move under Foundry, run from the PATH when installed and through `npx` otherwise. Tokens travel in the environment,
 * never on a command line Foundry records.
 */
export type DeployProvider = 'vercel' | 'netlify' | 'cloudflare';
export const DEPLOY_PROVIDERS: DeployProvider[] = ['vercel', 'netlify', 'cloudflare'];
export const PROVIDER_LABEL: Record<DeployProvider, string> = { vercel: 'Vercel', netlify: 'Netlify', cloudflare: 'Cloudflare Pages' };

/** what a web app is, for a host: a folder as it is, a build that leaves static files, or a server-rendered framework */
export type AppKind = 'static' | 'built' | 'ssr';
/** which kinds each host takes: Cloudflare Pages gets a folder of files, so nothing that renders on a server */
export const SUPPORTS: Record<DeployProvider, AppKind[]> = { vercel: ['static', 'built', 'ssr'], netlify: ['static', 'built', 'ssr'], cloudflare: ['static', 'built'] };

/** the npm package each host's CLI is, and the binary it installs */
export const CLI: Record<DeployProvider, { pkg: string; bin: string }> = {
  vercel: { pkg: 'vercel@64', bin: 'vercel' },
  netlify: { pkg: 'netlify-cli@27', bin: 'netlify' },
  cloudflare: { pkg: 'wrangler@4', bin: 'wrangler' },
};

export interface DeployCredentials {
  vercelToken: string | null;
  /** a Vercel team's slug; null = the token's personal account */
  vercelScope: string | null;
  netlifyToken: string | null;
  /** a Netlify team's slug for a new site; null = the token's default team */
  netlifyTeam: string | null;
  cloudflareToken: string | null;
  cloudflareAccountId: string | null;
}

/** the credentials a host needs are set */
export function configured(p: DeployProvider, c: DeployCredentials): boolean {
  return p === 'vercel' ? !!c.vercelToken : p === 'netlify' ? !!c.netlifyToken : !!(c.cloudflareToken && c.cloudflareAccountId);
}

/** one command of a deploy: what runs (no secret in it), what is added to its environment, and where */
export interface DeployStep {
  label: string;
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  /** a failure that only says the thing already exists (a Cloudflare Pages project) is no failure */
  okIf?: RegExp;
}

export interface DeployPlanInput {
  provider: DeployProvider;
  /** the folder the web app is in (a monorepo's app, or the repository) */
  cwd: string;
  kind: AppKind;
  /** the host's project or site: the same name for every deploy of this repository */
  name: string;
  production: boolean;
  /** the branch Cloudflare files a preview deploy under; production deploys go under `productionBranch` */
  branch: string;
  productionBranch: string;
  /** the commands that install and build the app here, when the host needs it built here */
  install: string[] | null;
  build: string[] | null;
  /** where the build leaves its files (Cloudflare), relative to `cwd` */
  outputDir: string;
  message: string;
  credentials: DeployCredentials;
  /** how a CLI is run: its binary when installed, `npx --yes <pkg>` otherwise */
  cli: (p: DeployProvider) => string[];
}

/** non-interactive everywhere: no prompt can wait for a person who is not there */
const QUIET = { CI: '1', VERCEL_TELEMETRY_DISABLED: '1', NETLIFY_TELEMETRY_DISABLED: '1', WRANGLER_SEND_METRICS: 'false' };

/** The commands a deploy runs, in order; the last one's output names the deployed address. */
export function deploySteps(i: DeployPlanInput): DeployStep[] {
  const c = i.credentials;
  const steps: DeployStep[] = [];
  const at = (label: string, argv: string[], env: Record<string, string> = {}, okIf?: RegExp): DeployStep => ({ label, argv, env: { ...QUIET, ...env }, cwd: i.cwd, ...(okIf ? { okIf } : {}) });
  switch (i.provider) {
    case 'vercel': {
      // Vercel builds the uploaded source itself; the folder is linked to a project named after it on the first deploy
      steps.push(at('deploy to Vercel', [...i.cli('vercel'), 'deploy', '--yes', ...(i.production ? ['--prod'] : []), ...(c.vercelScope ? ['--scope', c.vercelScope] : [])], { VERCEL_TOKEN: c.vercelToken ?? '' }));
      break;
    }
    case 'netlify': {
      if (i.kind !== 'static' && i.install) steps.push(at('install dependencies', i.install));
      // the CLI runs Netlify's build here (framework plugins included) unless the folder needs none
      steps.push(
        at(
          'deploy to Netlify',
          [...i.cli('netlify'), 'deploy', '--json', '--site-name', i.name, ...(c.netlifyTeam ? ['--team', c.netlifyTeam] : []), ...(i.production ? ['--prod'] : []), ...(i.kind === 'static' ? ['--no-build', '--dir', i.outputDir] : []), '--message', i.message.slice(0, 120)],
          { NETLIFY_AUTH_TOKEN: c.netlifyToken ?? '' },
        ),
      );
      break;
    }
    case 'cloudflare': {
      const env = { CLOUDFLARE_API_TOKEN: c.cloudflareToken ?? '', CLOUDFLARE_ACCOUNT_ID: c.cloudflareAccountId ?? '' };
      if (i.kind === 'built') {
        if (i.install) steps.push(at('install dependencies', i.install));
        if (i.build) steps.push(at('build', i.build));
      }
      steps.push(at('create the Pages project (once)', [...i.cli('cloudflare'), 'pages', 'project', 'create', i.name, '--production-branch', i.productionBranch], env, /already exists|8000002/i));
      steps.push(at('deploy to Cloudflare Pages', [...i.cli('cloudflare'), 'pages', 'deploy', i.outputDir, '--project-name', i.name, '--branch', i.production ? i.productionBranch : i.branch, '--commit-dirty=true'], env));
      break;
    }
  }
  return steps;
}

/** the JSON object a CLI printed among its other lines, if any */
function printedJson<T>(stdout: string): T | null {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
type VercelJson = { deployment?: { url?: string; productionUrl?: string | null; target?: string | null } };

/** whether a deploy went to production: asked for, or put there by the host (Vercel does so with a new project's first deploy) */
export function wentToProduction(p: DeployProvider, stdout: string, production: boolean): boolean {
  return production || (p === 'vercel' && printedJson<VercelJson>(stdout)?.deployment?.target === 'production');
}

/** the address a deploy's output names: Netlify's or Vercel's JSON, else the last https address printed */
export function deployedUrl(p: DeployProvider, stdout: string, production: boolean): string | null {
  if (p === 'netlify') {
    const j = printedJson<{ deploy_url?: string; url?: string }>(stdout);
    const url = j && (production ? (j.url ?? j.deploy_url) : (j.deploy_url ?? j.url));
    if (url) return url;
  }
  if (p === 'vercel') {
    const d = printedJson<VercelJson>(stdout)?.deployment;
    const url = d && (production ? (d.productionUrl ?? d.url) : d.url);
    if (url) return url;
  }
  const urls = stdout.match(/https:\/\/[^\s"'<>)\]]+/g) ?? [];
  const hosted = urls.filter((u) => (p === 'vercel' ? /\.vercel\.app/.test(u) : p === 'netlify' ? /netlify\.app/.test(u) : /\.pages\.dev/.test(u)));
  return (hosted.at(-1) ?? urls.at(-1) ?? null)?.replace(/[.,;]+$/, '') ?? null;
}

/** a CLI's text without its colours */
export const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

/** a host's project name for a repository: its folder's name, made safe, and a short tag of its path so two folders of the same name differ */
export function projectName(repoPath: string, hash: string): string {
  const base = (repoPath.split('/').filter(Boolean).at(-1) ?? 'site')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'site'}-${hash.slice(0, 6)}`;
}

/** the last lines of a command's output that say something: npm's own warnings (npx fetching the CLI) left out, so the host's error shows */
export const lastWords = (out: string) =>
  plain(out)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^npm (warn|notice|WARN)\b/.test(l))
    .slice(-4)
    .join(' · ')
    .slice(0, 600);

/** what a host's error means for Foundry's settings, when the host's own words do not say it */
export function failureHint(p: DeployProvider, out: string, c: DeployCredentials): string | null {
  // Netlify answers a team slug the token cannot reach with a bare 404 when it creates the site
  if (p === 'netlify' && c.netlifyTeam && /Failed to create site: 404/i.test(out))
    return `Netlify has no team "${c.netlifyTeam}" this token can reach: set Settings → Git & delivery → Netlify team to the team's slug (the part after app.netlify.com/teams/), or leave it empty for the token's default team`;
  if (p === 'vercel' && c.vercelScope && /specified scope does not exist/i.test(out))
    return `Vercel has no team "${c.vercelScope}" this token can reach: set Settings → Git & delivery → Vercel team to the team's slug (the part after vercel.com/), or leave it empty for the token's own account`;
  return null;
}

/** what a recorded command shows: the token values written out nowhere */
export function redact(text: string, c: DeployCredentials): string {
  let out = text;
  for (const secret of [c.vercelToken, c.netlifyToken, c.cloudflareToken]) if (secret && secret.length >= 6) out = out.split(secret).join('***');
  return out;
}
