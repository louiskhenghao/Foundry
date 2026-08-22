import type { Brief, BriefArea, BriefCheck, BriefTask } from '../schema/brief.ts';

/**
 * A Decision is a choice the human made on the Brief that every session must honour:
 * the answer to a Question, or an Assumption the human rejected.
 */
export interface Decision {
  id: string;
  kind: 'answer' | 'rejected-assumption';
  text: string;
  answer: string | null;
  applied: boolean;
}

export function decisionsOf(brief: Pick<Brief, 'questions' | 'assumptions'>): Decision[] {
  return [
    ...brief.questions.filter((q) => q.answer?.trim()).map((q) => ({ id: q.id, kind: 'answer' as const, text: q.text, answer: q.answer!.trim(), applied: q.applied })),
    ...brief.assumptions.filter((a) => !a.accepted).map((a) => ({ id: a.id, kind: 'rejected-assumption' as const, text: a.text, answer: null, applied: a.applied })),
  ];
}

/** Decisions no Revise has honoured yet. */
export function pendingDecisions(brief: Pick<Brief, 'questions' | 'assumptions'>): Decision[] {
  return decisionsOf(brief).filter((d) => !d.applied);
}

/** The prompt section every session receives; '' when there is nothing to say. */
export function renderDecisions(brief: Pick<Brief, 'questions' | 'assumptions'>, heading = '# Decisions from the human'): string {
  const ds = decisionsOf(brief);
  if (!ds.length) return '';
  const lines = ds.map((d) => (d.kind === 'answer' ? `- Q: ${d.text}\n  A: ${d.answer}` : `- Rejected assumption (do NOT proceed on it): ${d.text}`));
  return `${heading}\nThese override anything else in the Brief or the task specs.\n${lines.join('\n')}`;
}

/** Mark every current Decision as honoured. */
export function markDecisionsApplied<B extends Pick<Brief, 'questions' | 'assumptions'>>(brief: B): B {
  return { ...brief, questions: brief.questions.map((q) => (q.answer?.trim() ? { ...q, applied: true } : q)), assumptions: brief.assumptions.map((a) => (a.accepted ? a : { ...a, applied: true })) };
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}
export interface KeyedDiff<T> {
  added: T[];
  removed: T[];
  changed: { key: string; before: T; after: T; fields: FieldChange[] }[];
}
export interface BriefDiff {
  tasks: KeyedDiff<BriefTask>;
  checks: KeyedDiff<BriefCheck>;
  areas: KeyedDiff<BriefArea>;
  understanding: { before: string; after: string } | null;
  title: { before: string; after: string } | null;
  /** assumptions present in the revision but not in the current Brief (by text) */
  newAssumptions: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function keyed<T extends { key: string }>(before: T[], after: T[], fields: (keyof T & string)[]): KeyedDiff<T> {
  const b = new Map(before.map((x) => [x.key, x]));
  const a = new Map(after.map((x) => [x.key, x]));
  const added = after.filter((x) => !b.has(x.key));
  const removed = before.filter((x) => !a.has(x.key));
  const changed: KeyedDiff<T>['changed'] = [];
  for (const x of after) {
    const prev = b.get(x.key);
    if (!prev) continue;
    const diffs = fields.filter((f) => !same(prev[f], x[f])).map((f) => ({ field: f, before: prev[f], after: x[f] }));
    if (diffs.length) changed.push({ key: x.key, before: prev, after: x, fields: diffs });
  }
  return { added, removed, changed };
}

/** What a revision would change, by key. Keys are the contract: a task that keeps its key is "changed", not removed+added. */
export function diffBrief(current: Omit<Brief, 'goalId'>, revised: Omit<Brief, 'goalId'>): BriefDiff {
  return {
    tasks: keyed(current.tasks, revised.tasks, ['title', 'spec', 'kind', 'scope', 'scenario', 'areaKey', 'dependsOnKeys', 'parallelizable', 'relevantFiles']),
    checks: keyed(current.checks, revised.checks, ['name', 'tier', 'taskKey', 'areaKey', 'spec']),
    areas: keyed(current.areas, revised.areas, ['name', 'slug', 'description']),
    understanding: current.understanding.trim() !== revised.understanding.trim() ? { before: current.understanding, after: revised.understanding } : null,
    title: (current.title ?? '') !== (revised.title ?? '') ? { before: current.title ?? '', after: revised.title ?? '' } : null,
    newAssumptions: revised.assumptions.filter((a) => !current.assumptions.some((c) => c.text.trim() === a.text.trim())).map((a) => a.text),
  };
}

export function diffIsEmpty(d: BriefDiff): boolean {
  const k = (x: KeyedDiff<unknown>) => x.added.length + x.removed.length + x.changed.length;
  return k(d.tasks) + k(d.checks) + k(d.areas) === 0 && !d.understanding && !d.title && d.newAssumptions.length === 0;
}
