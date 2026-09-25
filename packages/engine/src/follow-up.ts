/**
 * Follow-up goals: B follows A, an earlier finished goal of the same repository. At creation B takes a snapshot of
 * what it needs from A (the "# Previous goal" section for Clarify, the chosen style, copies of the attachments),
 * so deleting A later breaks nothing. B's goal branch starts from the base branch when A's work is already on it,
 * otherwise from A's goal branch — then A's changes go along in B's delivery. Marking a goal as a follow-up
 * afterwards records the relationship only.
 */
import { cpSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import type { Attachment, BriefStyleOption, DeliveryPolicy, Effort, Goal, GoalFollows, GoalMode, GoalNature, GoalState } from '@foundry/core';
import { ATTACHMENT_LIMITS, FOLLOWABLE_STATES, IdPrefix, chosenStyle, getBrief, getGoal, listCheckResultsByGoal, listChecks, listTasks, newId, renderDecisions } from '@foundry/core';
import { renderStyle } from './attempt-prompt.ts';
import { attachmentsDir } from './attachments.ts';
import type { Engine } from './engine.ts';
import { branchExists, git } from './git/git.ts';
import { fetchBase } from './git/sync.ts';
import { goalWorkspacePath } from './workspace.ts';

export class FollowUpError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

/** What the caller asks for when creating B as a follow-up of A. */
export interface FollowUpInput {
  goalId: string;
  /** default: base when A's work is already on the base branch, otherwise A's goal branch */
  startFrom?: 'base' | 'previous';
  /** copy A's attachments into B (default true) */
  attachments?: boolean;
  /** keep A's chosen style direction and its reference sample (default true) */
  style?: boolean;
}

/** Everything the New goal form (and `goal new --follows`) needs to prefill a follow-up of A. */
export interface FollowUpDraft {
  previous: { id: string; title: string; state: GoalState; repoPath: string; baseBranch: string; branch: string; branchExists: boolean };
  /** false = A is not finished; `reason` says why */
  followable: boolean;
  reason: string | null;
  prefill: { repoPath: string; baseBranch: string; nature: GoalNature; modelPreset: string | null; effort: Effort | null; pace: 'thorough' | 'fast'; mode: GoalMode; delivery: DeliveryPolicy };
  start: {
    /** where B starts unless the human picks the other one */
    recommended: 'base' | 'previous';
    /** A's changes are already on the base branch (or A's branch is gone) */
    onBase: boolean;
    detail: string;
    baseBranch: string;
    /** A's goal branch; null when it no longer exists */
    previousBranch: string | null;
  };
  attachments: Attachment[];
  style: BriefStyleOption | null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()} …(truncated)` : s);
const samePath = (a: string, b: string) => {
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return real(a) === real(b);
};

/**
 * Is A's work already on the base branch? Compares content, not ancestry, so a squash merge counts: A's branch is
 * contained when it is an ancestor of the local base (or its remote-tracking ref), or when merging it in would not
 * change the base's tree. A branch that no longer exists was cleaned up after its merge, so it counts as on base.
 */
export async function previousWorkOnBase(repoPath: string, baseBranch: string, branch: string): Promise<{ onBase: boolean; branchExists: boolean; detail: string }> {
  if (!(await branchExists(branch, repoPath).catch(() => false))) return { onBase: true, branchExists: false, detail: `its goal branch ${branch} no longer exists, so its work is taken to be on ${baseBranch}` };
  const s = await fetchBase(repoPath, baseBranch, { fetch: false });
  const refs = [s.localRef ? baseBranch : null, s.remote && s.remoteRef ? `${s.remote}/${baseBranch}` : null].filter((r): r is string => !!r);
  for (const ref of refs) {
    if ((await git(['merge-base', '--is-ancestor', branch, ref], repoPath)).code === 0) return { onBase: true, branchExists: true, detail: `its work is already on ${ref}` };
    const merged = await git(['merge-tree', '--write-tree', ref, branch], repoPath);
    const tree = (await git(['rev-parse', `${ref}^{tree}`], repoPath)).stdout.trim();
    if (merged.code === 0 && merged.stdout.split('\n')[0]?.trim() === tree) return { onBase: true, branchExists: true, detail: `its changes are already on ${ref} (merged)` };
  }
  return { onBase: false, branchExists: true, detail: `its work is not on ${baseBranch} yet` };
}

function mustFollowable(engine: Engine, goalId: string): Goal {
  const a = getGoal(engine.store.db, goalId);
  if (!a) throw new FollowUpError(`goal ${goalId} not found`, 404);
  if (!FOLLOWABLE_STATES.includes(a.state)) throw new FollowUpError(`goal "${a.title}" is ${a.state}; only a finished goal (done, over-delivered, failed or cancelled) can be followed`, 409);
  return a;
}

/** A's chosen Style Proposal, or null. */
function styleOf(engine: Engine, a: Goal): BriefStyleOption | null {
  const brief = getBrief(engine.store.db, a.id)?.brief;
  return brief ? chosenStyle(brief) : null;
}

export async function followUpDraft(engine: Engine, goalId: string): Promise<FollowUpDraft> {
  const a = getGoal(engine.store.db, goalId);
  if (!a) throw new FollowUpError(`goal ${goalId} not found`, 404);
  const followable = FOLLOWABLE_STATES.includes(a.state);
  const w = await previousWorkOnBase(a.repoPath, a.baseBranch, a.branch).catch(() => ({ onBase: true, branchExists: false, detail: 'the repository could not be read' }));
  return {
    previous: { id: a.id, title: a.title, state: a.state, repoPath: a.repoPath, baseBranch: a.baseBranch, branch: a.branch, branchExists: w.branchExists },
    followable,
    reason: followable ? null : `the goal is ${a.state}; it can be followed once it is finished`,
    prefill: { repoPath: a.repoPath, baseBranch: a.baseBranch, nature: a.nature, modelPreset: a.modelPreset, effort: a.effort, pace: a.workflow.pace, mode: a.mode, delivery: a.delivery.policy },
    start: { recommended: w.onBase ? 'base' : 'previous', onBase: w.onBase, detail: w.detail, baseBranch: a.baseBranch, previousBranch: w.branchExists ? a.branch : null },
    attachments: a.attachments,
    style: styleOf(engine, a),
  };
}

/**
 * The "# Previous goal" section: what A asked, what was understood and decided, how its tasks and its review
 * ended. Bounded — long text is cut — because every Clarify session of B carries it.
 */
export function renderPreviousGoal(engine: Engine, a: Goal, style: BriefStyleOption | null): string {
  const db = engine.store.db;
  const parts: string[] = [`# Previous goal\nThis goal is a Follow-up of an earlier goal on this repository: "${a.title}", which ended ${a.state.replace('_', '-')}. Build on what it did; do not redo it, and do not undo it unless this goal asks for that.`];
  parts.push(`## What the human asked for then\n${clip(a.prompt.trim(), 2000)}`);
  const b = getBrief(db, a.id);
  if (b?.approved) {
    parts.push(`## What was understood (approved Brief)\n${clip(b.brief.understanding.trim(), 1500)}`);
    const decisions = renderDecisions(b.brief, '## Decisions the human made then');
    if (decisions) parts.push(`${clip(decisions, 2000)}\nThey still hold unless the new goal says otherwise.`);
  } else parts.push('## Brief\nThe previous goal ended before its Brief was approved.');
  const tasks = listTasks(db, a.id).filter((t) => t.origin !== 'merge');
  if (tasks.length) {
    const lines = tasks.slice(0, 40).map((t) => `- [${t.state}] ${clip(t.title, 120)}`);
    if (tasks.length > 40) lines.push(`- … and ${tasks.length - 40} more`);
    parts.push(`## Its tasks and how they ended\n${lines.join('\n')}`);
  }
  const review = [...engine.store.listByGoal(a.id, 5000)].reverse().find((e) => e.type === 'review.goal.finished')?.payload as { passed: boolean; overDelivered: boolean; notes: string } | undefined;
  if (review) parts.push(`## Final goal review\n${review.overDelivered ? 'Passed, over-delivered.' : review.passed ? 'Passed.' : 'Did not pass.'}${review.notes?.trim() ? `\n${clip(review.notes.trim(), 800)}` : ''}`);
  const results = listCheckResultsByGoal(db, a.id);
  const latest = new Map(results.map((r) => [r.checkId, r.status]));
  const unmet = listChecks(db, a.id).filter((c) => c.tier === 'stretch' && latest.get(c.id) !== 'pass');
  if (unmet.length) parts.push(`## Stretch checks it did not meet\n${unmet.slice(0, 15).map((c) => `- ${clip(c.name, 160)}`).join('\n')}`);
  if (style) parts.push(`## Style direction to keep\n${renderStyle({ ...style, chosenSample: null })}\nThe human chose to keep this direction. If this goal produces anything with a look, output it unchanged as your FIRST styleOption (same name); alternatives may follow it.`);
  return clip(parts.join('\n\n'), 9000);
}

/** Copy A's attachments (files with their markdown renditions, links with their snapshots) into B's directory, under new ids. */
function copyAttachments(dataDir: string, from: Goal, toGoalId: string, max: number): Attachment[] {
  const out: Attachment[] = [];
  for (const a of from.attachments) {
    if (out.length >= max) break;
    const id = newId(IdPrefix.attachment);
    const src = join(attachmentsDir(dataDir, from.id), a.id);
    const dest = join(attachmentsDir(dataDir, toGoalId), id);
    const rehome = (p: string | null) => (p && resolve(dataDir, p).startsWith(src + '/') ? relative(dataDir, join(dest, basename(p))) : p);
    if (existsSync(src)) {
      mkdirSync(attachmentsDir(dataDir, toGoalId), { recursive: true });
      cpSync(src, dest, { recursive: true });
    } else if (a.kind === 'file') continue; // the file is gone (trashed): nothing to copy
    out.push({ ...a, id, path: a.kind === 'file' ? rehome(a.path) : null, markdown: a.markdown ? { ...a.markdown, path: rehome(a.markdown.path) } : null, addedAt: new Date().toISOString() });
  }
  return out;
}

/** A's reference sample for its chosen style (the pinned one, else the newest), as an image Attachment of B. */
function styleSampleAttachment(dataDir: string, from: Goal, style: BriefStyleOption, toGoalId: string): Attachment | null {
  const sample = style.chosenSample ?? style.samples.at(-1);
  if (!sample) return null;
  const abs = join(goalWorkspacePath(dataDir, from), sample);
  if (!existsSync(abs)) return null;
  const id = newId(IdPrefix.attachment);
  const name = `style-${style.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sample'}${sample.endsWith('.png') ? '.png' : ''}`;
  const dest = join(attachmentsDir(dataDir, toGoalId), id, name);
  mkdirSync(join(attachmentsDir(dataDir, toGoalId), id), { recursive: true });
  cpSync(abs, dest);
  return { id, kind: 'file', name, mime: 'image/png', size: Bun.file(dest).size, path: relative(dataDir, dest), url: null, note: `Reference image of the style direction "${style.name}", kept from the previous goal "${from.title}"`, addedAt: new Date().toISOString(), markdown: null };
}

/**
 * Validate and snapshot a follow-up at creation: A must exist, be finished and belong to the same repository.
 * Returns B's `follows`, the attachments copied from A, and A's base branch (B delivers to it too).
 */
export async function prepareFollowUp(engine: Engine, input: FollowUpInput, repoPath: string, toGoalId: string, ownAttachments: number): Promise<{ follows: GoalFollows; attachments: Attachment[]; baseBranch: string }> {
  const a = mustFollowable(engine, input.goalId);
  if (!samePath(a.repoPath, repoPath)) throw new FollowUpError(`goal "${a.title}" belongs to ${a.repoPath}; a follow-up must use the same repository`);
  const w = await previousWorkOnBase(a.repoPath, a.baseBranch, a.branch);
  const startFrom = input.startFrom ?? (w.onBase ? 'base' : 'previous');
  if (startFrom === 'previous' && !w.branchExists) throw new FollowUpError(`the goal branch ${a.branch} no longer exists; start from ${a.baseBranch} instead`);
  const style = input.style === false ? null : styleOf(engine, a);
  const room = Math.max(0, ATTACHMENT_LIMITS.maxPerGoal - ownAttachments);
  const attachments = input.attachments === false ? [] : copyAttachments(engine.config.dataDir, a, toGoalId, room);
  const sample = style && attachments.length < room ? styleSampleAttachment(engine.config.dataDir, a, style, toGoalId) : null;
  if (sample) attachments.push(sample);
  const follows: GoalFollows = {
    goalId: a.id,
    title: a.title,
    via: 'created',
    startFrom,
    branch: w.branchExists ? a.branch : null,
    context: renderPreviousGoal(engine, a, style),
    style: style ? { ...style, samples: [], chosenSample: null } : null,
    at: new Date().toISOString(),
  };
  return { follows, attachments, baseBranch: a.baseBranch };
}

/** The sentence Clarify gets about where B's checkout starts (from the recorded Base Sync). */
export function startSentence(goal: Goal): string {
  const f = goal.follows;
  if (!f || f.via !== 'created') return '';
  return goal.baseSync?.startedFrom === 'previous'
    ? `This checkout starts from the previous goal's branch ${f.branch}: its changes are already here, although they are not on ${goal.baseBranch} yet.`
    : `The previous goal's work is on ${goal.baseBranch} already (or was left out on purpose); this checkout starts from ${goal.baseBranch}.`;
}

/**
 * "Mark as follow-up of…": record that B follows an earlier goal of the same repository. Relationship only — no
 * context, code or branch changes. B must not follow anything yet, and the link may not create a cycle.
 */
export function linkFollowUp(engine: Engine, goalId: string, previousId: string): Goal {
  const db = engine.store.db;
  const b = getGoal(db, goalId);
  if (!b) throw new FollowUpError(`goal ${goalId} not found`, 404);
  const a = getGoal(db, previousId);
  if (!a) throw new FollowUpError(`goal ${previousId} not found`, 404);
  if (a.id === b.id) throw new FollowUpError('a goal cannot follow itself');
  if (b.follows) throw new FollowUpError(`this goal already follows "${b.follows.title}"`, 409);
  if (!samePath(a.repoPath, b.repoPath)) throw new FollowUpError(`goal "${a.title}" belongs to another repository`);
  if (a.createdAt >= b.createdAt) throw new FollowUpError(`goal "${a.title}" is not older than this one; a goal can only follow an earlier goal`);
  // walk A's chain: reaching B would make a cycle
  const seen = new Set<string>();
  for (let cur: Goal | null = a; cur?.follows && !seen.has(cur.id); cur = getGoal(db, cur.follows.goalId)) {
    seen.add(cur.id);
    if (cur.follows.goalId === b.id) throw new FollowUpError(`"${a.title}" already follows this goal (directly or through others); the link would make a cycle`);
  }
  engine.store.append({ type: 'goal.follow_up_linked', goalId: b.id, payload: { follows: { goalId: a.id, title: a.title } } });
  return getGoal(db, b.id)!;
}
