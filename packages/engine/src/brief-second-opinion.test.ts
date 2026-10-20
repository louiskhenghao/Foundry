import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BriefOutput } from '@foundry/core';
import { getBrief, getGoal } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { SECOND_OPINION_MAX_TURNS, SECOND_OPINION_MIN_BUDGET_USD, SECOND_OPINION_TIMEOUT_MS } from './brief-second-opinion.ts';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { modelFor } from './models/roles.ts';
import { makeRepo, waitFor } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let repo: string;
const engines: Engine[] = [];
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-second-opinion-'));
  repo = await makeRepo();
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
  rmSync(`${repo}-foundry`, { recursive: true, force: true });
});
const track = (e: Engine) => (engines.push(e), e);
const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} });

/** what a fake session answers: its structured output, or how it ended without one */
type Answer = unknown | { ended: RunResult['subtype'] };
/** answers each session by its label; the nature classifier always says code */
class LabelRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  constructor(private answers: (spec: RunSpec) => Answer | Promise<Answer>) {}
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const a = spec.label?.startsWith('classify nature') ? { nature: 'code' } : await this.answers(spec);
    // a resumed session reports the session's whole cost ($0.5 before, $0.5 now), as the CLI does; the engine books what this run added
    const ended = a && typeof a === 'object' && 'ended' in a ? (a as { ended: RunResult['subtype'] }).ended : null;
    const structuredOutput = ended ? null : a;
    const result: RunResult = { sessionId: `s${this.calls.length}`, subtype: ended ?? 'success', isError: !!ended, costUsd: spec.resumeSessionId ? 1 : 0.5, numTurns: 3, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: ended ? '' : JSON.stringify(structuredOutput), structuredOutput, exitCode: ended ? 1 : 0, pid: null, rateLimit: null, errorMessage: ended ? `ended: ${ended}` : null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'init', sessionId: result.sessionId!, model: 'fake', tools: [], raw: {} }, { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}

const areas = [{ key: 'A1', name: 'Student portal', slug: 'student-portal', description: 'what students see' }];
const task = (key: string, title: string, deps: string[] = []): BriefOutput['tasks'][number] => ({ key, title, spec: `do ${title}`, kind: 'feature', scope: null, scenario: 'frontend', difficulty: 'standard', areaKey: 'A1', dependsOnKeys: deps, parallelizable: true, relevantFiles: ['README.md'], milestone: null });
const check = (key: string, taskKey: string | null): BriefOutput['checks'][number] => ({ key, name: key, tier: 'must', taskKey, areaKey: null, type: 'command', cmd: 'true', rubric: null });
const full: BriefOutput = { title: 'feat(portal): build the student portal', understanding: 'One portal.', nature: 'code', areas, assumptions: ['a'], tasks: [task('T1', 'add student home')], checks: [check('C1', 'T1')], costEstimateUsd: 4, timeEstimateMin: 30, openQuestions: [], styleOptions: [], run: null, apps: null };
const { openQuestions: _q, ...revisable } = full;
/** what the reviewer proposes: a sharper understanding and one more task with its check */
const opinion = { ...revisable, understanding: 'One portal, grades first.', tasks: [task('T1', 'add student home'), task('T4', 'add student grades', ['T1'])], checks: [check('C1', 'T1'), check('C4', 'T4')], changeSummary: 'Added the grades page the goal implies.', newQuestions: [] };
const secondOpinionCalls = (runner: LabelRunner) => runner.calls.filter((c) => c.label?.startsWith('second opinion'));

describe('a second opinion on the Brief (ADR-0051)', () => {
  test('on demand: a reviewer on the goal reviewer row proposes a Revise-shaped diff, kept as an event and shown against the Brief as it is now', async () => {
    const runner = new LabelRunner((spec) => (spec.label?.startsWith('clarify') ? full : spec.label?.startsWith('second opinion') ? opinion : null));
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(engine.secondOpinionOf(goal.id)).toBeNull();

    const p = await engine.secondOpinion(goal.id);
    expect(p.revision!.diff.tasks.added.map((t) => t.key)).toEqual(['T4']);
    expect(p.revision!.diff.understanding?.after).toBe('One portal, grades first.');
    expect(p.rationale).toBe('Added the grades page the goal implies.');
    const spec = secondOpinionCalls(runner)[0]!;
    expect(spec.appendSystemPromptFile?.endsWith('brief-reviewer.md')).toBe(true);
    expect(spec.model).toBe(modelFor(engine.config, getGoal(engine.store.db, goal.id)!, 'goalReviewer').model);
    expect(spec.lane).toBe('interactive');
    expect(spec.prompt).toContain('# Your job');
    expect(spec.prompt).toContain('you are its second reviewer');
    expect(spec.prompt).toContain('Read with a budget');
    // the room of a goal review, not of a Revise: a plan read against a repository of any size
    expect(spec.maxTurns).toBe(SECOND_OPINION_MAX_TURNS);
    expect(spec.maxBudgetUsd).toBeGreaterThanOrEqual(SECOND_OPINION_MIN_BUDGET_USD);
    expect(spec.timeoutMs).toBe(SECOND_OPINION_TIMEOUT_MS);
    const events = engine.store.listByGoal(goal.id, 5000);
    expect(events.some((e) => e.type === 'brief.second_opinion')).toBe(true);
    expect(events.some((e) => e.type === 'goal.cost_added' && (e.payload as { source: string }).source === 'second-opinion')).toBe(true);
    // the page reads it back as a diff against the stored Brief; an edit since marks it stale
    const view = engine.secondOpinionOf(goal.id)!;
    expect(view.stale).toBe(false);
    expect(view.auto).toBe(false);
    expect(view.proposal.revision!.diff.tasks.added.map((t) => t.key)).toEqual(['T4']);
    const stored = getBrief(engine.store.db, goal.id)!.brief;
    engine.editBrief(goal.id, { ...stored, understanding: 'One portal, edited.' });
    expect(engine.secondOpinionOf(goal.id)!.stale).toBe(true);
    // the Brief itself is untouched by the opinion: the person applies the rows
    expect(getBrief(engine.store.db, goal.id)!.brief.tasks.map((t) => t.key)).toEqual(['T1']);
  }, 30_000);

  test('ran out before answering: one nudge resumes the session with a small fresh budget and asks for the answer only', async () => {
    const runner = new LabelRunner((spec) => (spec.label?.startsWith('clarify') ? full : spec.label?.endsWith('(nudge)') ? opinion : spec.label?.startsWith('second opinion') ? { ended: 'error_max_budget_usd' } : null));
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const p = await engine.secondOpinion(goal.id);
    expect(p.revision!.diff.tasks.added.map((t) => t.key)).toEqual(['T4']);
    const [first, nudge] = secondOpinionCalls(runner);
    expect(nudge!.resumeSessionId).toBe(`s${runner.calls.indexOf(first!) + 1}`);
    expect(nudge!.maxTurns).toBe(3);
    // the CLI checks a resumed session's budget against the session's whole cost: the engine raises the cap by what it already spent
    expect(nudge!.maxBudgetUsd).toBe(2 + 0.5);
    expect(nudge!.prompt).toMatch(/^Stop reading\. Return the revised Brief now as JSON/);
    expect(nudge!.allowedTools).toEqual(first!.allowedTools);
    expect(nudge!.transcriptPath).toBe(first!.transcriptPath);
    // both sessions are the goal's cost, and the opinion carries the sum
    expect(engine.secondOpinionOf(goal.id)!.costUsd).toBe(1);
    expect(engine.secondOpinionFailureOf(goal.id)).toBeNull();
  }, 30_000);

  test('answered off-schema: the nudge names the schema issues and asks for the answer only', async () => {
    const runner = new LabelRunner((spec) => (spec.label?.startsWith('clarify') ? full : spec.label?.endsWith('(nudge)') ? opinion : spec.label?.startsWith('second opinion') ? { changeSummary: 'half an answer' } : null));
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    await engine.secondOpinion(goal.id);
    const nudge = secondOpinionCalls(runner)[1]!;
    expect(nudge.prompt).toMatch(/^Your previous answer did not match the required JSON schema \(/);
    expect(nudge.prompt).toContain('Return the revised Brief now as JSON');
  }, 30_000);

  test('could not finish: kept as a failure the page shows, with what it cost, until one comes in', async () => {
    let ends = true;
    const runner = new LabelRunner((spec) => (spec.label?.startsWith('clarify') ? full : spec.label?.startsWith('second opinion') ? (ends ? { ended: 'killed_timeout' } : opinion) : null));
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const reason = 'the reviewer ran out of time before answering, even nudged once for the answer';
    await expect(engine.secondOpinion(goal.id)).rejects.toThrow(reason);
    expect(engine.secondOpinions.has(goal.id)).toBe(false);
    expect(engine.secondOpinionOf(goal.id)).toBeNull();
    const failed = engine.secondOpinionFailureOf(goal.id)!;
    expect(failed.reason).toBe(reason);
    expect(failed.auto).toBe(false);
    expect(failed.costUsd).toBe(1);
    const events = engine.store.listByGoal(goal.id, 5000);
    expect(events.filter((e) => e.type === 'brief.second_opinion_failed')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'goal.cost_added' && (e.payload as { source: string }).source === 'second-opinion')).toHaveLength(2);
    // the next one that comes in replaces the failure
    ends = false;
    await engine.secondOpinion(goal.id);
    expect(engine.secondOpinionFailureOf(goal.id)).toBeNull();
    expect(engine.secondOpinionOf(goal.id)).not.toBeNull();
  }, 30_000);

  test('started from the page: checked now, written in the background, one at a time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const runner = new LabelRunner((spec) => (spec.label?.startsWith('clarify') ? full : spec.label?.startsWith('second opinion') ? gate.then(() => opinion) : null));
    const engine = track(new Engine(cfg(), runner));
    expect(() => engine.startSecondOpinion('g_nobody')).toThrow('goal not found');
    const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    engine.startSecondOpinion(goal.id);
    expect(engine.secondOpinions.has(goal.id)).toBe(true);
    expect(() => engine.startSecondOpinion(goal.id)).toThrow('a second opinion is already being written');
    expect(engine.secondOpinionOf(goal.id)).toBeNull();
    release();
    await waitFor(() => !!engine.secondOpinionOf(goal.id));
    expect(engine.secondOpinions.has(goal.id)).toBe(false);
    expect(secondOpinionCalls(runner)).toHaveLength(1);
  }, 30_000);

  test('by itself when Settings say so: once per proposed Brief, in the work lane, and never for an auto-Brief', async () => {
    const runner = new LabelRunner((spec) => (spec.label?.startsWith('clarify') ? full : spec.label?.startsWith('second opinion') ? opinion : null));
    const engine = track(new Engine(cfg(), runner));
    engine.updateSettings({ workflow: { briefSecondOpinion: true } });
    const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    await waitFor(() => !!engine.secondOpinionOf(goal.id));
    const calls = secondOpinionCalls(runner);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.lane).toBe('work');
    expect(engine.secondOpinionOf(goal.id)!.auto).toBe(true);
    // a Brief the engine writes and approves itself has no reader for an opinion
    const auto = await engine.createGoal({ prompt: 'noop', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
    await Bun.sleep(200);
    expect(secondOpinionCalls(runner)).toHaveLength(1);
    expect(engine.secondOpinionOf(auto.id)).toBeNull();
    engine.cancelGoal(auto.id);
    await Bun.sleep(100);
  }, 30_000);
});
