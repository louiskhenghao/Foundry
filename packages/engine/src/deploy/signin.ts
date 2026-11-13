/**
 * Signing in to a deploy place through its own CLI, from Settings (ADR-0097): Fly.io and Netlify open a page in the
 * person's browser, the CLI waits for the approval, and what comes out is a token Foundry keeps in Settings like one
 * pasted by hand — a long-lived Fly.io org token made right after the login (`fly tokens create org`), Netlify's
 * personal access token. The CLI runs with a home folder of its own under the data folder, so nothing is left in the
 * person's dotfiles and the token is read from a place Foundry knows; the folder goes once the sign-in ends. Where
 * the browser cannot open (Foundry in Docker, a server), the page's address is shown to click, and Fly.io's approval
 * code can finish the login from another machine. The CLI is installed too, on a click: flyctl by Fly.io's own
 * installer into `~/.fly`, as the person would do by hand.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Engine } from '../engine.ts';
import { killGroup } from '../proc.ts';
import { plain } from './providers.ts';

export type SignInPlace = 'fly' | 'netlify';
export const SIGNIN_PLACES: SignInPlace[] = ['fly', 'netlify'];
export const SIGNIN_LABEL: Record<SignInPlace, string> = { fly: 'Fly.io', netlify: 'Netlify' };
/** how long a sign-in may wait for the approval */
const SIGNIN_TIMEOUT_MS = 15 * 60_000;

export interface SignInState {
  place: SignInPlace;
  status: 'idle' | 'waiting' | 'done' | 'failed';
  /** the page to approve the sign-in on, once the CLI named it */
  url: string | null;
  /** Fly.io: the approval page shows a code that finishes the login from another machine */
  code: boolean;
  /** who signed in, once known */
  account: string | null;
  /** what happened, in words */
  detail: string;
  /** the CLI's last lines, tokens never among them */
  output: string;
  startedAt: string | null;
  endedAt: string | null;
}
const idle = (place: SignInPlace): SignInState => ({ place, status: 'idle', url: null, code: false, account: null, detail: '', output: '', startedAt: null, endedAt: null });

interface Run {
  state: SignInState;
  home: string;
  proc: ReturnType<typeof Bun.spawn> | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** the browser login waits for an approval; a code typed in finishes it */
  finishing: boolean;
}
const runs = new Map<string, Run>();
const key = (engine: Engine, place: SignInPlace) => `${engine.config.dataDir}\u001f${place}`;

export const signInState = (engine: Engine, place: SignInPlace): SignInState => runs.get(key(engine, place))?.state ?? idle(place);

/** what the CLIs are told to open the browser with: a command that does nothing, so the page opens once, from the Settings page */
const NO_BROWSER = existsSync('/usr/bin/false') ? '/usr/bin/false' : 'false';
/** the marks of a CI machine: flyctl refuses `fly auth login` when it sees one (an empty CI counts), so none reaches a sign-in */
const CI_MARKS = ['CI', 'CONTINUOUS_INTEGRATION', 'BUILD_NUMBER', 'RUN_ID', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'TRAVIS', 'BUILDKITE', 'TEAMCITY_VERSION', 'TF_BUILD', 'APPVEYOR', 'CODEBUILD_BUILD_ID', 'NETLIFY', 'VERCEL', 'FLY_API_TOKEN', 'FLY_ACCESS_TOKEN'];
/** the CLI's whole environment for a sign-in: a home of its own, the real npm cache (so npx does not fetch the CLI again), no update nags, no CI marks and no token of an earlier sign-in */
function signInEnv(home: string): Record<string, string> {
  const real = homedir();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !CI_MARKS.includes(k)) env[k] = v;
  // the page opens from the Settings page in the person's browser, once; the CLI's own attempt would open a second tab
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), npm_config_cache: process.env.npm_config_cache ?? join(real, '.npm'), FLY_NO_UPDATE_CHECK: '1', NO_COLOR: '1', BROWSER: NO_BROWSER };
}
/** `fly` as the person has it: on the PATH, or where Fly.io's installer puts it */
export function flyBin(): string {
  const onPath = Bun.which('fly') ?? Bun.which('flyctl');
  if (onPath) return onPath;
  const home = join(homedir(), '.fly', 'bin', 'fly');
  return existsSync(home) ? home : 'fly';
}

const URL_OF: Record<SignInPlace, RegExp> = { fly: /https:\/\/fly\.io\/app\/auth\/cli\/[A-Za-z0-9]+/, netlify: /https:\/\/app\.netlify\.com\/authorize[^\s"']*/ };

/** start a sign-in; the state tells the rest (a page to open, then done with the account, or failed in words) */
export function startSignIn(engine: Engine, place: SignInPlace): SignInState {
  const k = key(engine, place);
  const cur = runs.get(k);
  if (cur?.state.status === 'waiting') return cur.state;
  const root = join(engine.config.dataDir, 'tmp');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const home = mkdtempSync(join(root, `signin-${place}-`));
  const run: Run = { state: { ...idle(place), status: 'waiting', startedAt: new Date().toISOString(), detail: 'starting the sign-in…' }, home, proc: null, timer: null, finishing: false };
  runs.set(k, run);
  run.timer = setTimeout(() => end(run, 'failed', `no approval within ${SIGNIN_TIMEOUT_MS / 60_000} minutes: start the sign-in again`), SIGNIN_TIMEOUT_MS);
  void (place === 'fly' ? flySignIn(engine, run) : netlifySignIn(engine, run)).catch((err) => end(run, 'failed', String((err as Error).message ?? err)));
  return run.state;
}

/** stop a waiting sign-in; nothing is kept */
export function cancelSignIn(engine: Engine, place: SignInPlace): SignInState {
  const run = runs.get(key(engine, place));
  if (!run) return idle(place);
  if (run.state.status === 'waiting') end(run, 'failed', 'stopped');
  runs.delete(key(engine, place));
  return idle(place);
}

/** Fly.io: finish a login approved on another machine with the code its approval page shows */
export async function finishSignInWithCode(engine: Engine, place: SignInPlace, code: string): Promise<SignInState> {
  const run = runs.get(key(engine, place));
  if (!run || run.state.status !== 'waiting') throw new Error('no sign-in is waiting');
  if (place !== 'fly') throw new Error(`${SIGNIN_LABEL[place]} has no code to finish with: approve the page in the browser`);
  if (!/^[A-Za-z0-9-]{4,}$/.test(code.trim())) throw new Error('the code is letters and digits, as the approval page shows it');
  run.finishing = true;
  const r = await capture(engine, run, [...engine.deployCli('fly'), 'auth', 'login', '--code', code.trim()], 60_000);
  if (r.code !== 0) {
    run.finishing = false;
    throw new Error(`Fly.io did not take the code: ${lastLine(r.out)}`);
  }
  // the waiting login is done for: the session is in the home now
  if (run.proc) killGroup(run.proc as { pid: number; kill: (sig?: number | NodeJS.Signals) => void });
  await flyFinish(engine, run);
  return run.state;
}

function end(run: Run, status: 'done' | 'failed', detail: string) {
  if (run.state.status !== 'waiting') return;
  run.state = { ...run.state, status, detail, endedAt: new Date().toISOString() };
  if (run.timer) clearTimeout(run.timer);
  if (run.proc) {
    try {
      killGroup(run.proc as { pid: number; kill: (sig?: number | NodeJS.Signals) => void });
    } catch {}
  }
  rmSync(run.home, { recursive: true, force: true });
}
const lastLine = (out: string) => plain(out).trim().split('\n').filter(Boolean).at(-1) ?? '';

/** a short command in the sign-in's home, its output kept (tokens blanked by the caller) */
async function capture(engine: Engine, run: Run, argv: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(argv, { cwd: run.home, env: signInEnv(run.home), stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  const t = setTimeout(() => killGroup(proc as { pid: number; kill: (sig?: number | NodeJS.Signals) => void }), timeoutMs);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  clearTimeout(t);
  void engine;
  return { code, out: `${out}\n${err}` };
}

/** the browser login as a long-running process: its lines read as they come, the page's address picked out */
function watch(run: Run, argv: string[], onLine?: (line: string) => void): Promise<number> {
  const proc = Bun.spawn(argv, { cwd: run.home, env: signInEnv(run.home), stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  run.proc = proc;
  const tail: string[] = [];
  const read = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    let rest = '';
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      rest += new TextDecoder().decode(chunk);
      const lines = rest.split('\n');
      rest = lines.pop() ?? '';
      for (const l of lines) {
        const line = plain(l).trimEnd();
        if (!line) continue;
        tail.push(line);
        if (tail.length > 20) tail.shift();
        run.state = { ...run.state, output: tail.join('\n') };
        const m = line.match(URL_OF[run.state.place]);
        if (m && !run.state.url) run.state = { ...run.state, url: m[0], code: run.state.place === 'fly', detail: 'approve the sign-in in the browser' };
        onLine?.(line);
      }
    }
    if (rest.trim()) {
      tail.push(plain(rest).trimEnd());
      run.state = { ...run.state, output: tail.join('\n') };
    }
  };
  return Promise.all([read(proc.stdout as ReadableStream<Uint8Array> | null), read(proc.stderr as ReadableStream<Uint8Array> | null)]).then(() => proc.exited);
}

async function flySignIn(engine: Engine, run: Run) {
  const fly = engine.deployCli('fly');
  run.state = { ...run.state, detail: 'opening Fly.io’s sign-in page…' };
  const code = await watch(run, [...fly, 'auth', 'login']);
  if (run.state.status !== 'waiting') return;
  if (run.finishing) return;
  if (code !== 0) return end(run, 'failed', `fly auth login ended (exit ${code}): ${lastLine(run.state.output)}`);
  await flyFinish(engine, run);
}

/** after the browser approval: who it is, then a long-lived org token for Settings (the session's own token expires soon) */
async function flyFinish(engine: Engine, run: Run) {
  if (run.state.status !== 'waiting') return;
  const fly = engine.deployCli('fly');
  const who = await capture(engine, run, [...fly, 'auth', 'whoami'], 60_000);
  const account = who.code === 0 ? lastLine(who.out) : null;
  // the token is an organization's, and flyctl names no default when no person is at the terminal: the one from
  // Settings (its slug, or its name turned into the slug — `fly apps create --org` takes slugs only), else the
  // account's only one, else its personal one; several others are the person's to choose from
  const listed = await capture(engine, run, [...fly, 'orgs', 'list', '--json'], 60_000);
  const orgs = flyOrgs(listed.out);
  const slugs = Object.keys(orgs);
  const chosen = flyOrgSlug(engine.settings.values().delivery.flyOrg, orgs);
  if (!chosen.slug) return end(run, 'failed', `signed in${account ? ` as ${account}` : ''}, but ${chosen.why}: set Fly.io organization in Settings to one of ${slugs.length ? slugs.join(', ') : 'the account’s organization slugs'}, then sign in again`);
  const org = chosen.slug;
  const made = await capture(engine, run, [...fly, 'tokens', 'create', 'org', '--name', 'Foundry (deploys)', '--expiry', '87600h', '--json', '--org', org], 120_000);
  let token: string | null = null;
  try {
    const j = JSON.parse(made.out.slice(made.out.indexOf('{'), made.out.lastIndexOf('}') + 1)) as { token?: string };
    token = typeof j.token === 'string' ? j.token.trim() : null;
  } catch {}
  if (!token) token = made.out.match(/FlyV1\s+\S+/)?.[0]?.trim() ?? null;
  if (made.code !== 0 || !token) return end(run, 'failed', `signed in${account ? ` as ${account}` : ''}, but no token could be made (${lastLine(made.out)}): make one with \`fly tokens create org\` and paste it`);
  // the organization the token belongs to is the one the deploys go to
  const was = engine.settings.values().delivery.flyOrg;
  engine.updateSettings({ delivery: { flyToken: token, flyOrg: org } });
  run.state = { ...run.state, account, output: '' };
  end(run, 'done', `signed in${account ? ` as ${account}` : ''}; an organization token named “Foundry (deploys)” for ${org}${orgs[org] && orgs[org] !== org ? ` (${orgs[org]})` : ''} is saved in Settings${was && was !== org ? ` — the organization setting was “${was}” and is ${org} now, the slug flyctl takes` : ''}`);
}

async function netlifySignIn(engine: Engine, run: Run) {
  const cli = engine.deployCli('netlify');
  run.state = { ...run.state, detail: 'asking Netlify for a sign-in ticket…' };
  const req = await capture(engine, run, [...cli, 'login', '--request', 'Foundry (deploys)', '--json'], 120_000);
  let ticket: { ticket_id?: string; url?: string } = {};
  try {
    ticket = JSON.parse(req.out.slice(req.out.indexOf('{'), req.out.lastIndexOf('}') + 1)) as typeof ticket;
  } catch {}
  if (req.code !== 0 || !ticket.ticket_id || !ticket.url) return end(run, 'failed', `Netlify gave no sign-in ticket: ${lastLine(req.out)}`);
  run.state = { ...run.state, url: ticket.url, detail: 'approve the sign-in in the browser' };
  while (run.state.status === 'waiting') {
    await new Promise((r) => setTimeout(r, engine.signInPollMs));
    if (run.state.status !== 'waiting') return;
    const chk = await capture(engine, run, [...cli, 'login', '--check', ticket.ticket_id, '--json'], 120_000);
    let status: { status?: string; user?: { email?: string; name?: string } } = {};
    try {
      status = JSON.parse(chk.out.slice(chk.out.indexOf('{'), chk.out.lastIndexOf('}') + 1)) as typeof status;
    } catch {}
    if (status.status === 'denied') return end(run, 'failed', 'Netlify says the sign-in was denied or the ticket is gone: start again');
    if (status.status !== 'authorized') continue;
    const token = netlifyTokenIn(run.home);
    if (!token) return end(run, 'failed', 'Netlify approved the sign-in, but its CLI left no token to read: make a personal access token on app.netlify.com and paste it');
    engine.updateSettings({ delivery: { netlifyToken: token } });
    run.state = { ...run.state, account: status.user?.email ?? status.user?.name ?? null, output: '' };
    return end(run, 'done', `signed in${status.user?.email ? ` as ${status.user.email}` : ''}; the personal access token Netlify made is saved in Settings`);
  }
}

/**
 * The organizations `fly orgs list --json` names: slug to name. flyctl prints that map (`{"personal":"Louis"}`); a
 * list of org records (`Slug`/`Name`) or of slugs is read too, should a version print one.
 */
export function flyOrgs(out: string): Record<string, string> {
  const starts = [out.indexOf('{'), out.indexOf('[')].filter((i) => i >= 0);
  if (!starts.length) return {};
  const start = Math.min(...starts);
  const end = Math.max(out.lastIndexOf('}'), out.lastIndexOf(']'));
  try {
    const j = JSON.parse(out.slice(start, end + 1)) as unknown;
    if (Array.isArray(j)) {
      const out: Record<string, string> = {};
      for (const o of j) {
        if (typeof o === 'string') out[o] = o;
        else if (o && typeof o === 'object') {
          const r = o as Record<string, unknown>;
          const slug = typeof r.Slug === 'string' ? r.Slug : typeof r.slug === 'string' ? r.slug : null;
          if (slug) out[slug] = typeof r.Name === 'string' ? r.Name : typeof r.name === 'string' ? r.name : slug;
        }
      }
      return out;
    }
    if (j && typeof j === 'object') return Object.fromEntries(Object.entries(j as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : k]));
  } catch {}
  return {};
}
export const flyOrgSlugs = (out: string) => Object.keys(flyOrgs(out));
/**
 * The slug of the organization Foundry deploys to: the setting when it is a slug, the slug of the organization the
 * setting names (a personal organization is shown by the person's name, its slug is `personal`), else the account's
 * only one, else its personal one; otherwise why none was picked.
 */
export function flyOrgSlug(setting: string | null, orgs: Record<string, string>): { slug: string | null; why: string } {
  const slugs = Object.keys(orgs);
  // "Louis Loo" and "louis-loo" are the same name
  const plainName = (x: string) => x.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (setting) {
    if (setting in orgs) return { slug: setting, why: '' };
    const byName = Object.entries(orgs).find(([slug, name]) => plainName(name) === plainName(setting) || plainName(slug) === plainName(setting))?.[0];
    if (byName) return { slug: byName, why: '' };
    // one organization is the only place to go, whatever the setting says
    if (slugs.length === 1) return { slug: slugs[0]!, why: '' };
    return { slug: null, why: `the Fly.io organization in Settings, “${setting}”, is neither the slug nor the name of one the account has (${slugs.join(', ') || 'none listed'})` };
  }
  if (slugs.length === 1) return { slug: slugs[0]!, why: '' };
  if (slugs.includes('personal')) return { slug: 'personal', why: '' };
  return { slug: null, why: `the account has several organizations (${slugs.join(', ') || 'none listed'})` };
}

/** the token the Netlify CLI stored in the sign-in's home: `users.<id>.auth.token` in its config.json, wherever it put it */
export function netlifyTokenIn(home: string): string | null {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(dir, n);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (n === 'config.json') found.push(p);
    }
  };
  walk(home, 0);
  for (const p of found) {
    try {
      const j = JSON.parse(readFileSync(p, 'utf8')) as { userId?: string; users?: Record<string, { auth?: { token?: string } }> };
      const users = j.users ?? {};
      const u = (j.userId && users[j.userId]) || Object.values(users)[0];
      if (u?.auth?.token) return u.auth.token;
    } catch {}
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// flyctl, installed on a click

export interface ToolState {
  tool: 'fly';
  /** found on this computer: its path and version; null when not */
  installed: { path: string; version: string } | null;
  status: 'idle' | 'installing' | 'done' | 'failed';
  detail: string;
  output: string;
}
const installs = new Map<string, ToolState>();
/** whether flyctl is here, and how an install went */
export async function flyctlState(engine: Engine): Promise<ToolState> {
  const cur = installs.get(engine.config.dataDir) ?? { tool: 'fly' as const, installed: null, status: 'idle' as const, detail: '', output: '' };
  const bin = engine.deployCli('fly');
  let installed: ToolState['installed'] = null;
  if (bin[0] !== 'fly' || Bun.which('fly')) {
    try {
      const p = Bun.spawn([...bin, 'version'], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', env: { ...process.env, FLY_NO_UPDATE_CHECK: '1' } });
      const out = await new Response(p.stdout).text();
      const code = await p.exited;
      // "fly v0.5.10 darwin/arm64 Commit: … BuildDate: …": the version and the platform are enough
      if (code === 0) installed = { path: bin.join(' '), version: (plain(out).trim().split('\n')[0] ?? 'found').split(' Commit:')[0]! };
    } catch {}
  }
  const next = { ...cur, installed };
  installs.set(engine.config.dataDir, next);
  return next;
}
/** Fly.io's own installer, into `~/.fly` (what a person runs by hand); the command is the engine's, so tests stand in */
export function installFlyctl(engine: Engine): ToolState {
  const cur = installs.get(engine.config.dataDir);
  if (cur?.status === 'installing') return cur;
  const state: ToolState = { tool: 'fly', installed: cur?.installed ?? null, status: 'installing', detail: 'running Fly.io’s installer (curl -L https://fly.io/install.sh | sh)…', output: '' };
  installs.set(engine.config.dataDir, state);
  void (async () => {
    const proc = Bun.spawn(engine.installFlyCommand, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', env: { ...process.env, FLYCTL_INSTALL: join(homedir(), '.fly') } });
    const t = setTimeout(() => killGroup(proc as { pid: number; kill: (sig?: number | NodeJS.Signals) => void }), 10 * 60_000);
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    clearTimeout(t);
    const output = plain(`${out}\n${err}`).trim().split('\n').slice(-20).join('\n');
    const after = await flyctlState(engine);
    installs.set(engine.config.dataDir, { ...after, status: code === 0 && after.installed ? 'done' : 'failed', detail: code === 0 && after.installed ? `installed ${after.installed.version} at ${after.installed.path}` : `the installer ended (exit ${code}) without a working flyctl: ${lastLine(output)}`, output });
  })().catch((err) => installs.set(engine.config.dataDir, { ...state, status: 'failed', detail: String((err as Error).message ?? err), output: '' }));
  return state;
}
