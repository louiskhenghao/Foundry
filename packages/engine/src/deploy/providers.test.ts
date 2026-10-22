import { describe, expect, test } from 'bun:test';
import { type DeployCredentials, type DeployPlanInput, configured, deploySteps, deployedUrl, failureHint, lastWords, projectName, redact, wentToProduction } from './providers.ts';

const creds: DeployCredentials = { vercelToken: 'vcp_SECRET_TOKEN', vercelScope: null, netlifyToken: 'nfp_SECRET_TOKEN', netlifyTeam: 'studio', cloudflareToken: 'cf_SECRET_TOKEN', cloudflareAccountId: 'acc123' };
const plan = (over: Partial<DeployPlanInput>): DeployPlanInput => ({
  provider: 'vercel',
  cwd: '/data/deploy/site-abc123',
  kind: 'built',
  name: 'site-abc123',
  production: false,
  branch: 'goal-g-1',
  productionBranch: 'main',
  install: ['bun', 'install'],
  build: ['bun', 'run', 'build'],
  outputDir: 'dist',
  message: 'Newsletter sign-up',
  credentials: creds,
  cli: (p) => ['npx', '--yes', { vercel: 'vercel@64', netlify: 'netlify-cli@27', cloudflare: 'wrangler@4' }[p]],
  ...over,
});
const secretIn = (steps: ReturnType<typeof deploySteps>) => steps.some((s) => s.argv.join(' ').includes('SECRET'));

describe('deploy commands', () => {
  test('Vercel builds from the source: one command, the token in the environment, --prod only when asked', () => {
    const steps = deploySteps(plan({}));
    expect(steps.map((s) => s.argv.join(' '))).toEqual(['npx --yes vercel@64 deploy --yes']);
    expect(steps[0]!.env).toMatchObject({ VERCEL_TOKEN: 'vcp_SECRET_TOKEN', CI: '1' });
    expect(deploySteps(plan({ production: true, credentials: { ...creds, vercelScope: 'team-x' } }))[0]!.argv.slice(3)).toEqual(['deploy', '--yes', '--prod', '--scope', 'team-x']);
    expect(secretIn(steps)).toBe(false);
  });

  test("Netlify installs, then its CLI builds and deploys to the repository's site; a plain folder is uploaded as it is", () => {
    const steps = deploySteps(plan({ provider: 'netlify', kind: 'ssr', production: true }));
    expect(steps.map((s) => s.label)).toEqual(['install dependencies', 'deploy to Netlify']);
    expect(steps[1]!.argv.slice(3)).toEqual(['deploy', '--json', '--site-name', 'site-abc123', '--team', 'studio', '--prod', '--message', 'Newsletter sign-up']);
    expect(steps[1]!.env.NETLIFY_AUTH_TOKEN).toBe('nfp_SECRET_TOKEN');
    const plain = deploySteps(plan({ provider: 'netlify', kind: 'static', install: null, build: null, outputDir: '.' }));
    expect(plain.map((s) => s.label)).toEqual(['deploy to Netlify']);
    expect(plain[0]!.argv).toContain('--no-build');
    expect(secretIn([...steps, ...plain])).toBe(false);
  });

  test('Cloudflare Pages: built here, the project created once (an existing one is fine), a preview under the goal branch', () => {
    const steps = deploySteps(plan({ provider: 'cloudflare' }));
    // --force: a new project made on Pages itself, not handed to Workers (which rewrites the app and needs another permission)
    expect(steps.map((s) => s.argv.slice(3).join(' '))).toEqual(['', '', 'pages project create site-abc123 --production-branch main --force', 'pages deploy dist --project-name site-abc123 --branch goal-g-1 --commit-dirty=true']);
    expect(steps.slice(0, 2).map((s) => s.argv.join(' '))).toEqual(['bun install', 'bun run build']);
    expect(steps[2]!.okIf!.test('A project with this name already exists [code: 8000002]')).toBe(true);
    expect(steps[3]!.env).toMatchObject({ CLOUDFLARE_API_TOKEN: 'cf_SECRET_TOKEN', CLOUDFLARE_ACCOUNT_ID: 'acc123' });
    expect(deploySteps(plan({ provider: 'cloudflare', production: true })).at(-1)!.argv).toContain('main');
    expect(secretIn(steps)).toBe(false);
  });

  test('a host counts as set up only with everything it needs', () => {
    expect(configured('vercel', creds)).toBe(true);
    expect(configured('cloudflare', { ...creds, cloudflareAccountId: null })).toBe(false);
    expect(configured('netlify', { ...creds, netlifyToken: null })).toBe(false);
  });
});

describe('what a deploy printed', () => {
  test("Netlify's JSON gives the preview or the production address", () => {
    const out = 'Netlify Build ...\n{"site_id":"s1","site_name":"site-abc123","deploy_id":"d1","deploy_url":"https://d1--site-abc123.netlify.app","url":"https://site-abc123.netlify.app"}\n';
    expect(deployedUrl('netlify', out, false)).toBe('https://d1--site-abc123.netlify.app');
    expect(deployedUrl('netlify', out, true)).toBe('https://site-abc123.netlify.app');
  });

  test("Vercel's and Wrangler's last host address, without trailing punctuation", () => {
    expect(deployedUrl('vercel', 'Vercel CLI 64.5.0\nInspect: https://vercel.com/studio/site/abc\nhttps://site-abc123-xyz.vercel.app\n', false)).toBe('https://site-abc123-xyz.vercel.app');
    expect(deployedUrl('cloudflare', '✨ Success! Uploaded 12 files\n✨ Deployment complete! Take a peek over at https://4f2a.site-abc123.pages.dev.\n', false)).toBe('https://4f2a.site-abc123.pages.dev');
    // a preview's branch alias; production's own address rather than the one deploy's
    expect(deployedUrl('cloudflare', '✨ Deployment complete! Take a peek over at https://81eda539.site-abc123.pages.dev\n✨ Deployment alias URL: https://goal-g-1.site-abc123.pages.dev\n', false)).toBe('https://goal-g-1.site-abc123.pages.dev');
    expect(deployedUrl('cloudflare', '✨ Deployment complete! Take a peek over at https://1e0b891f.site-abc123.pages.dev\n', true)).toBe('https://site-abc123.pages.dev');
    expect(deployedUrl('vercel', 'nothing here', false)).toBeNull();
  });

  test("Vercel's JSON: a preview's own address, and a new project's first deploy, which Vercel puts in production whatever was asked", () => {
    const preview = '{\n  "status": "ok",\n  "deployment": { "url": "https://site-abc123-x1-team.vercel.app", "productionUrl": null, "target": null },\n  "next": [{ "command": "vercel deploy --prod" }]\n}\n';
    expect(deployedUrl('vercel', preview, false)).toBe('https://site-abc123-x1-team.vercel.app');
    expect(wentToProduction('vercel', preview, false)).toBe(false);
    const first = '{\n  "status": "ok",\n  "deployment": { "url": "https://site-abc123-x2-team.vercel.app", "productionUrl": "https://site-abc123.vercel.app", "target": "production" },\n  "hint": "This is the project’s first deployment, so it was assigned to production."\n}\n\n<claude-code-hint v="1" />\n';
    expect(wentToProduction('vercel', first, false)).toBe(true);
    expect(deployedUrl('vercel', first, true)).toBe('https://site-abc123.vercel.app');
    expect(wentToProduction('netlify', first, false)).toBe(false);
    expect(wentToProduction('vercel', 'https://site-abc123-xyz.vercel.app', true)).toBe(true);
  });
});

describe('what a failed deploy says', () => {
  test("a team the token cannot reach is named, with where its slug is set; a host's other errors are left as they are", () => {
    const netlify404 = ' ›   Error: Failed to create site: 404: Not Found';
    expect(failureHint('netlify', netlify404, creds)).toBe('Netlify has no team "studio" this token can reach: set Settings → Git & delivery → Netlify team to the team\'s slug (the part after app.netlify.com/teams/), or leave it empty for the token\'s default team');
    expect(failureHint('netlify', netlify404, { ...creds, netlifyTeam: null })).toBeNull();
    expect(failureHint('vercel', 'Error: The specified scope does not exist', { ...creds, vercelScope: 'team-x' })).toContain('Vercel has no team "team-x" this token can reach');
    expect(failureHint('vercel', 'Error: The specified scope does not exist', creds)).toBeNull();
    expect(failureHint('netlify', 'Error: build failed', creds)).toBeNull();
  });

  test("npm's own warnings (npx fetching the CLI) never hide the host's error", () => {
    const out = 'npm warn deprecated @opentelemetry/sdk-trace-node@2.12.0: Use @opentelemetry/sdk-trace package\nnpm warn deprecated glob@8.1.0: Glob versions prior to v9 are no longer supported\nnpm notice New major version of npm available!\n ›   Error: Failed to create site: 404: Not Found\n';
    expect(lastWords(out)).toBe('›   Error: Failed to create site: 404: Not Found');
    expect(lastWords('a\nb\n\nc\nd\ne')).toBe('b · c · d · e');
    // and a CLI's colours are no part of the words
    expect(lastWords('\x1b[31m✘ \x1b[41;31m[\x1b[41;97mERROR\x1b[41;31m]\x1b[0m \x1b[1mNo access to the specified resource.\x1b[0m')).toBe('✘ [ERROR] No access to the specified resource.');
  });
});

test("a host's project name: the folder's name made safe, tagged with the path", () => {
  expect(projectName('/Users/ann/Projects/Studio Site!', 'abcdef123')).toBe('studio-site-abcdef');
  expect(projectName('/', '000000')).toBe('site-000000');
});

test('recorded output never shows a token', () => {
  expect(redact('Error: token vcp_SECRET_TOKEN is invalid; NETLIFY nfp_SECRET_TOKEN', creds)).toBe('Error: token *** is invalid; NETLIFY ***');
});
