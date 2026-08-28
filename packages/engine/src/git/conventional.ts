import type { Goal, Task, TaskKind } from '@foundry/core';

/**
 * Conventional Commits (commitizen) helpers. Every commit the engine makes — attempt snapshots, the
 * squashed task commit, sync merges, the initial commit of a fresh repo — goes through here.
 */
export type CcType = 'feat' | 'fix' | 'refactor' | 'chore' | 'docs' | 'test' | 'ci' | 'build' | 'perf' | 'style' | 'revert';
const TYPES: CcType[] = ['feat', 'fix', 'refactor', 'chore', 'docs', 'test', 'ci', 'build', 'perf', 'style', 'revert'];

export const HEADER_MAX = 72;

export const typeForKind = (kind: TaskKind): CcType => ({ feature: 'feat', bug: 'fix', refactor: 'refactor', research: 'docs', chore: 'chore' })[kind] as CcType;

const HEADER_RE = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s+(.+)$/;

/** `type(scope): subject` shaped? (any lowercase type; the spec leaves the list open) */
export function isConventional(header: string): boolean {
  const m = header.trim().match(HEADER_RE);
  return !!m && m[4]!.trim().length > 0;
}

/** Split a header the model may have written with its own prefix. */
export function parseHeader(header: string): { type: string | null; scope: string | null; breaking: boolean; subject: string } {
  const m = header.trim().match(HEADER_RE);
  if (!m) return { type: null, scope: null, breaking: false, subject: header.trim() };
  return { type: m[1]!, scope: m[2]?.trim() || null, breaking: !!m[3], subject: m[4]!.trim() };
}

function cleanSubject(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim();
  t = t.replace(/[.。]+$/, '').trim();
  return t;
}

function cleanScope(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_./\-一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return t || null;
}

/**
 * Build a header ≤ 72 chars. A subject that already carries a conventional prefix keeps its own
 * type/scope only when it is a known type; otherwise the prefix is stripped and ours is used.
 */
export function ccHeader(i: { type: CcType; scope?: string | null; subject: string; breaking?: boolean }): string {
  const parsed = parseHeader(i.subject);
  const known = parsed.type && (TYPES as string[]).includes(parsed.type);
  const type = known ? (parsed.type as CcType) : i.type;
  const scope = cleanScope(known && parsed.scope ? parsed.scope : i.scope);
  const breaking = i.breaking || parsed.breaking;
  const prefix = `${type}${scope ? `(${scope})` : ''}${breaking ? '!' : ''}: `;
  let subject = cleanSubject(parsed.subject) || 'update';
  const room = HEADER_MAX - prefix.length;
  if (subject.length > room) {
    const cut = subject.slice(0, Math.max(1, room - 1));
    const atWord = cut.lastIndexOf(' ');
    subject = (atWord > room / 2 ? cut.slice(0, atWord) : cut).trim() + '…';
  }
  return prefix + subject;
}

/** The message for a task's commits: attempt snapshots (`attempt` given) and the final squash (no `attempt`). */
export function taskCommitMessage(goal: Pick<Goal, 'id'>, task: Pick<Task, 'id' | 'title' | 'kind' | 'scope'>, o: { attempt?: number } = {}): string {
  const header = ccHeader({ type: typeForKind(task.kind), scope: task.scope, subject: task.title });
  const body = [`Task: ${task.id}`, `Goal: ${goal.id}`];
  if (o.attempt != null) body.push(`Attempt: ${o.attempt} (intermediate snapshot; squashed when the task completes)`);
  return `${header}\n\n${body.join('\n')}`;
}

/** Header for the whole goal: the Brief's title when the clarifier gave one, else derived from the tasks + goal title. */
export function goalHeader(goal: Pick<Goal, 'title'>, briefTitle: string | null | undefined, tasks: Pick<Task, 'kind'>[]): string {
  const t = briefTitle?.trim();
  if (t && isConventional(t)) return ccHeader({ type: typeForKind('feature'), subject: t });
  const counts = new Map<CcType, number>();
  for (const task of tasks) counts.set(typeForKind(task.kind), (counts.get(typeForKind(task.kind)) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'feat';
  return ccHeader({ type: dominant, subject: t || goal.title });
}

/** First line of a commit message. */
export const headerOf = (message: string) => message.split('\n')[0]!.trim();

/** kebab-case slug for branch names, ≤ `max` chars, ASCII only (non-ASCII titles fall back to `part`). */
export function branchSlug(title: string, max = 30): string {
  const { subject } = parseHeader(headerOf(title));
  const s = subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return s || 'part';
}
