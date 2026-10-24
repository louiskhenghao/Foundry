import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BriefOutput } from '@foundry/core';
import { getGoal, listConversations } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { budgetStatus } from '../budget.ts';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { modelFor } from '../models/roles.ts';
import { makeRepo, sh, waitFor } from '../test-helpers.ts';
import { CONVERSATION_MAX_TURNS, ConversationError, conversationChannel } from './conversations.ts';
import { RECORDS_DIR, conversationWorkspacePath } from './workspace.ts';
import { CONVERSATION_ATTACHMENTS_MAX, CONVERSATION_FILES_ONLY_TEXT } from '@foundry/core';
import { stageFile } from '../attachments.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
let repo: string;
const engines: Engine[] = [];
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-conversation-'));
  repo = await makeRepo();
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
  rmSync(`${repo}-foundry`, { recursive: true, force: true });
});
const track = (e: Engine) => (engines.push(e), e);
const cfg = (extra: Record<string, unknown> = {}) => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, useGraphify: false, log: () => {}, betaConversation: true, ...extra });

/** what an Explainer turn answers: its text, or how it ended without one */
type Answer = string | { ended: string; message?: string };
const make = (sessionId: string, subtype: string, text: string, error: string | null): RunResult => ({ sessionId, subtype, isError: subtype !== 'success', costUsd: subtype === 'killed_manual' ? 0 : 0.5, costStatus: 'reported', numTurns: 3, durationMs: 1, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: null, permissionDenials: [], finalText: text || null, structuredOutput: null, exitCode: subtype === 'success' ? 0 : 1, pid: null, rateLimit: null, errorMessage: error, failureClass: null, skillsUsed: [], toolsUsed: {} });

/** answers Clarify and the nature classifier at once; Explainer turns by `answer`, held back while `hold` is on, and stopped by kill */
class ChatRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  hold = false;
  private releases: (() => void)[] = [];
  constructor(private answer: (spec: RunSpec, turn: number) => Answer) {}
  active() {
    return 0;
  }
  release() {
    for (const r of this.releases.splice(0)) r();
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    // a resumed session keeps its id, as the coding agents' do
    const id = spec.resumeSessionId ?? `s${this.calls.length}`;
    const label = spec.label ?? '';
    if (!label.startsWith('conversation')) {
      const out = label.startsWith('classify nature') ? { nature: 'code' } : full;
      const r: RunResult = { ...make(id, 'success', JSON.stringify(out), null), structuredOutput: out };
      const events: RunnerEvent[] = [{ kind: 'init', sessionId: id, model: 'fake', tools: [], raw: {} }, { kind: 'result', result: r }];
      return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(r) };
    }
    const turn = this.calls.filter((c) => c.label?.startsWith('conversation')).length;
    let killed = false;
    let go!: () => void;
    const gate = new Promise<void>((r) => (go = r));
    if (this.hold) this.releases.push(go);
    else go();
    const result = gate.then(() => {
      if (killed) return make(id, 'killed_manual', '', 'killed');
      const a = this.answer(spec, turn);
      return typeof a === 'string' ? make(id, 'success', a, null) : make(id, a.ended, '', a.message ?? `ended: ${a.ended}`);
    });
    const events = (async function* () {
      yield { kind: 'init', sessionId: id, model: 'fake', tools: [], raw: {} } as RunnerEvent;
      const r = await result;
      if (r.finalText) {
        const half = Math.ceil(r.finalText.length / 2);
        yield { kind: 'text_delta', text: r.finalText.slice(0, half) } as RunnerEvent;
        yield { kind: 'text_delta', text: r.finalText.slice(half) } as RunnerEvent;
        yield { kind: 'text', text: r.finalText } as RunnerEvent;
      }
      yield { kind: 'result', result: r } as RunnerEvent;
    })();
    return { pid: null, events, kill: () => { killed = true; go(); }, result };
  }
}

const areas = [{ key: 'A1', name: 'Student portal', slug: 'student-portal', description: 'what students see' }];
const task = (key: string, title: string, deps: string[] = []): BriefOutput['tasks'][number] => ({ key, title, spec: `do ${title}`, kind: 'feature', scope: null, scenario: 'frontend', difficulty: 'standard', areaKey: 'A1', dependsOnKeys: deps, parallelizable: true, relevantFiles: ['README.md'], milestone: null });
const check = (key: string, taskKey: string | null): BriefOutput['checks'][number] => ({ key, name: key, tier: 'must', taskKey, areaKey: null, type: 'command', cmd: 'true', rubric: null });
const full: BriefOutput = { title: 'feat(portal): build the student portal', understanding: 'One portal.', nature: 'code', areas, assumptions: ['a'], tasks: [task('T1', 'add student home'), task('T2', 'add student grades', ['T1'])], checks: [check('C1', 'T1')], costEstimateUsd: 4, timeEstimateMin: 30, openQuestions: [], styleOptions: [], run: null, apps: null };
const chatCalls = (runner: ChatRunner) => runner.calls.filter((c) => c.label?.startsWith('conversation'));
const answered = (engine: Engine, goalId: string, n: number) => listConversations(engine.store.db, goalId).flatMap((c) => c.messages).filter((m) => m.role === 'explainer').length >= n;

describe('a Conversation on a goal (ADR-0073)', () => {
  test('off until Settings → Beta switches it on: asking is refused, and the page is told', async () => {
    const runner = new ChatRunner(() => 'yes');
    const engine = track(new Engine(cfg({ betaConversation: false }), runner));
    const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(engine.conversations.view(goal.id).enabled).toBe(false);
    let err: unknown;
    try {
      engine.conversations.ask(goal.id, 'why two tasks?');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConversationError);
    expect((err as ConversationError).status).toBe(409);
    expect(listConversations(engine.store.db, goal.id)).toEqual([]);
  }, 30_000);

  test("the Explainer answers in a read-only checkout of the goal's branch with Foundry's records beside the code, beside the limit, and what it cost is the goal's but outside its budget", async () => {
    const runner = new ChatRunner(() => 'Because the first task makes the table the second one reads.');
    const engine = track(new Engine(cfg(), runner));
    // a budget Clarify ($1.00 here) leaves little of: the answer's $0.50 would trip it, were it counted
    const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo, budgets: { maxCostUsd: 1.2 } });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const before = getGoal(engine.store.db, goal.id)!;
    const asked = engine.conversations.ask(goal.id, 'Why does T2 depend on T1?', { by: 'ann' });
    expect(asked.channel).toBe(conversationChannel(asked.conversationId));
    // asked at once: the view shows the question waiting for its answer
    const early = engine.conversations.view(goal.id);
    expect(early.conversations[0]!.messages.map((m) => m.role)).toEqual(['person']);
    await waitFor(() => answered(engine, goal.id, 1), 30_000);

    const [c] = listConversations(engine.store.db, goal.id);
    expect(c!.by).toBe('ann');
    expect(c!.title).toBe('Why does T2 depend on T1?');
    expect(c!.messages.map((m) => [m.role, m.status])).toEqual([['person', null], ['explainer', 'done']]);
    const reply = c!.messages[1]!;
    expect(reply.text).toBe('Because the first task makes the table the second one reads.');
    expect(reply.askedId).toBe(asked.messageId);
    expect(reply.costUsd).toBe(0.5);
    expect(reply.costAvailable).toBe(true);
    expect(reply.model).toBe('fake');
    expect(c!.sessionId).toBe(chatCalls(runner)[0]!.resumeSessionId ?? `s${runner.calls.length}`);

    const spec = chatCalls(runner)[0]!;
    expect(spec.lane).toBe('aside');
    expect(spec.partialText).toBe(true);
    expect(spec.readOnlyShell).toBe(true);
    expect(spec.maxTurns).toBe(CONVERSATION_MAX_TURNS);
    expect(spec.appendSystemPromptFile?.endsWith('explainer.md')).toBe(true);
    expect(spec.allowedTools).toContain('Bash');
    expect(spec.allowedTools).not.toContain('Write');
    expect(spec.disallowedTools).toContain('Edit');
    expect(spec.model).toBe(modelFor(engine.config, getGoal(engine.store.db, goal.id)!, 'explainer').model);
    expect(spec.resumeSessionId).toBeUndefined();
    expect(spec.prompt).toContain('# The question');
    expect(spec.prompt).toContain('Why does T2 depend on T1?');
    expect(spec.prompt).toContain("the goal's branch");
    expect(spec.prompt).toContain('add student grades');
    // the hooks: the canary and the boundary as every session, and the shell kept to reading
    expect(JSON.stringify(spec.settings)).toContain('readonly-bash.ts');

    // its own worktree, detached at the goal branch's tip, with the records folder in it and out of git's view
    const cwd = conversationWorkspacePath(engine.config.dataDir, getGoal(engine.store.db, goal.id)!);
    expect(spec.cwd).toBe(cwd);
    expect(await sh('git rev-parse HEAD', cwd)).toBe(await sh(`git rev-parse refs/heads/${goal.branch}`, repo));
    expect(await sh('git status --porcelain', cwd)).toBe('');
    for (const f of ['README.md', 'goal.md', 'brief.md', 'timeline.md', 'escalations.md', 'review.md', 'delivery.md', 'attachments.md', 'learnings.md']) expect(existsSync(join(cwd, RECORDS_DIR, f))).toBe(true);
    expect(readFileSync(join(cwd, RECORDS_DIR, 'brief.md'), 'utf8')).toContain('add student grades');
    // before approval the tasks are the Brief's plan (in brief.md and the summary), not rows with files of their own
    expect(listTasksFiles(cwd).length).toBe(0);
    expect(spec.prompt).toContain('## Planned tasks (2)');

    // the cost is the goal's, apart from its work, and the budget leaves it out
    const after = getGoal(engine.store.db, goal.id)!;
    expect(after.costUsd).toBeCloseTo(before.costUsd + 0.5, 5);
    expect(after.conversationCostUsd).toBeCloseTo(0.5, 5);
    expect(budgetStatus(after).costUsd).toBeCloseTo(before.costUsd, 5);
    expect(budgetStatus(after).conversationUsd).toBeCloseTo(0.5, 5);
    expect(after.costUsd).toBeGreaterThan(after.budgets.maxCostUsd!);
    expect(budgetStatus(after).exceeded).toBeNull();
    const usage = engine.store.listByGoalOfTypes(goal.id, ['session.usage']).filter((e) => e.type === 'session.usage' && e.payload.kind === 'conversation');
    expect(usage).toHaveLength(1);
  }, 60_000);

  test('the next question resumes the session with what happened since; a refused resume starts afresh with the conversation so far', async () => {
    const runner = new ChatRunner((spec, turn) => (turn === 3 ? { ended: 'error_during_execution', message: 'No conversation found with session ID: s9' } : `Answer ${turn}`));
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const first = engine.conversations.ask(goal.id, 'What does T1 do?');
    await waitFor(() => answered(engine, goal.id, 1), 30_000);
    const firstSession = listConversations(engine.store.db, goal.id)[0]!.sessionId!;
    engine.conversations.ask(goal.id, 'And T2?', { conversationId: first.conversationId });
    await waitFor(() => answered(engine, goal.id, 2), 30_000);
    const second = chatCalls(runner)[1]!;
    expect(second.resumeSessionId).toBe(firstSession);
    expect(second.prompt).toContain('# Since your last answer');
    expect(second.prompt).toContain('# The next question');
    expect(second.prompt).toContain('And T2?');
    expect(second.prompt).not.toContain('# The question');

    // the third turn's resume is refused: a fresh session is given everything said so far
    engine.conversations.ask(goal.id, 'Which files?');
    await waitFor(() => answered(engine, goal.id, 3), 30_000);
    const [third, fourth] = chatCalls(runner).slice(2);
    expect(third!.resumeSessionId).toBe(firstSession);
    expect(fourth!.resumeSessionId).toBeUndefined();
    expect(fourth!.prompt).toContain('# What was said so far');
    expect(fourth!.prompt).toContain('What does T1 do?');
    expect(fourth!.prompt).toContain('Answer 2');
    expect(fourth!.prompt).toContain('# The question\nWhich files?');
    const c = listConversations(engine.store.db, goal.id)[0]!;
    expect(c.messages.filter((m) => m.role === 'explainer').map((m) => [m.text, m.status])).toEqual([['Answer 1', 'done'], ['Answer 2', 'done'], ['Answer 4', 'done']]);
    expect(c.sessionId).toBe(`s${runner.calls.length}`);
  }, 60_000);

  test('questions sent while an answer is written wait their turn; Stop ends the answer where it is and lets the waiting ones go', async () => {
    const runner = new ChatRunner(() => 'late');
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    runner.hold = true;
    const a = engine.conversations.ask(goal.id, 'first?');
    const b = engine.conversations.ask(goal.id, 'second?');
    expect(b.conversationId).toBe(a.conversationId);
    await waitFor(() => chatCalls(runner).length === 1, 30_000);
    const live = engine.conversations.view(goal.id).live[a.conversationId]!;
    expect(live.answering).toBe(a.messageId);
    expect(live.queued).toEqual([b.messageId]);
    expect(engine.conversations.stopAnswer(a.conversationId)).toBe(true);
    await waitFor(() => answered(engine, goal.id, 2), 30_000);
    const c = listConversations(engine.store.db, goal.id)[0]!;
    const replies = c.messages.filter((m) => m.role === 'explainer');
    expect(replies.map((m) => [m.askedId, m.status])).toEqual(expect.arrayContaining([[b.messageId, 'stopped'], [a.messageId, 'stopped']]));
    expect(replies.find((m) => m.askedId === b.messageId)!.reason).toBe('stopped before it was answered');
    expect(replies.find((m) => m.askedId === a.messageId)!.reason).toBe('stopped by the person');
    expect(chatCalls(runner)).toHaveLength(1);
    expect(engine.conversations.stopAnswer(a.conversationId)).toBe(false);
    expect(engine.conversations.view(goal.id).live[a.conversationId]).toEqual({ answering: null, queued: [] });
  }, 60_000);

  test('a fresh Conversation starts another thread, and a plain question goes to the newest; deleting the goal removes its worktree and its Conversations', async () => {
    const runner = new ChatRunner((_spec, turn) => `A${turn}`);
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const first = engine.conversations.ask(goal.id, 'one');
    await waitFor(() => answered(engine, goal.id, 1), 30_000);
    const second = engine.conversations.ask(goal.id, 'two', { fresh: true });
    expect(second.conversationId).not.toBe(first.conversationId);
    await waitFor(() => answered(engine, goal.id, 2), 30_000);
    const third = engine.conversations.ask(goal.id, 'three');
    expect(third.conversationId).toBe(second.conversationId);
    await waitFor(() => answered(engine, goal.id, 3), 30_000);
    expect(listConversations(engine.store.db, goal.id).map((c) => c.messages.length)).toEqual([2, 4]);
    // a new thread is a new session: nothing to resume
    expect(chatCalls(runner)[1]!.resumeSessionId).toBeUndefined();
    const cwd = conversationWorkspacePath(engine.config.dataDir, getGoal(engine.store.db, goal.id)!);
    expect(existsSync(cwd)).toBe(true);
    await engine.deleteGoal(goal.id);
    expect(existsSync(cwd)).toBe(false);
    expect(listConversations(engine.store.db, goal.id)).toEqual([]);
    expect((await sh('git worktree list', repo)).includes('conversation')).toBe(false);
  }, 60_000);
});

function listTasksFiles(cwd: string): string[] {
  return require('node:fs').readdirSync(join(cwd, RECORDS_DIR, 'tasks')) as string[];
}

test("a question can carry pictures and files: the staged uploads are claimed into the goal's attachments, copied beside the records, and named to the Explainer", async () => {
  const runner = new ChatRunner(() => 'A red button.');
  const engine = track(new Engine(cfg(), runner));
  const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
  await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const staged = engine.stage(stageFile(engine.config.dataDir, { name: 'screen.png', mime: 'image/png', bytes }), { convert: false });
  // too many is refused before anything moves
  expect(() => engine.conversations.ask(goal.id, 'x', { attachments: Array.from({ length: CONVERSATION_ATTACHMENTS_MAX + 1 }, () => staged) })).toThrow(/at most/);
  // a question that is only its files has the words for it
  const asked = engine.conversations.ask(goal.id, '', { attachments: [staged] });
  const [c] = listConversations(engine.store.db, goal.id);
  const q = c!.messages[0]!;
  expect(q.text).toBe(CONVERSATION_FILES_ONLY_TEXT);
  expect(q.attachments.map((a) => [a.id, a.path])).toEqual([[staged.id, `attachments/${goal.id}/${staged.id}/screen.png`]]);
  expect(existsSync(join(engine.config.dataDir, q.attachments[0]!.path!))).toBe(true);
  await waitFor(() => answered(engine, goal.id, 1), 30_000);
  const spec = chatCalls(runner)[0]!;
  expect(spec.prompt).toContain('## Attached to this question');
  expect(spec.prompt).toContain(`.foundry-goal/asked/${asked.messageId}/screen.png`);
  expect(spec.prompt).toMatch(/\(image, 1 KB; id att_[a-z0-9]+\)/);
  const copied = join(conversationWorkspacePath(engine.config.dataDir, getGoal(engine.store.db, goal.id)!), '.foundry-goal', 'asked', asked.messageId, 'screen.png');
  expect(new Uint8Array(readFileSync(copied))).toEqual(bytes);
  // the goal's own attachments are untouched, and a used-up upload cannot be sent again
  expect(getGoal(engine.store.db, goal.id)!.attachments).toHaveLength(0);
  expect(() => engine.conversations.ask(goal.id, 'again', { attachments: [staged] })).toThrow(/no longer available/);
}, 60_000);
