import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Check, CheckResult } from '@foundry/core';
import { IdPrefix, newId } from '@foundry/core';
import { truncateOutput } from '../distill/truncate.ts';
import { playwrightEnv } from '../playwright-dir.ts';
import { runInGroup } from '../proc.ts';
import { NO_BROWSER, scriptPorts, writeWrapper } from './milestone-script.ts';

export interface CommandCheckContext {
  cwd: string;
  outputDir: string;
  attemptId: string | null;
  /** Optional model-backed distillation for very large outputs (falls back to truncation). */
  summarize?: (raw: string) => Promise<string>;
}

export async function runCommandCheck(check: Check, ctx: CommandCheckContext): Promise<CheckResult> {
  if (check.spec.type !== 'command') throw new Error('not a command check');
  const spec = check.spec;
  const started = Date.now();
  const id = newId(IdPrefix.checkResult);
  const cwd = spec.cwd ? join(ctx.cwd, spec.cwd) : ctx.cwd;
  let status: CheckResult['status'] = 'error';
  let raw = '';
  // a milestone script runs on Chromium through the project's config, the way Foundry records it
  const wrapper = spec.milestone ? await writeWrapper(cwd).catch(() => null) : null;
  try {
    // its own process group, killed whole: a test runner's dev server must not keep the check open after it ends
    const ports = spec.ports ? await scriptPorts() : {};
    // the engine's Playwright, as the sessions get it: a check that renders a film runs the worker's own script
    const env = { ...process.env, ...playwrightEnv(), ...ports, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
    const cmd = wrapper ? `${spec.cmd} --config '${wrapper.name}'` : spec.cmd;
    const run = () => runInGroup(['sh', '-lc', cmd], { cwd, env, timeoutMs: spec.timeoutMs, killLeftovers: true });
    let r = await run();
    raw = '';
    // the project's Playwright has no Chromium on this computer yet: download it once and run again
    if (spec.milestone && r.code !== 0 && NO_BROWSER.test(r.stdout + r.stderr)) {
      const i = await runInGroup(['sh', '-lc', 'npx --no-install playwright install chromium'], { cwd, env, timeoutMs: spec.timeoutMs });
      raw = `$ npx playwright install chromium\n[exit ${i.code}]\n${i.stdout.slice(-2000)}\n${i.stderr.slice(-2000)}\n`;
      r = await run();
    }
    const killed = r.timedOut;
    const code = r.code;
    raw += `$ ${spec.cmd}\n[exit ${code}${killed ? ', killed: timeout' : ''}]\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
    status = killed ? 'error' : code === spec.expectExitCode ? 'pass' : 'fail';
  } catch (err) {
    raw = `$ ${spec.cmd}\n[spawn error] ${String(err)}`;
    status = 'error';
  } finally {
    wrapper?.remove();
  }
  mkdirSync(ctx.outputDir, { recursive: true });
  const rawRef = join(ctx.outputDir, `${id}.txt`);
  writeFileSync(rawRef, raw.slice(0, 2_000_000));
  return {
    id,
    checkId: check.id,
    goalId: check.goalId,
    taskId: check.taskId,
    attemptId: ctx.attemptId,
    status,
    summary: status === 'pass' || !ctx.summarize ? truncateOutput(raw) : await ctx.summarize(raw),
    rawRef,
    durationMs: Date.now() - started,
    at: new Date().toISOString(),
  };
}
