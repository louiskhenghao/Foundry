import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Brief } from '@foundry/core';
import { getBrief, getGoal, listAttempts, listEscalations, listTasks, needsOf } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { stageFile } from './attachments.ts';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { makeRepo, waitFor } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let repo: string;
const engines: Engine[] = [];
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-materials-'));
  repo = await makeRepo();
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const p of [dataDir, repo, `${repo}-foundry`]) rmSync(p, { recursive: true, force: true });
});
const track = (e: Engine) => (engines.push(e), e);
const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, useGraphify: false, log: () => {} });

/** what a scripted worker session does: files it writes in its workspace, and what it says at the end */
type Turn = { write?: Record<string, string>; finalText?: string; hold?: Promise<void> };
/** a worker that follows a script per call; a resumed session keeps its id, as the coding agents' do */
class Worker implements ClaudeRunner {
  calls: RunSpec[] = [];
  constructor(private script: (spec: RunSpec, n: number) => Turn | void) {}
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const turn = this.script(spec, this.calls.length) ?? {};
    if (turn.hold) await turn.hold;
    for (const [f, c] of Object.entries(turn.write ?? {})) writeFileSync(join(spec.cwd, f), c);
    const sessionId = spec.resumeSessionId ?? `s${this.calls.length}`;
    const result: RunResult = { sessionId, subtype: 'success', isError: false, costUsd: 0.01, numTurns: 1, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: turn.finalText ?? 'done', structuredOutput: null, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'init', sessionId, model: 'fake', tools: [], raw: {} }, { kind: 'text', text: result.finalText! }, { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}

const task = (key: string, title: string, extra: Partial<Brief['tasks'][number]> = {}): Brief['tasks'][number] => ({ key, title, spec: `do ${title}`, kind: 'feature', scope: null, scenario: 'general', areaKey: null, tdd: 'inherit', dependsOnKeys: [], parallelizable: false, relevantFiles: [], milestone: null, ...extra });
const check = (key: string, taskKey: string, file: string): Brief['checks'][number] => ({ key, name: file, tier: 'must', taskKey, areaKey: null, spec: { type: 'command', cmd: `test -f ${file}`, timeoutMs: 60_000, expectExitCode: 0 } });
type Material = NonNullable<Brief['provides']>[number];
const brief = (tasks: Brief['tasks'], checks: Brief['checks'], provides: Material[] = []): Omit<Brief, 'goalId'> => ({ title: '', understanding: 'u', styleOptions: [], areas: [], assumptions: [], questions: [], costEstimateUsd: 0, timeEstimateMin: 0, tasks, checks, provides });
const NEEDS = '```foundry-needs\n{ "what": "the 3D car models (GLB), one per car", "why": "the showroom loads them", "suggestions": "export glTF 2.0 from Blender; free ones at sketchfab.com", "canProceedWithout": true }\n```';
const bytes = new Uint8Array([103, 108, 84, 70, 1, 2]);

describe('a goal asks for what only the person can give (ADR-0074)', () => {
  test("a worker's request block pauses the task without spending a retry; the answer's files become attachments marked with the Request, and the same session goes on with them", async () => {
    const runner = new Worker((spec): Turn => (spec.resumeSessionId ? { write: { 'done.txt': 'ok' } } : { finalText: `I built the page and the loader.\n\n${NEEDS}` }));
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'a car showroom', repoPath: repo, brief: brief([task('T1', 'build the showroom')], [check('C1', 'T1', 'done.txt')]) });
    await waitFor(() => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).some((e) => e.trigger === 'needs_input'), 30_000);
    const esc = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).find((e) => e.trigger === 'needs_input')!;
    const need = needsOf(esc)!;
    expect([need.source, need.what, need.canProceedWithout]).toEqual(['worker', 'the 3D car models (GLB), one per car', true]);
    expect(need.suggestions).toContain('sketchfab');
    const [t1] = listTasks(engine.store.db, goal.id);
    expect(t1!.state).toBe('blocked');
    // the attempt waits as interrupted, its session kept; no retry was spent and nothing was judged
    const [a] = listAttempts(engine.store.db, t1!.id);
    expect([a!.state, a!.resultSubtype, a!.continuations]).toEqual(['interrupted', 'needs_input', 0]);
    expect(engine.attemptCount(t1!.id)).toBe(1);
    expect(runner.calls.filter((c) => c.label?.startsWith('attempt'))).toHaveLength(1);
    // nothing else can run: the goal reads as waiting for the person
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'blocked');

    const staged = engine.stage(stageFile(dataDir, { name: 'car.glb', mime: 'model/gltf-binary', bytes }), { convert: false });
    await engine.answerEscalation(esc.id, { action: 'provide', hint: 'Here is the first car; the others follow.', attachments: [staged] }, 'ann');
    const given = getGoal(engine.store.db, goal.id)!.attachments.find((x) => x.name === 'car.glb')!;
    expect(given.requestId).toBe(esc.id);
    await waitFor(() => listTasks(engine.store.db, goal.id)[0]!.state === 'done', 30_000);
    // the same session, told what came and where
    const resumed = runner.calls.filter((c) => c.label?.startsWith('attempt'))[1]!;
    expect(resumed.resumeSessionId).toBe('s1');
    expect(resumed.prompt).toContain('The person answered your request.');
    expect(resumed.prompt).toContain('Here is the first car; the others follow.');
    expect(resumed.prompt).toContain(`/attachments/${goal.id}/${given.id}/car.glb`);
    expect(listAttempts(engine.store.db, listTasks(engine.store.db, goal.id)[0]!.id)).toHaveLength(1);
    expect(getEscalationState(engine, esc.id)).toBe('answered');
    await waitFor(() => ['done', 'over_delivered'].includes(getGoal(engine.store.db, goal.id)!.state), 30_000);
  }, 90_000);

  test('a material promised in wait mode: Foundry asks for it when the task is ready, without a worker session; giving it on the goal page answers the Request and the task starts, told where the files are', async () => {
    const runner = new Worker(() => ({ write: { 'done.txt': 'ok' } }));
    const engine = track(new Engine(cfg(), runner));
    const material: Material = { key: 'M1', what: 'the logo files (SVG)', neededBy: ['T1'], mode: 'wait', status: 'waiting', receivedAt: null, attachmentIds: [], note: null };
    const goal = await engine.createGoal({ prompt: 'a brand page', repoPath: repo, brief: brief([task('T1', 'build the header', { needs: ['M1'] })], [check('C1', 'T1', 'done.txt')], [material]) });
    await waitFor(() => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).some((e) => e.trigger === 'needs_input'), 30_000);
    const esc = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).find((e) => e.trigger === 'needs_input')!;
    expect(needsOf(esc)).toMatchObject({ source: 'foundry', materialKey: 'M1', what: 'the logo files (SVG)' });
    expect(esc.message).toContain('you said you would provide it');
    expect(runner.calls.filter((c) => c.label?.startsWith('attempt'))).toHaveLength(0);
    expect(listTasks(engine.store.db, goal.id)[0]!.state).toBe('blocked');

    const staged = engine.stage(stageFile(dataDir, { name: 'logo.svg', mime: 'image/svg+xml', bytes }), { convert: false });
    engine.receiveMaterial(goal.id, 'M1', { attachments: [staged], note: 'the final logos', by: 'ann' });
    const m = getBrief(engine.store.db, goal.id)!.brief.provides![0]!;
    expect([m.status, m.note, m.attachmentIds.length]).toEqual(['received', 'the final logos', 1]);
    expect(getGoal(engine.store.db, goal.id)!.attachments[0]!.materialKey).toBe('M1');
    expect(getEscalationState(engine, esc.id)).toBe('answered');
    await waitFor(() => listTasks(engine.store.db, goal.id)[0]!.state === 'done', 30_000);
    const spec = runner.calls.find((c) => c.label?.startsWith('attempt'))!;
    expect(spec.resumeSessionId).toBeUndefined();
    expect(spec.prompt).toContain('# You will provide');
    expect(spec.prompt).toContain('the logo files (SVG) — arrived (the final logos)');
    expect(spec.prompt).toContain('/logo.svg');
  }, 90_000);

  test('placeholder mode: the task builds with a stand-in at once, and a swap-in task follows when the material arrives; an attachment added unasked is announced to the tasks not yet started', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const runner = new Worker((spec): Turn => (spec.prompt.includes('# Your task (second)') ? { hold: held, write: { 'two.txt': 'ok' } } : { write: { 'done.txt': 'ok' } }));
    const engine = track(new Engine(cfg(), runner));
    const material: Material = { key: 'M1', what: 'the real 3D models', neededBy: ['T1'], mode: 'placeholder', status: 'waiting', receivedAt: null, attachmentIds: [], note: null };
    const goal = await engine.createGoal({ prompt: 'a showroom', repoPath: repo, brief: brief([task('T1', 'build the showroom', { needs: ['M1'] }), task('T2', 'second', { dependsOnKeys: ['T1'] })], [check('C1', 'T1', 'done.txt'), check('C2', 'T2', 'two.txt')], [material]) });
    await waitFor(() => listTasks(engine.store.db, goal.id).find((t) => t.title === 'build the showroom')!.state === 'done', 30_000);
    const first = runner.calls.find((c) => c.label?.startsWith('attempt'))!;
    expect(first.prompt).toContain('the real 3D models — not here yet: build with a placeholder');
    expect(listEscalations(engine.store.db, { goalId: goal.id })).toHaveLength(0);
    // the second task is running (held); the material arrives now: a swap-in task after everything done so far
    await waitFor(() => listTasks(engine.store.db, goal.id).find((t) => t.title === 'second')!.state === 'running', 30_000);
    const staged = engine.stage(stageFile(dataDir, { name: 'car.glb', mime: 'model/gltf-binary', bytes }), { convert: false });
    engine.receiveMaterial(goal.id, 'M1', { attachments: [staged], note: null, by: null });
    const swap = listTasks(engine.store.db, goal.id).find((t) => t.origin === 'material-swap')!;
    expect(swap.title).toBe('Swap in the real 3D models');
    expect(swap.kind).toBe('chore');
    expect(swap.spec).toContain('car.glb');
    expect(swap.dependsOn).toEqual([listTasks(engine.store.db, goal.id).find((t) => t.title === 'build the showroom')!.id]);
    // an attachment added unasked while the goal runs: the tasks not yet started hear of it
    const extra = engine.stage(stageFile(dataDir, { name: 'notes.md', mime: 'text/markdown', bytes }), { convert: false });
    engine.addAttachment(goal.id, extra);
    expect(listTasks(engine.store.db, goal.id).find((t) => t.origin === 'material-swap')!.hint).toContain('The person added an attachment: notes.md');
    expect(listTasks(engine.store.db, goal.id).find((t) => t.title === 'second')!.hint).toBeNull();
    release();
    await waitFor(() => ['done', 'over_delivered'].includes(getGoal(engine.store.db, goal.id)!.state), 60_000);
  }, 120_000);
});

const getEscalationState = (engine: Engine, id: string) => listEscalations(engine.store.db).find((e) => e.id === id)?.state;

test('a request block written in a continuation (the checks failed, the session went on) raises the Request too, instead of another retry', async () => {
  // the first segment finishes without the file (its check fails); the checks-failed continuation stops to ask; the answer's session finishes
  const runner = new Worker((spec): Turn => (/proceed without it/i.test(spec.prompt) || spec.prompt.includes('answered your request') ? { write: { 'done.txt': 'ok' } } : spec.resumeSessionId ? { finalText: `I cannot finish without it.\n\n${NEEDS}` } : { write: { 'shell.txt': 'the shell' }, finalText: 'Built the shell; the file is still missing.' }));
  const engine = track(new Engine(cfg(), runner));
  const goal = await engine.createGoal({ prompt: 'a car showroom', repoPath: repo, brief: brief([task('T1', 'build the showroom')], [check('C1', 'T1', 'done.txt')]) });
  await waitFor(() => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).some((e) => e.trigger === 'needs_input'), 30_000);
  const [t1] = listTasks(engine.store.db, goal.id);
  expect(t1!.state).toBe('blocked');
  const [a] = listAttempts(engine.store.db, t1!.id);
  expect([a!.state, a!.resultSubtype]).toEqual(['interrupted', 'needs_input']);
  // one attempt, two sessions of it so far: the first segment and the continuation that asked
  expect(listAttempts(engine.store.db, t1!.id)).toHaveLength(1);
  expect(runner.calls.filter((c) => c.label?.startsWith('attempt'))).toHaveLength(2);
  const esc = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })[0]!;
  await engine.answerEscalation(esc.id, { action: 'proceed_without', hint: 'there is none; use a placeholder' }, 'ann');
  await waitFor(() => ['done', 'over_delivered'].includes(getGoal(engine.store.db, goal.id)!.state), 60_000);
  const last = runner.calls.filter((c) => c.label?.startsWith('attempt')).at(-1)!;
  expect(last.resumeSessionId).toBe('s1');
  expect(last.prompt).toMatch(/proceed without it/i);
  expect(last.prompt).toContain('there is none; use a placeholder');
}, 120_000);

test('a Request answered with a file that is gone stays open, so it can be answered again', async () => {
  const runner = new Worker((spec): Turn => (spec.resumeSessionId ? { write: { 'done.txt': 'ok' } } : { finalText: `Built.\n\n${NEEDS}` }));
  const engine = track(new Engine(cfg(), runner));
  const goal = await engine.createGoal({ prompt: 'a car showroom', repoPath: repo, brief: brief([task('T1', 'build the showroom')], [check('C1', 'T1', 'done.txt')]) });
  await waitFor(() => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).some((e) => e.trigger === 'needs_input'), 30_000);
  const esc = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).find((e) => e.trigger === 'needs_input')!;
  const staged = engine.stage(stageFile(dataDir, { name: 'car.glb', mime: 'model/gltf-binary', bytes }), { convert: false });
  rmSync(resolve(dataDir, staged.path!), { force: true });
  await expect(engine.answerEscalation(esc.id, { action: 'provide', attachments: [staged] }, 'ann')).rejects.toThrow(/no longer available/);
  // nothing was recorded: the Request is still open, the goal has no attachment
  expect(getEscalationState(engine, esc.id)).toBe('open');
  expect(getGoal(engine.store.db, goal.id)!.attachments).toHaveLength(0);
  await engine.answerEscalation(esc.id, { action: 'proceed_without', hint: 'none after all' }, 'ann');
  expect(getEscalationState(engine, esc.id)).toBe('answered');
}, 60_000);
