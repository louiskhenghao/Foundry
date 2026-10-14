import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { CheckSpec, Goal, Task } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { portFree } from '../preview/manager.ts';
import { type GroupResult, runInGroup } from '../proc.ts';
import { excludeFromGit } from '../skills/autoskills.ts';
import { goalWorkspacePath, screenshotsDir } from '../workspace.ts';

/** a scripted milestone's check is named after its script, so a person sees which check shows which feature */
export const MILESTONE_CHECK_PREFIX = 'milestone script: ';
const SCRIPT_TIMEOUT_MS = 10 * 60_000;
/** the config Foundry writes next to the project's for one run: the project's own, recording a video and reporting to Foundry */
const WRAPPER = 'playwright.foundry-milestone.config.ts';
const CONFIGS = ['playwright.config.ts', 'playwright.config.mts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs'];

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** the command that runs one milestone script with the project's own Playwright (never a download: `--no-install`) */
export function milestoneCommand(script: string, config?: string): string {
  return `npx --no-install playwright test ${quote(script)}${config ? ` --config ${quote(config)}` : ''}`;
}

/** the must check a scripted milestone's task carries: the script passes, on free ports, before the task can land */
export function milestoneCheckSpec(script: string): Extract<CheckSpec, { type: 'command' }> {
  return { type: 'command', cmd: milestoneCommand(script), timeoutMs: SCRIPT_TIMEOUT_MS, expectExitCode: 0, ports: true };
}

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

/**
 * Run a milestone's Playwright script in the goal's folder, the way its task's check ran it, with a video of every test
 * and its attachments collected: captioned screenshots, an API's responses. The project's own config starts the app
 * (its `webServer`); Foundry adds the recording and the report in a config of its own next to it, removed afterwards.
 * Never throws: a script that cannot run is a failed run with the reason.
 */
export async function runMilestoneScript(engine: Engine, goal: Goal, task: Task, prefix: string, deps: ScriptDeps = defaultDeps): Promise<ScriptRun> {
  const { config } = engine;
  const out: ScriptRun = { status: 'fail', error: null, summary: '', clips: [], shots: [], outputs: [], log: null };
  const script = task.milestoneScript;
  const cwd = goalWorkspacePath(config.dataDir, goal);
  const dir = screenshotsDir(config.dataDir, goal);
  const hide = engine.preview.redactorFor(goal);
  if (!script) return { ...out, error: 'the milestone has no script' };
  if (!existsSync(join(cwd, script))) return { ...out, error: `${script} is not on the goal branch` };
  const base = CONFIGS.find((c) => existsSync(join(cwd, c)));
  if (!base) return { ...out, error: 'there is no playwright.config at the root of the repository' };
  mkdirSync(dir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'foundry-milestone-'));
  const report = join(work, 'report.json');
  // the project's config as it is, plus a video and the report; only Chromium projects (a phone project is Chromium too)
  const from = extname(base) === '.ts' ? `./${base.replace(/\.ts$/, '')}` : `./${base}`;
  writeFileSync(
    join(cwd, WRAPPER),
    `// written by Foundry for one milestone run, removed afterwards
import base from ${JSON.stringify(from)};
const b: any = (base as any)?.default ?? base;
const chromium = (b.projects ?? []).filter((p: any) => (p.use?.browserName ?? p.use?.defaultBrowserType ?? 'chromium') === 'chromium');
export default {
  ...b,
  retries: 0,
  outputDir: ${JSON.stringify(join(work, 'results'))},
  reporter: [['json', { outputFile: ${JSON.stringify(report)} }]],
  use: { ...(b.use ?? {}), video: 'on', screenshot: 'on', trace: 'off' },
  ...(chromium.length ? { projects: chromium } : {}),
};
`,
  );
  await excludeFromGit(cwd, [WRAPPER]).catch(() => false);
  let logText = '';
  try {
    const env = { ...process.env, ...(await scriptPorts()), CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
    const run = () => deps.run(['sh', '-lc', milestoneCommand(script, WRAPPER)], { cwd, env, timeoutMs: SCRIPT_TIMEOUT_MS });
    let r = await run();
    logText = `$ ${milestoneCommand(script)}\n[exit ${r.code}${r.timedOut ? ', killed: timeout' : ''}]\n${r.stdout}\n${r.stderr}`;
    // the project's Playwright has no browser on this computer yet: download it once and run again
    if (r.code !== 0 && /Executable doesn't exist|playwright install/i.test(r.stdout + r.stderr) && !existsSync(report)) {
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
    rmSync(join(cwd, WRAPPER), { force: true });
    if (logText) {
      out.log = `${prefix}log.txt`;
      writeFileSync(join(dir, out.log), hide(logText.replace(ANSI, '')).slice(-400_000));
    }
    rmSync(work, { recursive: true, force: true });
    out.error = out.error ? hide(out.error).slice(0, 600) : null;
  }
  return out;
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
