import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BriefOutput } from '@foundry/core';
import { getBrief, getGoal } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
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

/** answers each session by its label; the nature classifier always says code */
class LabelRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  constructor(private answers: (spec: RunSpec) => unknown) {}
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const structuredOutput = spec.label?.startsWith('classify nature') ? { nature: 'code' } : this.answers(spec);
    const result: RunResult = { sessionId: `s${this.calls.length}`, subtype: 'success', isError: false, costUsd: 0.5, numTurns: 3, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: JSON.stringify(structuredOutput), structuredOutput, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
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
    const spec = runner.calls.find((c) => c.label?.startsWith('second opinion'))!;
    expect(spec.appendSystemPromptFile?.endsWith('brief-reviewer.md')).toBe(true);
    expect(spec.model).toBe(modelFor(engine.config, getGoal(engine.store.db, goal.id)!, 'goalReviewer').model);
    expect(spec.lane).toBe('interactive');
    expect(spec.prompt).toContain('# Your job');
    expect(spec.prompt).toContain('you are its second reviewer');
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

  test('by itself when Settings say so: once per proposed Brief, in the work lane, and never for an auto-Brief', async () => {
    const runner = new LabelRunner((spec) => (spec.label?.startsWith('clarify') ? full : spec.label?.startsWith('second opinion') ? opinion : null));
    const engine = track(new Engine(cfg(), runner));
    engine.updateSettings({ workflow: { briefSecondOpinion: true } });
    const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    await waitFor(() => !!engine.secondOpinionOf(goal.id));
    const calls = runner.calls.filter((c) => c.label?.startsWith('second opinion'));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.lane).toBe('work');
    expect(engine.secondOpinionOf(goal.id)!.auto).toBe(true);
    // a Brief the engine writes and approves itself has no reader for an opinion
    const auto = await engine.createGoal({ prompt: 'noop', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
    await Bun.sleep(200);
    expect(runner.calls.filter((c) => c.label?.startsWith('second opinion'))).toHaveLength(1);
    expect(engine.secondOpinionOf(auto.id)).toBeNull();
    engine.cancelGoal(auto.id);
    await Bun.sleep(100);
  }, 30_000);
});
