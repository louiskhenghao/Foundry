/**
 * What Foundry writes into a folder's bank (ADR-0071), one document each: the record of a goal that ended, the Learnings
 * notebook as it stands, a revision of a Brief, a task review's verdict, a replan's reason, and an attempt's transcript
 * in compact form. Each carries a stable id, so the same thing written twice is one document, and tags that say where it
 * came from, so the bank's readers can tell Foundry's records from the person's own sessions.
 */
import type { Attempt, Brief, Goal, Learning, ReviewerVerdict, Task } from '@foundry/core';
import { diffBrief, diffIsEmpty } from '@foundry/core';
import type { MemoryDocument } from './types.ts';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const tags = (goal: Pick<Goal, 'id'>, ...more: string[]) => ['source:foundry', `goal:${goal.id}`, ...more];

/** how the goal went (learnings.ts goalRecord), as the bank keeps it */
export function goalRecordDocument(goal: Goal, record: string): MemoryDocument {
  return {
    content: record,
    context: `the record of the Foundry goal "${goal.title}" in this repository: how it ended, what was understood and decided, its tasks and the attempts that failed, where it stopped for the person, its final review`,
    documentId: `goal:${goal.id}:record`,
    tags: tags(goal, 'stage:goal', `outcome:${goal.state}`),
    metadata: { goalId: goal.id, outcome: goal.state },
  };
}

/** the folder's notebook, whole: written again in place of the last one every time it changes */
export function learningsDocument(learnings: Learning[]): MemoryDocument {
  const lines = learnings.map((l) => `- [${l.kind}] ${l.text}${l.by === 'human' ? ' (the person wrote this)' : l.goalTitle ? ` (learned by the goal "${l.goalTitle}")` : ''}`);
  return {
    content: `The Learnings notebook of this repository — ${learnings.length} curated entr${learnings.length === 1 ? 'y' : 'ies'} on what its goals and the person found true about it, the person's entries outranking the rest:\n${lines.join('\n')}`,
    context: 'the curated Learnings notebook of this repository as the person and Foundry keep it now; it replaces the notebook written before',
    documentId: 'learnings:notebook',
    tags: ['source:learnings'],
    updateMode: 'replace',
  };
}

/** a revision of the Brief before approval: where the first understanding or plan was off; null when nothing changed */
export function briefRevisionDocument(goal: Goal, before: Brief, after: Brief, n: number): MemoryDocument | null {
  const d = diffBrief(before, after);
  if (diffIsEmpty(d)) return null;
  const lines: string[] = [];
  if (d.title) lines.push(`- title: "${d.title.before}" → "${d.title.after}"`);
  if (d.understanding) lines.push(`- understanding before:\n${clip(d.understanding.before.trim(), 1_200)}\n- understanding after:\n${clip(d.understanding.after.trim(), 1_200)}`);
  for (const a of d.areas.added) lines.push(`- area added: ${a.name}`);
  for (const a of d.areas.removed) lines.push(`- area removed: ${a.name}`);
  for (const c of d.areas.changed) lines.push(`- area changed: ${c.after.name} (${c.fields.map((f) => f.field).join(', ')})`);
  for (const t of d.tasks.added) lines.push(`- task added: ${t.title}\n  ${clip(t.spec.trim().replace(/\s+/g, ' '), 400)}`);
  for (const t of d.tasks.removed) lines.push(`- task removed: ${t.title}`);
  for (const c of d.tasks.changed) lines.push(`- task changed: ${c.after.title} (${c.fields.map((f) => f.field).join(', ')})${c.fields.some((f) => f.field === 'spec') ? `\n  now: ${clip(c.after.spec.trim().replace(/\s+/g, ' '), 400)}` : ''}`);
  for (const c of d.checks.added) lines.push(`- check added: [${c.tier}] ${c.name}`);
  for (const c of d.checks.removed) lines.push(`- check removed: [${c.tier}] ${c.name}`);
  for (const c of d.checks.changed) lines.push(`- check changed: ${c.after.name} (${c.fields.map((f) => f.field).join(', ')})`);
  for (const a of d.newAssumptions) lines.push(`- assumption added: ${clip(a, 300)}`);
  return {
    content: `The Brief of the goal "${goal.title}" was revised by the person before approval (revision ${n}). What changed:\n${lines.join('\n')}`,
    context: "a revision of a Foundry goal's Brief before the person approved it: where Foundry's first understanding or plan of the goal was off",
    documentId: `goal:${goal.id}:brief:${n}`,
    tags: tags(goal, 'stage:brief'),
  };
}

/** what a reviewer that did not write the Brief proposed to change (the person may or may not have applied it) */
export function secondOpinionDocument(goal: Goal, changeSummary: string, auto: boolean, at: string): MemoryDocument {
  return {
    content: `A second opinion on the Brief of the goal "${goal.title}"${auto ? ' (asked for by Settings)' : ' (asked for by the person)'} proposed: ${clip(changeSummary.trim(), 2_000)}`,
    context: "a second opinion on a Foundry goal's Brief: what a reviewer that did not write it found worth changing before the work started",
    documentId: `goal:${goal.id}:second-opinion:${at}`,
    tags: tags(goal, 'stage:brief'),
  };
}

/** a task review's verdict: what was refused, and why */
export function reviewDocument(goal: Goal, task: Task, attempt: Pick<Attempt, 'id' | 'index'>, verdict: ReviewerVerdict): MemoryDocument {
  const lines = [`Review of attempt ${attempt.index} of the task "${task.title}" (goal "${goal.title}"): ${verdict.pass ? 'passed, no blockers.' : 'refused.'}`];
  if (verdict.blockers.length) lines.push('Blockers:', ...verdict.blockers.map((b) => `- ${clip(b.trim(), 600)}`));
  if (verdict.notes?.trim()) lines.push(`Notes: ${clip(verdict.notes.trim(), 1_000)}`);
  if (task.relevantFiles.length) lines.push(`Files the task was about: ${task.relevantFiles.slice(0, 12).join(', ')}`);
  return {
    content: lines.join('\n'),
    context: "a task review in a Foundry goal: what the reviewer refused or required of the attempt's change in this repository",
    documentId: `goal:${goal.id}:review:${attempt.id}`,
    tags: tags(goal, 'stage:review', `task:${task.id}`, verdict.pass ? 'verdict:pass' : 'verdict:fail'),
  };
}

/** a task touched up by the planner after a step landed, and why */
export function replanDocument(goal: Goal, task: Task, reason: string, spec: string, landed: string | null, at: string): MemoryDocument {
  return {
    content: `Replan in the goal "${goal.title}"${landed ? ` after "${landed}" landed` : ''}: the task "${task.title}" was touched up because ${clip(reason.trim(), 600)}.\nIts spec now:\n${clip(spec.trim(), 1_200)}`,
    context: 'a replan in a Foundry goal: what a landed step changed for the tasks after it, and why the plan had to move',
    documentId: `goal:${goal.id}:replan:${task.id}:${at}`,
    tags: tags(goal, 'stage:plan', `task:${task.id}`),
  };
}

/** the person's own bank: tagged as theirs, and with the repository the goal was in */
const personTags = (goal: Pick<Goal, 'id'> | null, bank: string | null) => ['source:person', ...(goal ? [`goal:${goal.id}`] : []), ...(bank ? [`repo:${bank}`] : [])];

/** the person's everywhere notebook (ADR-0055), whole, in place of the one before */
export function personNotebookDocument(learnings: Learning[]): MemoryDocument {
  return {
    content: `What this person wants in every project, in their own words — ${learnings.length} entr${learnings.length === 1 ? 'y' : 'ies'}:\n${learnings.map((l) => `- [${l.kind}] ${l.text}`).join('\n')}`,
    context: "the person's own notebook for every project, as they keep it now; it replaces the notebook written before",
    documentId: 'person:notebook',
    tags: ['source:person', 'source:learnings'],
    updateMode: 'replace',
  };
}

/** what the person decided for a goal when its Brief was approved: the questions they answered, the assumptions they took */
export function decisionsDocument(goal: Goal, bank: string | null, rendered: string): MemoryDocument {
  return {
    content: `For the goal "${goal.title}"${bank ? ` in the repository ${bank.replace(/^coding-agent::/, '')}` : ''}, the person decided:\n${clip(rendered.replace(/^# [^\n]*\n/, '').trim(), 3_000)}`,
    context: 'the decisions a person made for one Foundry goal when they approved its Brief: their answers to its questions and the assumptions they accepted',
    documentId: `person:decisions:${goal.id}`,
    tags: personTags(goal, bank),
  };
}

/** what the person said when a goal stopped for them */
export function answerDocument(goal: Goal, bank: string | null, esc: { id: string; trigger: string; message: string }, answer: { action: string; hint?: string; feedback?: string }): MemoryDocument {
  const said = [answer.hint, answer.feedback].filter((s): s is string => !!s?.trim()).map((s) => clip(s.trim(), 1_000));
  return {
    content: `The goal "${goal.title}"${bank ? ` (repository ${bank.replace(/^coding-agent::/, '')})` : ''} stopped for the person (${esc.trigger.replace(/_/g, ' ')}: ${clip((esc.message.split('\n')[0] ?? '').trim(), 300)}). They answered "${answer.action}" and said:\n${said.join('\n')}`,
    context: "what a person said when a Foundry goal stopped and asked them: how they want such a situation handled",
    documentId: `person:answer:${esc.id}`,
    tags: personTags(goal, bank),
  };
}

/** what the person said at a milestone */
export function feedbackDocument(goal: Goal, bank: string | null, taskTitle: string | null, feedback: string, at: string): MemoryDocument {
  return {
    content: `At the milestone${taskTitle ? ` "${taskTitle}"` : ''} of the goal "${goal.title}"${bank ? ` (repository ${bank.replace(/^coding-agent::/, '')})` : ''}, the person looked and said:\n${clip(feedback.trim(), 2_000)}`,
    context: 'what a person said when they looked at a milestone of a Foundry goal: what they liked, what they wanted changed',
    documentId: `person:feedback:${goal.id}:${at}`,
    tags: personTags(goal, bank),
  };
}

/** an attempt's transcript in compact turns, with how it ended */
export function transcriptDocument(goal: Goal, task: Task | null, attempt: Pick<Attempt, 'id' | 'index'>, outcome: { state: string; reason: string }, compacted: string): MemoryDocument {
  return {
    content: compacted,
    context: `the transcript of attempt ${attempt.index}${task ? ` for the task "${task.title}"` : ''} of the goal "${goal.title}" in this repository, as compact turns ({role, content}: the task, the agent's words, one action line per tool call, what failed calls said); it ended ${outcome.state}${outcome.reason ? ` (${clip(outcome.reason, 200)})` : ''}`,
    documentId: `goal:${goal.id}:attempt:${attempt.id}`,
    tags: ['source:transcript', `goal:${goal.id}`, ...(task ? [`task:${task.id}`] : []), `attempt:${attempt.id}`, `outcome:${outcome.state}`],
  };
}
