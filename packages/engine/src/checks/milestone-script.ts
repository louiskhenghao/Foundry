import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { CheckSpec, Goal, Task } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { installSteps, portFree } from '../preview/manager.ts';
import { type GroupResult, runInGroup } from '../proc.ts';
import { excludeFromGit } from '../skills/autoskills.ts';
import { git } from '../git/git.ts';
import { goalWorkspacePath, milestoneWorkspacePath, screenshotsDir } from '../workspace.ts';

/** a scripted milestone's check is named after its script, so a person sees which check shows which feature */
export const MILESTONE_CHECK_PREFIX = 'milestone script: ';
const SCRIPT_TIMEOUT_MS = 10 * 60_000;
/** the configs Foundry writes next to the project's for one run, kept out of git */
const WRAPPERS = 'playwright.foundry-*.config.ts';
const CONFIGS = ['playwright.config.ts', 'playwright.config.mts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs'];

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** the command that runs one milestone script with the project's own Playwright (never a download: `--no-install`) */
export function milestoneCommand(script: string, config?: string): string {
  return `npx --no-install playwright test ${quote(script)}${config ? ` --config ${quote(config)}` : ''}`;
}

/** the must check a scripted milestone's task carries: the script passes, on free ports, before the task can land */
export function milestoneCheckSpec(script: string): Extract<CheckSpec, { type: 'command' }> {
  return { type: 'command', cmd: milestoneCommand(script), timeoutMs: SCRIPT_TIMEOUT_MS, expectExitCode: 0, ports: true, milestone: script };
}

/**
 * Write a config next to the project's that is the project's own on Chromium only (a phone project is Chromium too),
 * so the task's check and the recording run the script the same way, whatever other browsers the project tests on.
 * `record` adds a video of every test and a JSON report for Foundry. `against` runs the script against that address
 * instead of the project's own server: its `webServer` is left out and `baseURL` is the address, on every project too
 * (ADR-0058). Null when the repository has no playwright.config.
 */
export async function writeWrapper(cwd: string, record?: { outputDir: string; report: string }, against?: string): Promise<{ name: string; remove: () => void } | null> {
  const base = CONFIGS.find((c) => existsSync(join(cwd, c)));
  if (!base) return null;
  const name = `playwright.foundry-${Math.random().toString(36).slice(2, 10)}.config.ts`;
  const from = extname(base) === '.ts' ? `./${base.replace(/\.ts$/, '')}` : `./${base}`;
  const use = [record ? `video: 'on', screenshot: 'on', trace: 'off'` : '', against ? `baseURL: ${JSON.stringify(against)}` : ''].filter(Boolean).join(', ');
  const recording = `${
    record
      ? `
  outputDir: ${JSON.stringify(record.outputDir)},
  reporter: [['json', { outputFile: ${JSON.stringify(record.report)} }]],`
      : ''
  }${
    use
      ? `
  use: { ...(b.use ?? {}), ${use} },`
      : ''
  }${
    against
      ? `
  // the deployed address instead of the project's own server (ADR-0058)
  webServer: undefined,`
      : ''
  }`;
  const placed = against ? `// every project goes to the address too: a project's own baseURL would win over the top one
const placed = kept.map((p) => ({ ...p, use: { ...(p.use ?? {}), baseURL: ${JSON.stringify(against)} } }));` : 'const placed = kept;';
  writeFileSync(
    join(cwd, name),
    `// written by Foundry for one milestone run, removed afterwards
import base from ${JSON.stringify(from)};
const b: any = (base as any)?.default ?? base;
const all: any[] = b.projects ?? [];
const isChromium = (p: any) => (p.use?.browserName ?? p.use?.defaultBrowserType ?? 'chromium') === 'chromium';
const onChromium = (p: any) => (isChromium(p) ? p : { ...p, use: { ...p.use, browserName: 'chromium', defaultBrowserType: 'chromium' } });
// Chromium projects, and phone projects of any browser run on Chromium (an iPhone keeps its size and touch)
const kept = all.filter((p) => isChromium(p) || p.use?.isMobile).map(onChromium);
// plus the setup and teardown projects they depend on, or Playwright rejects the config
for (let i = 0; i < kept.length; i++) {
  for (const dep of [...(kept[i].dependencies ?? []), ...(kept[i].teardown ? [kept[i].teardown] : [])]) {
    const p = all.find((x) => x.name === dep);
    if (p && !kept.some((x) => x.name === dep)) kept.push(onChromium(p));
  }
}
${placed}
export default {
  ...b,
  retries: 0,${recording}
  ...(placed.length ? { projects: placed } : {}),
};
`,
  );
  await excludeFromGit(cwd, [WRAPPERS]).catch(() => false);
  return { name, remove: () => rmSync(join(cwd, name), { force: true }) };
}

/** what Playwright says when the browser it needs was never downloaded on this computer */
export const NO_BROWSER = /Executable doesn't exist|npx playwright install/;

/**
 * Two free ports for a script's servers: PORT for the web app, API_PORT for a backend. Taken from a high range, so a
 * task's check never lands on the preview's or another worktree's dev server.
 */
export async function scriptPorts(): Promise<{ PORT: string; API_PORT: string }> {
  const picked: number[] = [];
  for (let i = 0; i < 200 && picked.length < 2; i++) {
    const p = 20_000 + Math.floor(Math.random() * 25_000);
    if (!picked.includes(p) && (await portFree(p))) picked.push(p);
  }
  if (picked.length < 2) throw new Error('no free ports for the milestone script');
  return { PORT: String(picked[0]), API_PORT: String(picked[1]) };
}

export interface ScriptRun {
  status: 'pass' | 'fail';
  error: string | null;
  summary: string;
  clips: { file: string; caption: string }[];
  shots: { file: string; caption: string }[];
  outputs: { file: string; caption: string }[];
  /** the runner's output, a file under the goal's screenshots folder */
  log: string | null;
}

export interface ScriptDeps {
  run: (argv: string[], opts: { cwd: string; env: Record<string, string | undefined>; timeoutMs: number }) => Promise<GroupResult>;
}

const defaultDeps: ScriptDeps = { run: (argv, opts) => runInGroup(argv, { ...opts, killLeftovers: true }) };

/** Playwright's JSON report, the parts Foundry reads */
interface Attachment {
  name: string;
  contentType: string;
  path?: string;
  body?: string;
}
interface ReportSuite {
  title: string;
  specs?: { title: string; tests: { projectName?: string; results: { status: string; error?: { message?: string }; attachments?: Attachment[] }[] }[] }[];
  suites?: ReportSuite[];
}

const ANSI = /\u001b\[[0-9;]*m/g;

export interface ScriptRunOptions {
  /** run the script in this folder instead of the goal's recording folder: a deploy's checkout of the deployed commit */
  cwd?: string;
  /** run it against this address instead of the project's own server (ADR-0058): no `webServer`, `baseURL` is the address, no ports */
  against?: string;
}

/**
 * Run a milestone's Playwright script in the goal's folder, the way its task's check ran it, with a video of every test
 * and its attachments collected: captioned screenshots, an API's responses. The project's own config starts the app
 * (its `webServer`); Foundry adds the recording and the report in a config of its own next to it, removed afterwards.
 * A smoke runs it in a deploy's checkout against the deployed address instead (`opts`).
 * Never throws: a script that cannot run is a failed run with the reason.
 */
export async function runMilestoneScript(engine: Engine, goal: Goal, task: Task, prefix: string, deps: ScriptDeps = defaultDeps, opts: ScriptRunOptions = {}): Promise<ScriptRun> {
  const { config } = engine;
  const out: ScriptRun = { status: 'fail', error: null, summary: '', clips: [], shots: [], outputs: [], log: null };
  const script = task.milestoneScript;
  const dir = screenshotsDir(config.dataDir, goal);
  const hide = engine.preview.redactorFor(goal);
  if (!script) return { ...out, error: 'the milestone has no script' };
  const cwd = opts.cwd ?? (await recordingFolder(engine, goal));
  if (!existsSync(join(cwd, script))) return { ...out, error: `${script} is not ${opts.cwd ? 'in the deployed commit' : 'on the goal branch'}` };
  const work = mkdtempSync(join(tmpdir(), 'foundry-milestone-'));
  const report = join(work, 'report.json');
  // the project's config as it is, on Chromium, plus a video and the report (and the address, for a smoke)
  const wrapper = await writeWrapper(cwd, { outputDir: join(work, 'results'), report }, opts.against);
  if (!wrapper) {
    rmSync(work, { recursive: true, force: true });
    return { ...out, error: 'there is no playwright.config at the root of the repository' };
  }
  mkdirSync(dir, { recursive: true });
  let logText = '';
  try {
    // against an address nothing of the project's listens here: no ports for it, none from the shell either
    const env = { ...process.env, ...(opts.against ? { PORT: undefined, API_PORT: undefined } : await scriptPorts()), CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
    if (opts.against) logText += `# against ${opts.against}\n`;
    // the goal's folder may never have installed its dependencies (tasks ran in worktrees): the way the preview does
    for (const step of installSteps(cwd, [])) {
      const i = await deps.run(['sh', '-lc', step.command], { cwd: join(cwd, step.dir), env, timeoutMs: SCRIPT_TIMEOUT_MS });
      logText += `$ ${step.command}\n[exit ${i.code}]\n${i.stdout.slice(-3000)}\n${i.stderr.slice(-3000)}\n`;
    }
    const run = () => deps.run(['sh', '-lc', milestoneCommand(script, wrapper.name)], { cwd, env, timeoutMs: SCRIPT_TIMEOUT_MS });
    let r = await run();
    logText += `$ ${milestoneCommand(script)}\n[exit ${r.code}${r.timedOut ? ', killed: timeout' : ''}]\n${r.stdout}\n${r.stderr}`;
    // the project's Playwright has no browser on this computer yet: download it once and run again
    if (r.code !== 0 && NO_BROWSER.test(r.stdout + r.stderr)) {
      const install = await deps.run(['sh', '-lc', 'npx --no-install playwright install chromium'], { cwd, env, timeoutMs: SCRIPT_TIMEOUT_MS });
      logText += `\n$ npx playwright install chromium\n[exit ${install.code}]\n${install.stdout.slice(-2000)}\n${install.stderr.slice(-2000)}`;
      r = await run();
      logText += `\n$ ${milestoneCommand(script)}\n[exit ${r.code}${r.timedOut ? ', killed: timeout' : ''}]\n${r.stdout}\n${r.stderr}`;
    }
    if (!existsSync(report)) {
      const tail = (r.stderr || r.stdout).replace(ANSI, '').trim().split('\n').slice(-6).join('\n');
      out.error = r.timedOut ? 'the script ran past 10 minutes' : r.code === 127 ? `a command was not found: ${tail}` : `the script did not run: ${tail || `exit ${r.code}`}`;
      return out;
    }
    collect(JSON.parse(readFileSync(report, 'utf8')) as { suites?: ReportSuite[] }, out, dir, prefix);
    if (r.code !== 0 && !out.error) out.error = `the runner exited with ${r.code}`;
    out.status = out.error ? 'fail' : 'pass';
  } catch (err) {
    out.error = String((err as Error).message ?? err);
  } finally {
    wrapper.remove();
    if (logText) {
      out.log = `${prefix}log.txt`;
      writeFileSync(join(dir, out.log), hide(logText.replace(ANSI, '')).slice(-400_000));
    }
    rmSync(work, { recursive: true, force: true });
    out.error = out.error ? hide(out.error).slice(0, 600) : null;
  }
  return out;
}

/**
 * Where a recording runs: a worktree of its own at the goal branch's tip, so a task working in the goal's folder, or a
 * merge into it, never changes the files under a running script. It is kept between recordings (only what git tracks
 * is reset), so its dependencies stay installed; the env files the goal's folder has beside git are copied in. Falls
 * back to the goal's folder when the branch is gone (a delivered goal).
 */
async function recordingFolder(engine: Engine, goal: Goal): Promise<string> {
  const ws = goalWorkspacePath(engine.config.dataDir, goal);
  const path = milestoneWorkspacePath(engine.config.dataDir, goal);
  try {
    const tip = (await git(['rev-parse', '--verify', '--quiet', `${goal.branch}^{commit}`], goal.repoPath)).stdout.trim();
    if (!tip) return ws;
    if (!existsSync(join(path, '.git'))) {
      mkdirSync(join(path, '..'), { recursive: true });
      rmSync(path, { recursive: true, force: true });
      await git(['worktree', 'prune'], goal.repoPath);
      if ((await git(['worktree', 'add', '--detach', path, tip], goal.repoPath)).code !== 0) return ws;
    } else if ((await git(['checkout', '-q', '--force', '--detach', tip], path)).code !== 0) return ws;
    // untracked files from the last run go; ignored ones (node_modules, build caches) stay
    await git(['clean', '-fdq'], path);
    if (existsSync(ws)) for (const f of readdirSync(ws)) if (/^\.env/.test(f) && statSync(join(ws, f)).isFile()) copyFileSync(join(ws, f), join(path, f));
    return path;
  } catch {
    return ws;
  }
}

/** a test's video, its captioned screenshots and the text it attached, copied under the goal's screenshots folder */
function collect(report: { suites?: ReportSuite[] }, out: ScriptRun, dir: string, prefix: string): void {
  let n = 0;
  const name = (ext: string) => `${prefix}${String(++n).padStart(2, '0')}${ext}`;
  const save = (a: Attachment, ext: string): string | null => {
    const file = name(ext);
    try {
      if (a.path && existsSync(a.path)) copyFileSync(a.path, join(dir, file));
      else if (a.body != null) writeFileSync(join(dir, file), Buffer.from(a.body, 'base64'));
      else return null;
      return file;
    } catch {
      return null;
    }
  };
  const titles: string[] = [];
  const walk = (suite: ReportSuite, path: string[]) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const result = test.results.at(-1);
        if (!result) continue;
        const title = [...path, spec.title].filter(Boolean).join(' › ') + (test.projectName ? ` (${test.projectName})` : '');
        titles.push(title);
        if (result.status !== 'passed' && result.status !== 'skipped' && !out.error) {
          out.error = `"${title}" ${result.status === 'timedOut' ? 'timed out' : 'failed'}: ${(result.error?.message ?? '').replace(ANSI, '').trim().split('\n').slice(0, 6).join('\n')}`;
        }
        const atts = result.attachments ?? [];
        const own = atts.filter((a) => a.contentType.startsWith('image/') && a.name !== 'screenshot');
        for (const a of atts) {
          if (a.contentType.startsWith('video/')) {
            const f = save(a, '.webm');
            if (f) out.clips.push({ file: f, caption: title });
          } else if (a.contentType.startsWith('image/')) {
            // Playwright's own screenshot at the end only when the script attached none
            if (a.name === 'screenshot' && own.length) continue;
            const f = save(a, '.png');
            if (f) out.shots.push({ file: f, caption: a.name === 'screenshot' ? `${title}: the end` : a.name });
          } else if (/json|text/.test(a.contentType) && a.name !== 'trace') {
            const f = save(a, a.contentType.includes('json') ? '.json' : '.txt');
            if (f) out.outputs.push({ file: f, caption: a.name });
          }
        }
      }
    }
    for (const s of suite.suites ?? []) walk(s, [...path, s.title]);
  };
  // the top suites are the files: their titles are the script's path, not worth repeating
  for (const s of report.suites ?? []) walk({ ...s, title: '' }, []);
  if (!titles.length && !out.error) out.error = 'the script has no tests';
  out.summary = titles.length ? `${titles.length} test${titles.length > 1 ? 's' : ''}: ${titles.join('; ')}` : '';
}
