/**
 * A second opinion on a Brief (ADR-0051): a reviewer that did not write it reads it against the repository and
 * proposes what to change, in the shape a Revise proposes — on demand from the Brief page, or once by itself when the
 * Brief fills in and the Settings switch is on. It runs on the goal reviewer's model row, read-only, capped like a
 * Revise, and never asks questions: what it cannot know it assumes and says so. Its revised Brief is kept as an event,
 * so the page shows the proposal after a reload, as a diff against the Brief as it is now, and the person applies what
 * they take.
 */
import { join } from 'node:path';
import type { Brief, Goal } from '@foundry/core';
import { RevisionOutput, diffBrief, getBrief, getGoal, isHistory } from '@foundry/core';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { attachmentsDir, markitdownHint, renderAttachments } from './attachments.ts';
import { DRAFT_RULES, REVISE_MAX_BUDGET_USD, REVISE_MAX_TURNS, briefSummary, toRevisedBrief, type DraftProposal } from './brief-draft.ts';
import { tryJson } from './checks/reviewer.ts';
import { repairable } from './clarify.ts';
import type { Engine } from './engine.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from './guards/boundary.ts';
import { metaFor, modelFor } from './models/roles.ts';

export interface SecondOpinionView {
  at: string;
  auto: boolean;
  costUsd: number;
  /** the Brief was edited, re-proposed or approved after the opinion: its rows were made against an earlier Brief */
  stale: boolean;
  proposal: DraftProposal;
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

/** Write a second opinion on the Brief awaiting approval. One at a time per goal; the proposal is kept as an event. */
export async function secondOpinion(engine: Engine, goalId: string, opts: { auto?: boolean } = {}): Promise<DraftProposal> {
  const { store, config } = engine;
  const goal = getGoal(store.db, goalId);
  if (!goal || isHistory(goal)) throw new Error('goal not found');
  if (goal.state !== 'awaiting_brief_approval') throw new Error('a second opinion needs a Brief awaiting approval');
  if (engine.secondOpinions.has(goalId)) throw new Error('a second opinion is already being written');
  const stored = getBrief(store.db, goalId);
  if (!stored || stored.skeleton) throw new Error('the Brief is not complete yet');
  const brief = stored.brief;
  engine.secondOpinions.add(goalId);
  const channel = `draft-${goal.id}`;
  const say = (text: string) => engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: { kind: 'text', text }, ts: new Date().toISOString() });
  try {
    say(opts.auto ? '— second opinion: a reviewer that did not write the Brief reads it against the repository…' : '— second opinion requested: syncing the workspace, then a reviewer that did not write the Brief reads it against the repository…');
    const ws = await engine.ensureSyncedWorkspace(goal);
    const overview = await engine.context.overview(ws).catch(() => null);
    const attachments = [renderAttachments(goal, config.dataDir), markitdownHint(engine.markitdown.available(), engine.markitdown.binary())].filter(Boolean).join('\n\n');
    const prompt = buildSecondOpinionPrompt(goal, brief, overview, attachments);
    const schema = zodToJsonSchema(RevisionOutput, { $refStrategy: 'none' });
    const n = store.listByGoal(goal.id, 5000).filter((e) => e.type === 'goal.cost_added' && (e.payload as { source?: string }).source === 'second-opinion').length + 1;
    const row = modelFor(config, goal, 'goalReviewer');
    const run = (p: string, resume?: string) =>
      engine.runner.run({
        prompt: p,
        cwd: ws,
        model: row.model,
        meta: metaFor(goal.id, row),
        maxTurns: REVISE_MAX_TURNS,
        maxBudgetUsd: REVISE_MAX_BUDGET_USD,
        permissionMode: 'dontAsk',
        allowedTools: READONLY_TOOLS,
        disallowedTools: READONLY_DISALLOWED,
        appendSystemPromptFile: engine.roles.path('brief-reviewer'),
        jsonSchema: schema,
        settings: boundarySettings(config.hooksDir),
        settingSources: config.settingSources,
        addDirs: goal.attachments.length ? [attachmentsDir(config.dataDir, goal.id)] : undefined,
        resumeSessionId: resume,
        timeoutMs: 5 * 60_000,
        transcriptPath: join(config.dataDir, 'transcripts', `second-opinion-${goal.id}-${n}.jsonl`),
        label: `second opinion (${goal.title})`,
        // asked for from the page, a person waits for it; by itself, it takes its turn with the work
        lane: opts.auto ? 'work' : 'interactive',
      });
    let cost = 0;
    const exec = async (p: string, resume?: string) => {
      const handle = await run(p, resume);
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
    let result = await exec(prompt);
    const parse = (r: typeof result) => RevisionOutput.safeParse(r.structuredOutput ?? tryJson(r.finalText));
    let parsed = parse(result);
    if (!parsed.success && result.sessionId && repairable(result)) {
      result = await exec(`Your previous answer did not match the required JSON schema (${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.') + ': ' + i.message).join('; ')}). Output the revised Brief as JSON matching the schema, nothing else.`, result.sessionId);
      parsed = parse(result);
    }
    if (!parsed.success) throw new Error(`the second opinion did not return a usable proposal${result.errorMessage ? `: ${result.errorMessage}` : ''}`);
    const out = parsed.data;
    const revised = toRevisedBrief(brief, out);
    const diff = diffBrief(brief, revised);
    store.append({ type: 'brief.second_opinion', goalId: goal.id, payload: { auto: !!opts.auto, costUsd: cost, changeSummary: out.changeSummary, revised } });
    say(`— second opinion in: ${out.changeSummary}`);
    return { mode: 'revise', taskKey: null, task: null, tasks: [], checks: [], rationale: out.changeSummary, costUsd: cost, costAvailable: goal.provider !== 'codex', revision: { diff, revised, changeSummary: out.changeSummary } };
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
  if (goal.delegatedFrom && goal.delegation.autoApprove) return;
  const events = engine.store.listByGoal(goalId, 5000);
  const proposed = events.filter((e) => e.type === 'brief.proposed').at(-1);
  if (!proposed || events.some((e) => e.type === 'brief.second_opinion' && e.seq > proposed.seq)) return;
  void secondOpinion(engine, goalId, { auto: true }).catch((err) => engine.config.log(`[second-opinion] ${goalId}: ${String((err as Error).message ?? err)}`));
}

function buildSecondOpinionPrompt(goal: Goal, brief: Brief, overview: string | null, attachments: string): string {
  return [
    `# Goal from the user\n${goal.prompt}`,
    attachments,
    `# The Brief\n${briefSummary(brief)}`,
    overview ? `# Repository overview\n${overview}` : '',
    `# Your job\nYou did not write this Brief: you are its second reviewer, standing in for the person who will approve it. Read it against the repository (read-only) and judge it: is the understanding right and complete for what was asked; are the Areas and tasks the right cut, size and order, each one session's work; do the acceptance checks decide what was asked — a must for everything asked, nothing that was not; what is missing, wrong or risky (a dependency, a migration, a test the repository already runs, a convention the Brief ignores). Return the revised Brief with every improvement made — keep what is right, word for word where you can, and keep every key of what you keep — and a changeSummary of one to three sentences saying what you changed and why. When the Brief stands, return it unchanged and say so. Never ask questions: assume, and name the assumption. Output JSON matching the schema, nothing else.`,
    DRAFT_RULES,
  ]
    .filter(Boolean)
    .join('\n\n');
}
