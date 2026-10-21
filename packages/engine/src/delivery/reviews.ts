/**
 * Review comments on a pull request Foundry opened (ADR-0053): which ones count, how a round of them becomes a fix
 * task's spec, what Foundry writes back under each, and how a look at the pull request turns new ones into a round
 * and a run of the delivery. Foundry's own replies carry a hidden mark, so a later look never takes them for the
 * person's.
 */
import type { Goal, ReviewComment, ReviewRound } from '@foundry/core';
import { IdPrefix, getGoal, newId } from '@foundry/core';
import type { Engine } from '../engine.ts';
import type { PrReview, PrReviewComment } from './gh.ts';

/** at the end of every reply Foundry posts; invisible on GitHub, plain in the API */
export const REPLY_MARK = '<!-- foundry:review-reply -->';

const key = (c: Pick<ReviewComment, 'kind' | 'id'>) => `${c.kind}:${c.id}`;
/** the comments every round of the delivery already holds */
export const seenKeys = (rounds: ReviewRound[]): Set<string> => new Set(rounds.flatMap((r) => r.comments.map(key)));

/**
 * The comments a look at the pull request brought that are not in a round yet: inline comments on the diff, and the
 * body of a review that requested changes. Not Foundry's own replies, not a bot's, not an empty body, not an approval
 * or a plain remark (a review that only comments asks for nothing).
 */
export function newReviewComments(found: { comments: PrReviewComment[]; reviews: PrReview[] }, seen: Set<string>): ReviewComment[] {
  const out: ReviewComment[] = [];
  for (const c of found.comments) {
    const item: ReviewComment = { id: c.id, kind: 'inline', author: c.author, body: c.body, path: c.path, line: c.line, diffHunk: c.diffHunk, url: c.url, createdAt: c.createdAt };
    if (seen.has(key(item)) || c.bot || !c.body.trim() || c.body.includes(REPLY_MARK)) continue;
    out.push(item);
  }
  for (const r of found.reviews) {
    const item: ReviewComment = { id: r.id, kind: 'review', author: r.author, body: r.body, path: null, line: null, diffHunk: null, url: r.url, createdAt: r.submittedAt };
    if (seen.has(key(item)) || r.bot || r.state.toUpperCase() !== 'CHANGES_REQUESTED' || !r.body.trim() || r.body.includes(REPLY_MARK)) continue;
    out.push(item);
  }
  return out.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()} …` : s);
const quote = (s: string) => s.trim().split('\n').map((l) => `> ${l}`).join('\n');

/** The fix task's spec: every comment with where it is, the diff around it, and who wrote it. */
export function renderReviewSpec(prNumber: number, round: ReviewRound): string {
  const items = round.comments.map((c, i) => {
    const who = c.author ? `@${c.author}` : 'a reviewer';
    const head = c.kind === 'inline' ? `### ${i + 1}. ${c.path ?? 'the diff'}${c.line != null ? `:${c.line}` : ''} — ${who}` : `### ${i + 1}. Review by ${who} (changes requested)`;
    const hunk = c.diffHunk ? `\n\`\`\`diff\n${clip(c.diffHunk, 2000)}\n\`\`\`` : '';
    return `${head}\n${quote(clip(c.body, 4000))}${hunk}${c.url ? `\n${c.url}` : ''}`;
  });
  return [
    `A person reviewed pull request #${prNumber} for this goal and asked for changes. Address every comment below: make the change it asks for, in the smallest way that fully answers it. When a comment is mistaken, or asks for something that would break an acceptance check, leave the code as it is and say why in your report. Never weaken or delete a check. Do not touch anything the comments do not ask about.`,
    `## Comments (${round.comments.length})`,
    ...items,
  ].join('\n\n');
}

/** What Foundry writes under a comment once the round is done. */
export function replyText(status: 'addressed' | 'nochange', i: { commit: string | null; header: string | null; files: string[] }): string {
  if (status === 'addressed') {
    const files = i.files.length ? ` Changed: ${i.files.slice(0, 8).map((f) => `\`${f}\``).join(', ')}${i.files.length > 8 ? ` and ${i.files.length - 8} more` : ''}.` : '';
    return `Addressed in ${i.commit ? `\`${i.commit.slice(0, 7)}\`` : 'the commit just pushed'}${i.header ? ` (${i.header})` : ''}.${files}\n\n${REPLY_MARK}`;
  }
  return `Looked at this and left the code as it is; the review-fix task's report on the goal page says why.\n\n${REPLY_MARK}`;
}

/** a pull request comment answering a review that requested changes: the review's words, then the reply */
export const reviewReply = (review: ReviewComment, text: string) => `${quote(clip(review.body, 300))}\n\n${text}`;

/** the rounds of a pull request not addressed yet */
export const pendingRounds = (goal: Goal, prNumber: number): ReviewRound[] => goal.delivery.reviews.filter((r) => r.prNumber === prNumber && r.status === 'pending');
/** may the engine address this round by itself: asked for by the person, or within the policy's budget */
export const roundAllowed = (goal: Goal, round: ReviewRound): boolean => round.requested || goal.delivery.reviewCycles < goal.delivery.policy.fixReviewCycles;

/**
 * One look at an open pull request for review comments. New ones become a round; when the budget allows and no
 * delivery runs, a run of the delivery starts to address it (its `fix-review` step), otherwise the person is told the
 * round waits. Returns the new round, or null when there is nothing new (or gh could not be asked).
 */
export async function collectReviews(engine: Engine, goal: Goal, repo: string, number: number): Promise<ReviewRound | null> {
  if (goal.delivery.policy.mode !== 'pr' && goal.delivery.policy.mode !== 'pr-automerge') return null;
  const cwd = goal.repoPath;
  const [comments, reviews] = await Promise.all([engine.gh.prReviewComments(cwd, { repo, number }).catch(() => null), engine.gh.prReviews(cwd, { repo, number }).catch(() => null)]);
  if (!comments || !reviews) return null;
  const fresh = getGoal(engine.store.db, goal.id)!;
  const found = newReviewComments({ comments, reviews }, seenKeys(fresh.delivery.reviews));
  if (!found.length) return null;
  const round: ReviewRound = { id: newId(IdPrefix.review), prNumber: number, at: new Date().toISOString(), comments: found, status: 'pending', requested: false, commit: null, replied: 0, detail: null, finishedAt: null };
  const allowed = roundAllowed(fresh, round);
  engine.store.append({ type: 'delivery.review_received', goalId: goal.id, payload: { round, action: allowed ? 'fixing' : 'waiting' } });
  const n = `${found.length} review comment${found.length === 1 ? '' : 's'} on PR #${number}`;
  if (!allowed) {
    engine.store.append({ type: 'delivery.note', goalId: goal.id, payload: { message: `${n} wait for you: Foundry addressed ${fresh.delivery.reviewCycles} round(s) by itself and the policy allows ${fresh.delivery.policy.fixReviewCycles}. Press Fix review comments on the Delivery tab, or answer on GitHub.` } });
    return round;
  }
  await startReviewRun(engine, goal.id, n);
  return round;
}

/** start a run of the delivery for review comments, unless one is already running or about to */
export async function startReviewRun(engine: Engine, goalId: string, what: string): Promise<void> {
  const d = getGoal(engine.store.db, goalId)!.delivery;
  if (d.status === 'running' || d.status === 'idle') return;
  try {
    await engine.deliver(goalId, {}, 'review');
    engine.store.append({ type: 'delivery.note', goalId, payload: { message: `${what}: Foundry addresses them in a fix task and replies under each` } });
  } catch (err) {
    engine.store.append({ type: 'delivery.note', goalId, payload: { message: `${what}, but the delivery could not be run again: ${String((err as Error).message ?? err)}` } });
  }
}
