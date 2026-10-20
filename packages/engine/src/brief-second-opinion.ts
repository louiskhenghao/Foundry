/**
 * A second opinion on a Brief (ADR-0051): a reviewer that did not write it reads it against the repository and
 * proposes what to change, in the shape a Revise proposes — on demand from the Brief page, or once by itself when the
 * Brief fills in and the Settings switch is on. It runs on the goal reviewer's model row, read-only, with the room of a
 * goal review, and never asks questions: what it cannot know it assumes and says so. It is written in the background:
 * the page that asked for it follows the goal detail, and what came of it is kept as an event — the revised Brief,
 * shown as a diff against the Brief as it is now, or why there is none — so the page shows it after a reload, and the
 * person applies what they take.
 */
import { join } from 'node:path';
import { reportsDollars } from '@foundry/core';
import type { Brief, Goal } from '@foundry/core';
import { RevisionOutput, diffBrief, getBrief, getGoal, isHistory } from '@foundry/core';
import type { RunResult, RunSpec } from '@foundry/runner';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { attachmentsDir, markitdownHint, renderAttachments } from './attachments.ts';
import { DRAFT_RULES, briefSummary, toRevisedBrief, type DraftProposal } from './brief-draft.ts';
import { budgetStatus } from './budget.ts';
import { tryJson } from './checks/reviewer.ts';
import type { Engine } from './engine.ts';
import { engineApproves } from './schedules.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from './guards/boundary.ts';
import { metaFor, modelFor } from './models/roles.ts';

/**
 * The room of a goal review, not of a Revise: a plan is judged against the repository as it is, and a repository of a
 * few hundred files takes more than a Revise's 40 turns and $3 to read — that ran out before the reviewer answered. The
 * budget is a worker session's, bounded by what is left of the goal's, never under the floor: an opinion that cannot
 * finish is pure waste.
 */
export const SECOND_OPINION_MAX_TURNS = 60;
export const SECOND_OPINION_MIN_BUDGET_USD = 6;
export const SECOND_OPINION_TIMEOUT_MS = 20 * 60_000;
/** the one resume when the session ran out, or answered off-schema, before the Brief: a small fresh budget, the answer only */
const NUDGE = 'Return the revised Brief now as JSON matching the schema, judged from what you have already read: keep every row you could not check as the Brief has it, and name in changeSummary what you did not get to.';
const NUDGE_MAX_TURNS = 3;
const NUDGE_MAX_BUDGET_USD = 2;
const NUDGE_TIMEOUT_MS = 5 * 60_000;

export interface SecondOpinionView {
  at: string;
  auto: boolean;
  costUsd: number;
  /** the Brief was edited, re-proposed or approved after the opinion: its rows were made against an earlier Brief */
  stale: boolean;
  proposal: DraftProposal;
}

/** why the last second opinion did not come in — the reviewer ran out, or returned no usable proposal — for the page, until one does */
export interface SecondOpinionFailure {
  at: string;
  auto: boolean;
  costUsd: number;
  reason: string;
}

type Revised = Omit<Brief, 'goalId'>;

/** the goal's last second opinion, its diff recomputed against the Brief as it is now; null when there is none */
export function secondOpinionOf(engine: Engine, goalId: string): SecondOpinionView | null {
  const events = engine.store.listByGoal(goalId, 5000);
  const last = events.filter((e) => e.type === 'brief.second_opinion').at(-1);
  const current = getBrief(engine.store.db, goalId)?.brief;
  if (!last || !current) return null;
  const p = last.payload as { auto: boolean; costUsd: number; changeSummary: string; revised: Revised };
  const stale = events.some((e) => e.seq > last.seq && (e.type === 'brief.edited' || e.type === 'brief.proposed' || e.type === 'brief.approved'));
  const goal = getGoal(engine.store.db, goalId);
  return {
    at: last.ts,
    auto: p.auto,
    costUsd: p.costUsd,
    stale,
    proposal: { mode: 'revise', taskKey: null, task: null, tasks: [], checks: [], rationale: p.changeSummary, costUsd: p.costUsd, costAvailable: goal?.provider !== 'codex', revision: { diff: diffBrief(current, p.revised), revised: p.revised, changeSummary: p.changeSummary } },
  };
}

/** the failure newer than the goal's last second opinion; null once one came in after it (or none ever failed) */
export function secondOpinionFailureOf(engine: Engine, goalId: string): SecondOpinionFailure | null {
  const events = engine.store.listByGoal(goalId, 5000);
  const failed = events.filter((e) => e.type === 'brief.second_opinion_failed').at(-1);
  if (!failed || events.some((e) => e.type === 'brief.second_opinion' && e.seq > failed.seq)) return null;
  const p = failed.payload as { auto: boolean; costUsd: number; reason: string };
  return { at: failed.ts, auto: p.auto, costUsd: p.costUsd, reason: p.reason };
}

/** the Brief a second opinion can be written on now — or, thrown, the reason there is none; checked before anything is spent */
function briefFor(engine: Engine, goalId: string): { goal: Goal; brief: Brief } {
  const goal = getGoal(engine.store.db, goalId);
  if (!goal || isHistory(goal)) throw new Error('goal not found');
  if (goal.state !== 'awaiting_brief_approval') throw new Error('a second opinion needs a Brief awaiting approval');
  if (engine.secondOpinions.has(goalId)) throw new Error('a second opinion is already being written');
  const stored = getBrief(engine.store.db, goalId);
  if (!stored || stored.skeleton) throw new Error('the Brief is not complete yet');
  return { goal, brief: stored.brief };
}

/**
 * Asked for from the page: checked now — the reasons it cannot start are thrown — and written in the background. The
 * goal detail carries it from here: being written, then the opinion, or why there is none.
 */
export function startSecondOpinion(engine: Engine, goalId: string): void {
  briefFor(engine, goalId);
  void secondOpinion(engine, goalId).catch((err) => engine.config.log(`[second-opinion] ${goalId}: ${String((err as Error).message ?? err)}`));
}

/**
 * Write a second opinion on the Brief awaiting approval: the proposal, kept as an event — or, kept the same way, why
 * there is none. One at a time per goal.
 */
export async function secondOpinion(engine: Engine, goalId: string, opts: { auto?: boolean } = {}): Promise<DraftProposal> {
  const { store, config } = engine;
  const { goal, brief } = briefFor(engine, goalId);
  engine.secondOpinions.add(goalId);
  const channel = `draft-${goal.id}`;
  const say = (text: string) => engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: { kind: 'text', text }, ts: new Date().toISOString() });
  let cost = 0;
  try {
    say(opts.auto ? '— second opinion: a reviewer that did not write the Brief reads it against the repository…' : '— second opinion requested: syncing the workspace, then a reviewer that did not write the Brief reads it against the repository…');
    const ws = await engine.ensureSyncedWorkspace(goal);
    const overview = await engine.context.overview(ws).catch(() => null);
    const attachments = [renderAttachments(goal, config.dataDir), markitdownHint(engine.markitdown.available(), engine.markitdown.binary())].filter(Boolean).join('\n\n');
    const n = store.listByGoal(goal.id, 5000).filter((e) => e.type === 'goal.cost_added' && (e.payload as { source?: string }).source === 'second-opinion').length + 1;
    const row = modelFor(config, goal, 'goalReviewer');
    const remaining = budgetStatus(goal).remainingUsd;
    const cap = Math.max(SECOND_OPINION_MIN_BUDGET_USD, remaining == null ? config.attemptMaxCostUsd : Math.min(config.attemptMaxCostUsd, remaining));
    const base = {
      cwd: ws,
      model: row.model,
      meta: metaFor(goal.id, row),
      permissionMode: 'dontAsk' as const,
      allowedTools: READONLY_TOOLS,
      disallowedTools: READONLY_DISALLOWED,
      appendSystemPromptFile: engine.roles.path('brief-reviewer'),
      jsonSchema: zodToJsonSchema(RevisionOutput, { $refStrategy: 'none' }),
      settings: boundarySettings(config.hooksDir),
      settingSources: config.settingSources,
      addDirs: goal.attachments.length ? [attachmentsDir(config.dataDir, goal.id)] : undefined,
      transcriptPath: join(config.dataDir, 'transcripts', `second-opinion-${goal.id}-${n}.jsonl`),
      // asked for from the page, a person waits for it; by itself, it takes its turn with the work
      lane: opts.auto ? ('work' as const) : ('interactive' as const),
    };
    const exec = async (spec: RunSpec) => {
      const handle = await engine.runner.run(spec);
      // tracked with the goal's background sessions: cancelling the goal kills it
      const untrack = engine.trackBackground(goal.id, handle);
      try {
        for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: ev, ts: new Date().toISOString() });
        const result = await handle.result;
        cost += result.costUsd;
        store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source: 'second-opinion' } });
        engine.recordSessionUsage(result, { goalId: goal.id, kind: 'second-opinion', model: row.model });
        return result;
      } finally {
        untrack();
      }
    };
    const parse = (r: RunResult) => RevisionOutput.safeParse(r.structuredOutput ?? tryJson(r.finalText));
    let result = await exec({ ...base, prompt: buildSecondOpinionPrompt(goal, brief, overview, attachments), maxTurns: SECOND_OPINION_MAX_TURNS, maxBudgetUsd: cap, timeoutMs: SECOND_OPINION_TIMEOUT_MS, label: `second opinion (${goal.title})` });
    let parsed = parse(result);
    let nudged = false;
    if (!parsed.success && result.sessionId) {
      // the session ran out (budget, turns, time) or answered off-schema before the Brief: resume it once with a small fresh budget and ask for the answer only
      const why = result.subtype === 'success' ? `Your previous answer did not match the required JSON schema (${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.') + ': ' + i.message).join('; ')}). ` : 'Stop reading. ';
      nudged = true;
      result = await exec({ ...base, prompt: why + NUDGE, resumeSessionId: result.sessionId, maxTurns: NUDGE_MAX_TURNS, maxBudgetUsd: NUDGE_MAX_BUDGET_USD, timeoutMs: NUDGE_TIMEOUT_MS, label: `second opinion (${goal.title}) (nudge)` });
      parsed = parse(result);
    }
    if (!parsed.success) throw new Error(reasonOf(result, nudged));
    const out = parsed.data;
    const revised = toRevisedBrief(brief, out);
    const diff = diffBrief(brief, revised);
    store.append({ type: 'brief.second_opinion', goalId: goal.id, payload: { auto: !!opts.auto, costUsd: cost, changeSummary: out.changeSummary, revised } });
    say(`— second opinion in: ${out.changeSummary}`);
    return { mode: 'revise', taskKey: null, task: null, tasks: [], checks: [], rationale: out.changeSummary, costUsd: cost, costAvailable: reportsDollars(goal.provider), revision: { diff, revised, changeSummary: out.changeSummary } };
  } catch (err) {
    const reason = String((err as Error).message ?? err);
    // kept the way the opinion would be, so the page says why there is none until one comes in (the store may be gone when the engine stops)
    try {
      store.append({ type: 'brief.second_opinion_failed', goalId: goal.id, payload: { auto: !!opts.auto, costUsd: cost, reason } });
      say(`— second opinion could not finish: ${reason}`);
    } catch {}
    throw err;
  } finally {
    engine.secondOpinions.delete(goalId);
  }
}

/**
 * The automatic one (Settings → Second opinion on every Brief): once per proposed Brief, for a goal a person will
 * approve. A Brief the engine approves itself — a Delegated goal on auto-approve — has no reader for it.
 */
export function secondOpinionOnBrief(engine: Engine, goalId: string): void {
  if (!engine.settings.values().workflow.briefSecondOpinion) return;
  const goal = getGoal(engine.store.db, goalId);
  if (!goal || goal.state !== 'awaiting_brief_approval') return;
  if (engineApproves(goal)) return;
  const events = engine.store.listByGoal(goalId, 5000);
  const proposed = events.filter((e) => e.type === 'brief.proposed').at(-1);
  if (!proposed || events.some((e) => e.type === 'brief.second_opinion' && e.seq > proposed.seq)) return;
  void secondOpinion(engine, goalId, { auto: true }).catch((err) => engine.config.log(`[second-opinion] ${goalId}: ${String((err as Error).message ?? err)}`));
}

/** why there is no opinion, in the words the page shows */
function reasonOf(r: RunResult, nudged: boolean): string {
  const ranOut = r.subtype === 'error_max_budget_usd' ? 'budget' : r.subtype === 'error_max_turns' ? 'turns' : r.subtype === 'killed_timeout' ? 'time' : null;
  const what = ranOut ? `the reviewer ran out of ${ranOut} before answering` : `the reviewer did not return a usable proposal${r.errorMessage ? `: ${r.errorMessage.slice(0, 200)}` : ''}`;
  return nudged ? `${what}, even nudged once for the answer` : what;
}

function buildSecondOpinionPrompt(goal: Goal, brief: Brief, overview: string | null, attachments: string): string {
  return [
    `# Goal from the user\n${goal.prompt}`,
    attachments,
    `# The Brief\n${briefSummary(brief)}`,
    overview ? `# Repository overview\n${overview}` : '',
    `# Your job\nYou did not write this Brief: you are its second reviewer, standing in for the person who will approve it. Read it against the repository (read-only) and judge it: is the understanding right and complete for what was asked; are the Areas and tasks the right cut, size and order, each one session's work; do the acceptance checks decide what was asked — a must for everything asked, nothing that was not; what is missing, wrong or risky (a dependency, a migration, a test the repository already runs, a convention the Brief ignores). Read with a budget: what the Brief names and what that touches — its relevant files, the tests the repository runs, the conventions its docs state — not the whole repository; answer before you run out, and what you did not get to, keep as the Brief has it and say so. Return the revised Brief with every improvement made — keep what is right, word for word where you can, and keep every key of what you keep — and a changeSummary of one to three sentences saying what you changed and why. When the Brief stands, return it unchanged and say so. Never ask questions: assume, and name the assumption. Output JSON matching the schema, nothing else.`,
    DRAFT_RULES,
  ]
    .filter(Boolean)
    .join('\n\n');
}
