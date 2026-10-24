import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Attachment, Brief, BriefOutput, ProposalInput } from '@foundry/core';
import { getBrief, getGoal, listEscalations, listChecks, listTasks, newId } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { stageFile } from '../attachments.ts';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { makeRepo, waitFor } from '../test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
let repo: string;
const engines: Engine[] = [];
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-proposals-'));
  repo = await makeRepo();
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const p of [dataDir, repo, `${repo}-foundry`]) rmSync(p, { recursive: true, force: true });
});
const track = (e: Engine) => (engines.push(e), e);
const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, useGraphify: false, log: () => {}, betaConversation: true });

type Turn = { write?: Record<string, string>; finalText?: string; hold?: Promise<void>; out?: unknown };
const areas = [{ key: 'A1', name: 'Portal', slug: 'portal', description: 'what students see' }];
const full: BriefOutput = { title: 'feat(portal): build it', understanding: 'One portal.', nature: 'code', areas, assumptions: ['a'], tasks: [{ key: 'T1', title: 'add student home', spec: 'do it', kind: 'feature', scope: null, scenario: 'frontend', difficulty: 'standard', areaKey: 'A1', dependsOnKeys: [], parallelizable: true, relevantFiles: ['README.md'], milestone: null }], checks: [{ key: 'C1', name: 'C1', tier: 'must', taskKey: 'T1', areaKey: null, type: 'command', cmd: 'true', rubric: null }], costEstimateUsd: 4, timeEstimateMin: 30, openQuestions: [], styleOptions: [], run: null, apps: null };
/** workers follow a script; Clarify, the classifier and the planner answer with one Brief */
class Runner implements ClaudeRunner {
  calls: RunSpec[] = [];
  constructor(private script: (spec: RunSpec, n: number) => Turn | void) {}
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const label = spec.label ?? '';
    const turn = label.startsWith('attempt') ? (this.script(spec, this.calls.length) ?? {}) : { out: label.startsWith('classify nature') ? { nature: 'code' } : full };
    if (turn.hold) await turn.hold;
    for (const [f, c] of Object.entries(turn.write ?? {})) writeFileSync(join(spec.cwd, f), c);
    const sessionId = spec.resumeSessionId ?? `s${this.calls.length}`;
    const result: RunResult = { sessionId, subtype: 'success', isError: false, costUsd: 0.01, numTurns: 1, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: turn.finalText ?? (turn.out ? JSON.stringify(turn.out) : 'done'), structuredOutput: turn.out ?? null, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'init', sessionId, model: 'fake', tools: [], raw: {} }, { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}
const task = (key: string, title: string, extra: Partial<Brief['tasks'][number]> = {}): Brief['tasks'][number] => ({ key, title, spec: `do ${title}`, kind: 'feature', scope: null, scenario: 'general', areaKey: null, tdd: 'inherit', dependsOnKeys: [], parallelizable: false, relevantFiles: [], milestone: null, ...extra });
const check = (key: string, taskKey: string | null, file: string): Brief['checks'][number] => ({ key, name: file, tier: 'must', taskKey, areaKey: null, spec: { type: 'command', cmd: `test -f ${file}`, timeoutMs: 60_000, expectExitCode: 0 } });
const brief = (tasks: Brief['tasks'], checks: Brief['checks']): Omit<Brief, 'goalId'> => ({ title: '', understanding: 'u', styleOptions: [], areas: [], assumptions: [], questions: [], costEstimateUsd: 0, timeEstimateMin: 0, tasks, checks, provides: [] });

/** a Conversation whose answer proposed these, as the events the engine would have appended */
function proposed(engine: Engine, goalId: string, proposals: ProposalInput[], attachments: Attachment[] = []): { cid: string; ids: string[] } {
  const cid = newId('conversation');
  const asked = newId('message');
  const ids = proposals.map(() => newId('proposal'));
  engine.store.append({ type: 'conversation.started', goalId, payload: { conversationId: cid, by: null } });
  engine.store.append({ type: 'conversation.asked', goalId, payload: { conversationId: cid, messageId: asked, text: 'please do it', by: null, attachments } });
  engine.store.append({ type: 'conversation.answered', goalId, payload: { conversationId: cid, messageId: newId('message'), askedId: asked, text: 'Here is what I propose.', status: 'done', reason: null, costUsd: 0, costAvailable: false, model: null, sessionId: null, durationMs: 0, proposals: proposals.map((p, i) => ({ ...p, id: ids[i]!, applied: null })) } });
  return { cid, ids };
}
const NEEDS = '```foundry-needs\n{ "what": "the models", "why": "the showroom", "suggestions": "", "canProceedWithout": false }\n```';

describe('what the Explainer proposed, applied by the person (ADR-0075)', () => {
  test('a task joins the running goal after the tasks it names (by title), with the goal\'s must commands and its own check; a decision reaches the tasks not yet started; nothing applies twice', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const runner = new Runner((spec): Turn => (spec.prompt.includes('# Your task (second)') ? { hold: held, write: { 'two.txt': 'ok' } } : spec.prompt.includes('# Your task (add the export button)') ? { write: { 'button.txt': 'ok', 'all.txt': 'ok' } } : { write: { 'done.txt': 'ok', 'all.txt': 'ok' } }));
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'orders', repoPath: repo, brief: brief([task('T1', 'first'), task('T2', 'second', { dependsOnKeys: ['T1'] })], [check('C1', 'T1', 'done.txt'), check('C2', 'T2', 'two.txt'), check('G', null, 'all.txt')]) });
    await waitFor(() => listTasks(engine.store.db, goal.id).find((t) => t.title === 'second')?.state === 'running', 30_000);
    const { cid, ids } = proposed(engine, goal.id, [
      { type: 'task', title: 'Add the export button', summary: 'after the endpoint', task: { title: 'add the export button', spec: 'A Download CSV button.', kind: 'feature', scenario: 'frontend', difficulty: 'simple', dependsOn: ['first'], relevantFiles: ['src/orders.tsx'], checks: [{ name: 'button', cmd: 'test -f button.txt' }] } },
      { type: 'decision', title: 'No Tailwind', summary: '', decision: { text: 'Plain CSS only; no Tailwind.' } },
      { type: 'task', title: 'Nonsense', summary: '', task: { title: 'x', spec: 'y', kind: 'chore', scenario: 'general', difficulty: 'standard', dependsOn: ['no such task'], relevantFiles: [], checks: [] } },
    ]);
    const result = await engine.conversations.apply(goal.id, cid, ids[0]!, 'ann');
    const added = listTasks(engine.store.db, goal.id).find((t) => t.title === 'add the export button')!;
    expect(result).toBe(`task ${added.id}: add the export button`);
    expect([added.origin, added.kind, added.scenario, added.difficulty, added.state]).toEqual(['conversation', 'feature', 'frontend', 'simple', 'pending']);
    expect(added.dependsOn).toEqual([listTasks(engine.store.db, goal.id).find((t) => t.title === 'first')!.id]);
    expect(added.spec).toContain('From the Conversation');
    const checks = listChecks(engine.store.db, goal.id).filter((c) => c.taskId === added.id);
    expect(checks.map((c) => c.name).sort()).toEqual(['all.txt', 'button']);
    await expect(engine.conversations.apply(goal.id, cid, ids[0]!, 'ann')).rejects.toThrow(/already applied/);
    await expect(engine.conversations.apply(goal.id, cid, ids[2]!, 'ann')).rejects.toThrow(/no task "no such task"/);
    // the decision: recorded on the Brief, and a hint to the tasks not yet started (the new one), not to the running one
    expect(await engine.conversations.apply(goal.id, cid, ids[1]!, 'ann')).toContain('decision recorded');
    expect(getBrief(engine.store.db, goal.id)!.brief.questions.some((q) => q.answer === 'Plain CSS only; no Tailwind.')).toBe(true);
    expect(listTasks(engine.store.db, goal.id).find((t) => t.title === 'add the export button')!.hint).toContain('Plain CSS only');
    expect(listTasks(engine.store.db, goal.id).find((t) => t.title === 'second')!.hint).toBeNull();
    const applied = engine.conversations.view(goal.id).conversations[0]!.messages[1]!.proposals!;
    expect(applied.map((p) => p.applied?.by ?? null)).toEqual(['ann', 'ann', null]);
    release();
    await waitFor(() => ['done', 'over_delivered'].includes(getGoal(engine.store.db, goal.id)!.state), 60_000);
    expect(listTasks(engine.store.db, goal.id).find((t) => t.title === 'add the export button')!.state).toBe('done');
  }, 120_000);

  test('a note goes on a Brief that awaits approval, where a task is refused; a follow-up is the New goal form once the goal is over, where a task is refused too', async () => {
    const runner = new Runner(() => ({ write: { 'done.txt': 'ok' } }));
    const engine = track(new Engine(cfg(), runner));
    const waiting = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, waiting.id)!.state === 'awaiting_brief_approval', 30_000);
    const a = proposed(engine, waiting.id, [{ type: 'note', title: 'Keep the login', summary: '', note: { text: 'The existing login stays as it is.' } }, { type: 'task', title: 'x', summary: '', task: { title: 'x', spec: 'y', kind: 'feature', scenario: 'general', difficulty: 'standard', dependsOn: [], relevantFiles: [], checks: [] } }]);
    expect(await engine.conversations.apply(waiting.id, a.cid, a.ids[0]!, null)).toContain('note added');
    expect(getBrief(engine.store.db, waiting.id)!.brief.questions.some((q) => q.kind === 'note' && q.text === 'The existing login stays as it is.')).toBe(true);
    await expect(engine.conversations.apply(waiting.id, a.cid, a.ids[1]!, null)).rejects.toThrow(/not approved/);

    const over = await engine.createGoal({ prompt: 'small', repoPath: repo, brief: brief([task('T1', 'first')], [check('C1', 'T1', 'done.txt')]) });
    await waitFor(() => ['done', 'over_delivered'].includes(getGoal(engine.store.db, over.id)!.state), 60_000);
    const b = proposed(engine, over.id, [{ type: 'follow-up', title: 'Then the admin side', summary: '', followUp: { prompt: 'Build the admin side next.' } }, { type: 'task', title: 'x', summary: '', task: { title: 'x', spec: 'y', kind: 'feature', scenario: 'general', difficulty: 'standard', dependsOn: [], relevantFiles: [], checks: [] } }]);
    const path = await engine.conversations.apply(over.id, b.cid, b.ids[0]!, null);
    expect(path).toBe(`/goals/new?follows=${over.id}&prompt=${encodeURIComponent('Build the admin side next.')}`);
    await expect(engine.conversations.apply(over.id, b.cid, b.ids[1]!, null)).rejects.toThrow(/over/);
  }, 120_000);

  test('files given in the Conversation are handed to an open Request: it is answered with them and the session goes on', async () => {
    const runner = new Runner((spec): Turn => (spec.resumeSessionId ? { write: { 'done.txt': 'ok' } } : { finalText: `Built it.\n\n${NEEDS}` }));
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'a showroom', repoPath: repo, brief: brief([task('T1', 'build it')], [check('C1', 'T1', 'done.txt')]) });
    await waitFor(() => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).some((e) => e.trigger === 'needs_input'), 30_000);
    const esc = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })[0]!;
    // the person's question carried a file: an upload, claimed into the goal's attachments folder as a question's are
    const staged = engine.stage(stageFile(dataDir, { name: 'car.glb', mime: 'model/gltf-binary', bytes: new Uint8Array([1, 2, 3]) }), { convert: false });
    const [given] = engine.claimUploads(goal.id, [staged], 0);
    const { cid, ids } = proposed(engine, goal.id, [{ type: 'fulfil', title: 'Hand the model to the request', summary: '', fulfil: { requestId: esc.id, materialKey: null, attachmentIds: [given!.id], note: 'the only car for now' } }], [given!]);
    expect(await engine.conversations.apply(goal.id, cid, ids[0]!, 'ann')).toContain('Request answered');
    expect(listEscalations(engine.store.db, { goalId: goal.id })[0]!.state).toBe('answered');
    // the goal gets a copy of its own, marked with the Request; the Conversation keeps the file it was given
    const handed = getGoal(engine.store.db, goal.id)!.attachments.find((a) => a.name === 'car.glb')!;
    expect(handed.requestId).toBe(esc.id);
    expect(handed.id).not.toBe(given!.id);
    expect(existsSync(resolve(dataDir, handed.path!))).toBe(true);
    expect(existsSync(resolve(dataDir, given!.path!))).toBe(true);
    await waitFor(() => listTasks(engine.store.db, goal.id)[0]!.state === 'done', 30_000);
    expect(runner.calls.filter((c) => c.label?.startsWith('attempt')).at(-1)!.prompt).toContain('the only car for now');
    await expect(engine.conversations.apply(goal.id, cid, ids[0]!, 'ann')).rejects.toThrow(/already applied/);
  }, 90_000);
});
