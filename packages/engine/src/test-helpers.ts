/** Shared test doubles (not exported from the package index). */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';

/** Scripted stand-in for claude: runs `behave(spec, nthCallForCwd)` then returns a success result. */
export class FakeRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  rateLimit: RunResult['rateLimit'] = null;
  /** skills every fake session reports as invoked */
  skillsUsed: string[] = [];
  constructor(private behave: (spec: RunSpec, n: number) => void | Promise<void>) {}
  maxConcurrent = 3;
  active() {
    return 0;
  }
  setMaxConcurrent(n: number) {
    this.maxConcurrent = n;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const n = this.calls.filter((c) => c.cwd === spec.cwd && c.label?.startsWith('attempt')).length;
    await this.behave(spec, n);
    const result: RunResult = {
      sessionId: `fake-${this.calls.length}`,
      subtype: 'success',
      isError: false,
      costUsd: 0.01,
      numTurns: 1,
      durationMs: 1,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      modelUsage: null,
      permissionDenials: [],
      finalText: 'done',
      structuredOutput: null,
      exitCode: 0,
      pid: null,
      rateLimit: this.rateLimit,
      errorMessage: null,
      skillsUsed: [...this.skillsUsed],
      toolsUsed: this.skillsUsed.length ? { Skill: this.skillsUsed.length } : {},
    };
    const events: RunnerEvent[] = [
      { kind: 'hook', name: 'SessionStart:startup', outcome: 'success' },
      { kind: 'init', sessionId: result.sessionId!, model: 'fake', tools: [], raw: {} },
      { kind: 'text', text: 'plan: do it' },
      { kind: 'result', result },
    ];
    return {
      pid: null,
      events: (async function* () {
        for (const e of events) yield e;
      })(),
      kill() {},
      result: Promise.resolve(result),
    };
  }
}

export async function sh(cmd: string, cwd: string): Promise<string> {
  const r = await Bun.$`sh -c ${cmd}`.cwd(cwd).quiet().nothrow();
  if (r.exitCode !== 0) throw new Error(`${cmd} failed in ${cwd}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

/** temp repo with one commit on main */
export async function makeRepo(prefix = 'foundry-test-repo-'): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, 'README.md'), 'fixture\n');
  await sh('git init -q -b main && git -c user.name=t -c user.email=t@t add -A && git -c user.name=t -c user.email=t@t commit -q -m init', dir);
  return dir;
}

/** temp repo + bare remote `origin` with main pushed */
export async function makeRepoWithRemote(): Promise<{ repo: string; bare: string }> {
  const repo = await makeRepo();
  const bare = mkdtempSync(join(tmpdir(), 'foundry-test-bare-')) + '.git';
  await sh(`git init -q --bare ${bare} && git remote add origin ${bare} && git push -q -u origin main`, repo);
  return { repo, bare };
}

export async function waitFor(pred: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await Bun.sleep(25);
  }
}

export const terminal = (s: string) => ['done', 'over_delivered', 'failed', 'cancelled'].includes(s);
