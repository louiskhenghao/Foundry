/**
 * Foundry's records of a goal, written for the Explainer (ADR-0073) as files it reads and greps like code: the goal and
 * its Brief, every task with its attempts and their reports, the timeline, the escalations, the review, the delivery,
 * the attachments, the Learnings, and the sessions' transcripts in short. Rewritten before every answer, so they say
 * what the goal is now; a transcript is rendered again only once its session wrote more.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBrief, getObservation, listAttemptsByGoal, listCheckResultsByGoal, listChecks, listEscalations, listTasks, renderDecisions, reportsDollars, type Attempt, type Check, type ConversationMessage, type EngineEvent, type Goal, type Task } from '@foundry/core';
import { attachmentAbsPath, markdownAbsPath, markdownFileName, renderAttachments } from '../attachments.ts';
import { briefSummary } from '../brief-draft.ts';
import type { Engine } from '../engine.ts';
import { learningsContext } from '../learnings.ts';
import { compactTranscript, type CompactTurn } from '../memory/compact.ts';
import { RECORDS_DIR } from './workspace.ts';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const firstLine = (s: string | null | undefined) => (s ?? '').trim().split('\n')[0] ?? '';
const when = (iso: string) => iso.replace('T', ' ').slice(0, 16);
const usd = (goal: Pick<Goal, 'provider'>, n: number) => (reportsDollars(goal.provider) ? `$${n.toFixed(2)}` : 'cost unavailable');
const ENDED = new Set(['done', 'over_delivered', 'failed', 'cancelled']);

/** the goal in a page, as the prompt and `goal.md` say it: what it is, where it stands, what was asked and decided */
export function goalSummary(engine: Engine, goal: Goal): string {
  const db = engine.store.db;
  const brief = getBrief(db, goal.id)?.brief;
  const tasks = listTasks(db, goal.id);
  const attempts = listAttemptsByGoal(db, goal.id);
  const last = engine.store.listByGoalOfTypes(goal.id, ['goal.state_changed']).at(-1);
  const reason = last?.type === 'goal.state_changed' ? last.payload.reason : '';
  const d = goal.delivery;
  const parts = [
    `# The goal "${goal.title}"`,
    [
      `${ENDED.has(goal.state) ? 'It ended' : 'It is'} **${goal.state.replace(/_/g, ' ')}**${reason ? ` (${clip(reason, 200)})` : ''}.`,
      `Coding agent: ${goal.provider ?? 'claude'}. Repository: \`${goal.repoPath}\`, base branch \`${goal.baseBranch}\`, goal branch \`${goal.branch}\`. Created ${when(goal.createdAt)}.`,
      `Cost so far: ${usd(goal, goal.costUsd)}${goal.conversationCostUsd ? ` (${usd(goal, goal.conversationCostUsd)} of it the goal's Conversations, outside its budget)` : ''}; budget ${goal.budgets.maxCostUsd == null ? 'unlimited' : usd(goal, goal.budgets.maxCostUsd)}, ${goal.budgets.maxDurationMin == null ? 'no time limit' : `${goal.budgets.maxDurationMin} min`}, ${goal.budgets.attemptsPerTask} attempts per task.`,
      d.status !== 'idle' ? `Delivery: ${d.status}${d.outcome ? `, ${d.outcome}` : ''}${d.pr ? `, pull request #${d.pr.number} (${d.pr.url})` : ''}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    `## What was asked\n${clip(goal.prompt.trim(), 2_000)}`,
    brief?.understanding.trim() ? `## What was understood\n${clip(brief.understanding.trim(), 2_000)}` : '',
    brief ? renderDecisions(brief, '## Decisions from the person') : '',
  ];
  if (tasks.length) {
    const lines = tasks.map((t) => {
      const mine = attempts.filter((a) => a.taskId === t.id);
      const failed = mine.filter((a) => a.state !== 'passed');
      const observed = failed.at(-1) ? getObservation(db, failed.at(-1)!.id)?.summary : null;
      return [`- ${t.title} (\`${t.id}\`): **${t.state}**, ${mine.length} attempt${mine.length === 1 ? '' : 's'}${t.hint ? ` · hint from the person: ${clip(t.hint, 200)}` : ''}`, observed && failed.length ? `  what a failed attempt ran into: ${clip(observed.replace(/\s+/g, ' '), 300)}` : ''].filter(Boolean).join('\n');
    });
    parts.push(`## Tasks (${tasks.length}), one file each under ${RECORDS_DIR}/tasks/\n${lines.join('\n')}`);
  } else if (brief?.tasks.length) {
    // before approval the tasks are the Brief's plan, not rows of their own yet
    parts.push(`## Planned tasks (${brief.tasks.length}), not started: the Brief ${goal.state === 'awaiting_brief_approval' ? 'awaits approval' : 'is being written'}\n${brief.tasks.map((t) => `- ${t.key} ${t.title} (${t.kind}, ${t.scenario})${t.dependsOnKeys.length ? ` after ${t.dependsOnKeys.join(', ')}` : ''}`).join('\n')}`);
  }
  const escs = listEscalations(db, { goalId: goal.id });
  if (escs.length) parts.push(`## Where it waited for the person\n${escs.map((e) => `- ${e.trigger} (${e.state}): ${clip(firstLine(e.message), 240)}${e.answer ? ` → ${e.answer.action}${e.answer.hint ? `: ${clip(e.answer.hint, 200)}` : ''}` : ''}`).join('\n')}`);
  const review = engine.store.listByGoalOfTypes(goal.id, ['review.goal.finished']).at(-1);
  if (review?.type === 'review.goal.finished') parts.push(`## The goal review\n${review.payload.passed ? (review.payload.overDelivered ? 'Passed, over-delivered.' : 'Passed.') : `Did not pass${review.payload.fixTaskIds.length ? `; ${review.payload.fixTaskIds.length} fix task(s) were added` : ''}.`}${review.payload.notes?.trim() ? ` ${clip(review.payload.notes.trim(), 1_200)}` : ''}`);
  return parts.filter(Boolean).join('\n\n');
}

/** one line per event worth a person's attention, oldest first; bookkeeping events give none */
export function describeEvents(engine: Engine, goal: Goal, events: EngineEvent[]): string[] {
  const tasks = new Map(listTasks(engine.store.db, goal.id).map((t) => [t.id, t]));
  const checks = new Map(listChecks(engine.store.db, goal.id).map((c) => [c.id, c]));
  const title = (id: string | null | undefined) => (id && tasks.get(id) ? `"${tasks.get(id)!.title}"` : (id ?? '?'));
  const out: string[] = [];
  for (const e of events) {
    const line = describeEvent(e, title, checks);
    if (line) out.push(`${when(e.ts)}: ${line}`);
  }
  return out;
}

function describeEvent(e: EngineEvent, title: (id: string | null | undefined) => string, checks: Map<string, Check>): string | null {
  const p = e.payload as Record<string, any>;
  switch (e.type) {
    case 'goal.created':
      return 'the goal was created';
    case 'goal.state_changed':
      return `the goal went from ${p.from} to ${p.to}: ${clip(p.reason, 200)}`;
    case 'brief.skeleton_proposed':
      return 'the Clarifier wrote the Brief without its tasks, the planner still at work';
    case 'brief.proposed':
      return 'the Brief was proposed with its tasks';
    case 'brief.edited':
      return 'the person edited the Brief';
    case 'brief.approved':
      return `the Brief was approved${p.by ? ` by ${p.by}` : ''}`;
    case 'brief.second_opinion':
      return `a second opinion on the Brief came in: ${clip(p.changeSummary, 200)}`;
    case 'brief.decision_added':
      return `a Decision was recorded: ${clip(p.text, 160)} → ${clip(p.answer, 160)}`;
    case 'interview.round_asked':
      return `the Clarifier asked interview round ${p.round} (${p.questions.length} question${p.questions.length === 1 ? '' : 's'})`;
    case 'interview.round_answered':
      return `the person answered interview round ${p.round}${p.note ? `, noting: ${clip(p.note, 160)}` : ''}`;
    case 'task.created':
      return `task "${p.task.title}" was planned (${p.task.id})`;
    case 'task.state_changed':
      return `task ${title(p.taskId)}: ${p.from} → ${p.to} (${clip(p.reason, 160)})`;
    case 'task.hint_set':
      return `task ${title(p.taskId)}: ${p.hint ? `hint from the person: ${clip(p.hint, 200)}` : `${p.extraAttempts} more attempt${p.extraAttempts === 1 ? '' : 's'}`}`;
    case 'task.restarted':
      return `task ${title(p.taskId)} was restarted: ${clip(p.reason, 120)}`;
    case 'task.committed':
      return `task ${title(p.taskId)} landed on the goal branch${p.ref ? ` as ${String(p.ref).slice(0, 7)}` : ' (no changes)'}: ${clip(firstLine(p.message), 120)}`;
    case 'task.revised':
      return `task ${title(p.taskId)} was revised by the replan: ${clip(p.reason, 160)}`;
    case 'task.delegated':
      return `task ${title(p.taskId)} is done by a Delegated goal, "${p.title}" (${p.goalId})`;
    case 'attempt.started':
      return `attempt ${p.attempt.index} of task ${title(p.attempt.taskId)} started on ${p.attempt.model}`;
    case 'attempt.finished':
      return `an attempt ended ${p.resultSubtype ?? p.state} (${p.numTurns} turns)`;
    case 'attempt.continued':
      return `an attempt's session was resumed: ${p.reason}`;
    case 'check.finished': {
      const r = p.result;
      return `check "${checks.get(r.checkId)?.name ?? r.checkId}" ${r.status}${r.summary ? `: ${clip(firstLine(r.summary), 160)}` : ''}`;
    }
    case 'review.task.finished':
      return `task ${title(p.taskId)} was reviewed: ${p.verdict.pass ? 'passed' : `${p.verdict.blockers.length} blocker${p.verdict.blockers.length === 1 ? '' : 's'}`}${p.verdict.notes ? `, ${clip(firstLine(p.verdict.notes), 160)}` : ''}`;
    case 'review.goal.finished':
      return `the goal review ${p.passed ? (p.overDelivered ? 'passed, over-delivered' : 'passed') : 'did not pass'}${p.fixTaskIds.length ? `; ${p.fixTaskIds.length} fix task(s) added` : ''}${p.notes ? `: ${clip(firstLine(p.notes), 200)}` : ''}`;
    case 'escalation.raised':
      return `the goal waited for the person (${p.escalation.trigger}): ${clip(firstLine(p.escalation.message), 200)}`;
    case 'escalation.answered':
      return `the person answered${p.by ? ` (${p.by})` : ''}: ${p.answer.action}${p.answer.hint ? `, hint: ${clip(p.answer.hint, 160)}` : ''}`;
    case 'escalation.suggested':
      return `Foundry suggested ${p.suggestion.action}: ${clip(firstLine(p.suggestion.diagnosis), 200)}`;
    case 'merge.conflict':
      return `merging task ${title(p.taskId)} hit a conflict in ${p.files.join(', ')}`;
    case 'merge.completed':
      return `task ${title(p.taskId)} was merged into the goal branch`;
    case 'workspace.rolled_back':
      return `the workspace of task ${title(p.taskId)} was rolled back to ${String(p.toRef).slice(0, 7)}: ${clip(p.reason, 160)}`;
    case 'goal.checkpoint_opened':
      return `the goal paused at a milestone for the person to look (task ${title(p.taskId)}): ${clip(p.lookFor, 160)}`;
    case 'goal.checkpoint_closed':
      return `the person ${p.action === 'continue' ? 'continued' : `gave feedback: ${clip(p.feedback ?? '', 160)}`}`;
    case 'goal.milestone_passed':
      return `a milestone landed (task ${title(p.taskId)})`;
    case 'delivery.started':
      return `delivery started (${p.policy.mode})`;
    case 'delivery.pr_opened':
      return `pull request #${p.number} opened: ${p.url}`;
    case 'delivery.merged':
      return `pull request ${p.prNumber ? `#${p.prNumber} ` : ''}merged`;
    case 'delivery.completed':
      return `delivery completed: ${p.outcome}`;
    case 'delivery.failed':
      return `delivery failed at ${p.step}: ${clip(p.reason, 200)}`;
    case 'delivery.cleaned':
      return `after the merge: ${clip(p.detail, 200)}`;
    case 'deploy.finished':
      return `deployed to ${p.provider} (${p.production ? 'production' : 'preview'}): ${p.url}`;
    case 'deploy.failed':
      return `deploy to ${p.provider} failed: ${clip(p.reason, 200)}`;
    case 'goal.docs_generated':
      return `completion docs ${p.status}: ${clip(p.detail, 160)}`;
    case 'goal.qa_finished':
      return `browser QA ${p.status}: ${clip(p.summary, 200)}`;
    case 'goal.audit_finished':
      return `audit ${p.status}: ${clip(p.summary, 200)}`;
    case 'boundary.blocked':
      return `a command was refused at the boundary: ${clip(p.command, 160)}`;
    case 'engine.note':
      return p.level === 'info' ? null : `${p.level}: ${clip(firstLine(p.message), 240)}`;
    default:
      return null;
  }
}

/** a task's file: what it is, its checks, and every attempt with its report and review */
function taskFile(engine: Engine, goal: Goal, t: Task, attempts: Attempt[], checks: Check[], reviews: Map<string, { pass: boolean; blockers: string[]; notes?: string | null }>): string {
  const db = engine.store.db;
  const results = listCheckResultsByGoal(db, goal.id);
  const extra = t as Task & { difficulty?: string | null; milestone?: string | null; delivers?: string[] | null; relevantFiles?: string[]; dependsOn?: string[] };
  const head = [
    `# ${t.title}`,
    `- id: \`${t.id}\` · state: **${t.state}** · kind: ${t.kind} · scenario: ${t.scenario}${extra.difficulty ? ` · difficulty: ${extra.difficulty}` : ''}${t.area ? ` · area: ${t.area}` : ''}`,
    extra.dependsOn?.length ? `- depends on: ${extra.dependsOn.join(', ')}` : '',
    extra.relevantFiles?.length ? `- start-here files: ${extra.relevantFiles.join(', ')}` : '',
    extra.delivers?.length ? `- delivers: ${extra.delivers.join(', ')}` : '',
    extra.milestone ? `- milestone: ${extra.milestone}` : '',
    t.hint ? `- hint from the person: ${t.hint}` : '',
    t.commitRef ? `- landed as commit ${t.commitRef.slice(0, 7)}: ${firstLine(t.commitMessage)}` : '',
    t.summary ? `- what it delivered: ${t.summary}` : '',
    t.delegatedGoalId ? `- done by the Delegated goal ${t.delegatedGoalId}` : '',
  ].filter(Boolean);
  const own = checks.filter((c) => c.taskId === t.id);
  const checkLines = own.map((c) => {
    const latest = results.filter((r) => r.checkId === c.id).at(-1);
    const spec = c.spec.type === 'command' ? `\`${c.spec.cmd}\`` : c.spec.type === 'reviewer' ? `reviewer: ${c.spec.rubric}` : c.spec.type;
    return `- [${c.tier}] ${c.name} — ${spec}${latest ? `; latest result **${latest.status}**${latest.summary ? `: ${clip(latest.summary.replace(/\s+/g, ' '), 300)}` : ''}` : ''}`;
  });
  const attemptBlocks = attempts
    .filter((a) => a.taskId === t.id)
    .map((a) => {
      const report = getObservation(db, a.id);
      const review = reviews.get(a.id);
      const file = a.transcriptPath && existsSync(a.transcriptPath) ? `transcripts/${a.id}.md` : null;
      return [
        `### Attempt ${a.index} (${a.kind}): ${a.state}${a.resultSubtype ? `, ${a.resultSubtype}` : ''}`,
        `- model ${a.model ?? '?'} · ${usd(goal, a.costUsd)} · ${a.numTurns} turns · ${when(a.startedAt)}${a.endedAt ? ` → ${when(a.endedAt)}` : ''}${a.continuations ? ` · resumed ${a.continuations} time${a.continuations === 1 ? '' : 's'}` : ''}`,
        report?.summary ? `#### What it reported\n${report.summary.trim()}` : '',
        review ? `#### Its review\n${review.pass ? 'Passed.' : `Blockers:\n${review.blockers.map((b) => `- ${b}`).join('\n')}`}${review.notes ? `\n${review.notes}` : ''}` : '',
        file ? `- transcript: ${file}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    });
  return [head.join('\n'), `## Spec\n${t.spec.trim()}`, checkLines.length ? `## Checks\n${checkLines.join('\n')}` : '', attemptBlocks.length ? `## Attempts\n${attemptBlocks.join('\n\n')}` : '## Attempts\nNone yet.'].filter(Boolean).join('\n\n');
}

/** a compact transcript (one JSON turn per line) as a page a reader follows */
function transcriptPage(name: string, compact: string): string {
  const lines = compact.split('\n').filter(Boolean).map((l) => {
    let t: CompactTurn;
    try {
      t = JSON.parse(l) as CompactTurn;
    } catch {
      return l;
    }
    switch (t.role) {
      case 'user':
        return `## The prompt\n${t.content}`;
      case 'assistant':
        return `**Assistant:** ${t.content}`;
      case 'action':
        return `- ${t.content}`;
      case 'tool_error':
        return `- ✗ ${t.content}`;
      case 'result':
        return `**The session ended:** ${t.content}`;
      default:
        return l;
    }
  });
  return `# Session ${name}\nWhat the session said and the tools it called, in order; tool output and thinking are left out.\n\n${lines.join('\n\n')}`;
}

/** every session transcript of the goal that is on this computer, by the name its page takes */
function transcriptFiles(engine: Engine, goal: Goal, attempts: Attempt[]): { name: string; path: string; prompt: string | null }[] {
  const dir = join(engine.config.dataDir, 'transcripts');
  const named = [`clarify-${goal.id}`, `planner-${goal.id}`, `learnings-${goal.id}`, ...Array.from({ length: goal.fixCycles + 1 }, (_, i) => `goal-review-${goal.id}-${i}`)];
  const out = named.map((n) => ({ name: n, path: join(dir, `${n}.jsonl`), prompt: null as string | null }));
  for (const a of attempts) {
    const path = a.transcriptPath ?? join(dir, `${a.id}.jsonl`);
    out.push({ name: a.id, path, prompt: path.replace(/\.jsonl$/, '.prompt.md') });
  }
  return out.filter((f) => existsSync(f.path));
}

/** write the records into `<root>/.foundry-goal/`; returns that folder. Nothing here may stop an answer: a file that cannot be written is skipped */
export function writeGoalRecords(engine: Engine, goal: Goal, root: string): string {
  const db = engine.store.db;
  const dir = join(root, RECORDS_DIR);
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'transcripts'), { recursive: true });
  const write = (name: string, text: () => string) => {
    try {
      writeFileSync(join(dir, name), text().trimEnd() + '\n');
    } catch (err) {
      engine.config.log(`[conversation] ${goal.id}: could not write ${name}: ${String((err as Error).message ?? err)}`);
    }
  };
  const brief = getBrief(db, goal.id)?.brief;
  const tasks = listTasks(db, goal.id);
  const attempts = listAttemptsByGoal(db, goal.id);
  const checks = listChecks(db, goal.id);
  const reviews = new Map<string, { pass: boolean; blockers: string[]; notes?: string | null }>();
  for (const e of engine.store.listByGoalOfTypes(goal.id, ['review.task.finished'])) if (e.type === 'review.task.finished') reviews.set(e.payload.attemptId, e.payload.verdict);
  write('README.md', () =>
    [
      `# Foundry's records of the goal "${goal.title}" (${goal.id})`,
      `Written by Foundry for this Conversation and refreshed before every answer (this one at ${when(new Date().toISOString())}). Read-only; grep them like code.`,
      '',
      '- `goal.md`: the goal in short — what it is, where it stands, what was asked and decided, every task in a line.',
      '- `brief.md`: the Brief as it stands — understanding, Areas, assumptions, the Decisions the person made, the tasks and their checks.',
      '- `tasks/<id>.md`: one task each — its spec, its checks with their latest results, every attempt with what it reported and how it was reviewed, and the name of its transcript.',
      '- `timeline.md`: what happened to the goal, in order, one line each.',
      '- `escalations.md`: every time the goal waited for the person, and what they answered.',
      '- `review.md`: the goal review, the audit and the browser QA.',
      '- `delivery.md`: where the result went — branch, pull requests, merge, tidy-up, deploys.',
      '- `attachments.md`: what the person attached, with the paths to read them.',
      '- `learnings.md`: what earlier goals in this folder taught Foundry.',
      '- `transcripts/<session>.md`: what each session said and did, in short (its prompt beside it as `<session>.prompt.md` where Foundry kept one).',
    ].join('\n'),
  );
  write('goal.md', () => goalSummary(engine, goal));
  write('brief.md', () => (brief ? `# The Brief\n${brief.title ? `Title: ${brief.title}\n\n` : ''}${briefSummary(brief)}${brief.costEstimateUsd != null ? `\n\n## Estimate\n${usd(goal, brief.costEstimateUsd)} · ${brief.timeEstimateMin} min` : ''}` : '# The Brief\nNo Brief yet: Clarify has not written one.'));
  for (const t of tasks) write(join('tasks', `${t.id}.md`), () => taskFile(engine, goal, t, attempts, checks, reviews));
  write('timeline.md', () => `# Timeline\n${describeEvents(engine, goal, engine.store.listByGoal(goal.id, 5000)).join('\n') || 'Nothing yet.'}`);
  write('escalations.md', () => {
    const escs = listEscalations(db, { goalId: goal.id });
    if (!escs.length) return '# Where the goal waited for the person\nNever.';
    return `# Where the goal waited for the person\n\n${escs
      .map((e) => [`## ${e.trigger} (${e.state})${e.taskId ? ` · task ${e.taskId}` : ''}`, e.message.trim(), e.suggestion ? `**Foundry suggested** ${e.suggestion.action}: ${e.suggestion.diagnosis}${e.suggestion.hint ? `\nHint: ${e.suggestion.hint}` : ''}` : '', e.answer ? `**Answered:** ${e.answer.action}${e.answer.hint ? `\nHint: ${e.answer.hint}` : ''}${e.answer.feedback ? `\nFeedback: ${e.answer.feedback}` : ''}` : '**Not answered yet.**'].filter(Boolean).join('\n\n'))
      .join('\n\n')}`;
  });
  write('review.md', () => {
    const reviewsOfGoal = engine.store.listByGoalOfTypes(goal.id, ['review.goal.finished']).flatMap((e) => (e.type === 'review.goal.finished' ? [e] : []));
    const parts = [`# The goal review`];
    if (!reviewsOfGoal.length) parts.push('Not run yet.');
    for (const e of reviewsOfGoal) {
      const p = e.payload;
      const verdicts = [...p.mustResults, ...p.stretchResults].map((r) => `- ${checks.find((c) => c.id === r.checkId)?.name ?? r.checkId}: **${r.status}**${r.summary ? ` — ${clip(r.summary.replace(/\s+/g, ' '), 300)}` : ''}`);
      parts.push(`## ${when(e.ts)}: ${p.passed ? (p.overDelivered ? 'passed, over-delivered' : 'passed') : 'did not pass'}${p.fixTaskIds.length ? ` (fix tasks: ${p.fixTaskIds.join(', ')})` : ''}\n${p.notes?.trim() ?? ''}\n${verdicts.join('\n')}`);
    }
    const c = goal.completion;
    if (c.auditRun) parts.push(`# The audit (${c.auditRun.status})\n${c.auditRun.summary}\n${c.auditRun.findings.map((f) => `- [${f.severity}] ${f.title}: ${f.problem} → ${f.fix}${f.files.length ? ` (${f.files.join(', ')})` : ''}`).join('\n')}`);
    if (c.qaRun) parts.push(`# The browser QA (${c.qaRun.status})\n${c.qaRun.summary}\n${c.qaRun.results.map((r) => `- ${r.check}: ${r.status}${r.problem ? ` — ${r.problem}` : ''}`).join('\n')}`);
    return parts.join('\n\n');
  });
  write('delivery.md', () => {
    const d = goal.delivery;
    const lines = [`# Delivery`, `- policy: ${d.policy.mode}${d.policy.unit ? `, ${d.policy.unit === 'task' ? 'one pull request per task' : 'one pull request'}` : ''} · status: ${d.status}${d.outcome ? ` · outcome: ${d.outcome}` : ''}${d.step ? ` · step: ${d.step}` : ''}${d.error ? ` · error: ${d.error}` : ''}`];
    for (const pr of d.prs) lines.push(`- pull request ${pr.number ? `#${pr.number}` : '(not opened)'} ${pr.title ?? ''} on \`${pr.branch}\` → \`${pr.base}\`: ${pr.state}${pr.url ? ` ${pr.url}` : ''}${pr.mergedRef ? ` merged as ${pr.mergedRef.slice(0, 7)}` : ''}`);
    if (d.local) lines.push(`- the person's local base branch: ${d.local.upToDate ? 'up to date' : 'not updated'} — ${d.local.detail}`);
    if (d.cleanup) lines.push(`- tidy-up after the merge: ${d.cleanup.done ? 'done' : 'not done'} — ${d.cleanup.detail}`);
    for (const r of d.reviews ?? []) lines.push(`- review round ${r.id}: ${r.status}${'detail' in r && r.detail ? ` — ${r.detail}` : ''}`);
    for (const dep of goal.deployments ?? []) lines.push(`- deploy to ${dep.provider} (${dep.production ? 'production' : 'preview'}) at ${when(dep.at)}: ${dep.status}${dep.url ? ` ${dep.url}` : ''}${dep.reason ? ` — ${dep.reason}` : ''}`);
    return lines.join('\n');
  });
  write('attachments.md', () => renderAttachments(goal, engine.config.dataDir) || '# Attachments from the user\nNone.');
  write('materials.md', () => {
    const provides = getBrief(db, goal.id)?.brief.provides ?? [];
    const open = listEscalations(db, { goalId: goal.id, openOnly: true }).filter((e) => e.trigger === 'needs_input');
    if (!provides.length && !open.length) return '# What the person will provide, and what the goal asks for\nNothing: no promised material, no open Request.';
    const lines = ['# What the person will provide, and what the goal asks for'];
    if (provides.length) lines.push('## Materials promised in the Brief (key · what · mode · status)', ...provides.map((p) => `- \`${p.key}\` · ${p.what} · ${p.mode} · **${p.status}**${p.neededBy.length ? ` · needed by ${p.neededBy.join(', ')}` : ''}${p.attachmentIds.length ? ` · attachments ${p.attachmentIds.join(', ')}` : ''}${p.note ? ` · "${p.note}"` : ''}`));
    if (open.length) lines.push('## Open Requests (id · what)', ...open.map((e) => `- \`${e.id}\` · ${(e.payload as { what?: string }).what ?? e.message}${(e.payload as { materialKey?: string }).materialKey ? ` · for material ${(e.payload as { materialKey?: string }).materialKey}` : ''}${e.taskId ? ` · task ${e.taskId}` : ''}`));
    return lines.join('\n');
  });
  write('learnings.md', () => learningsContext(engine, goal) || '# What Foundry learned about this repository\nNothing recorded yet.');
  // the transcripts: rendered once per session, again only when it wrote more
  for (const f of transcriptFiles(engine, goal, attempts)) {
    const target = join(dir, 'transcripts', `${f.name}.md`);
    try {
      const fresh = existsSync(target) && statSync(target).mtimeMs >= statSync(f.path).mtimeMs;
      if (!fresh) writeFileSync(target, transcriptPage(f.name, compactTranscript(readFileSync(f.path, 'utf8'), goal.provider ?? 'claude', { prompt: f.prompt && existsSync(f.prompt) ? readFileSync(f.prompt, 'utf8') : null })) + '\n');
    } catch (err) {
      engine.config.log(`[conversation] ${goal.id}: could not render ${f.name}: ${String((err as Error).message ?? err)}`);
    }
  }
  return dir;
}

/**
 * The pictures and files the person attached to the Conversation's questions, copied under the records
 * (`asked/<question>/`) so the session reads them like any file; a ready markdown rendition comes along. A link has
 * nothing to copy but its snapshot. Idempotent: a file already there at its size is left alone.
 */
export function writeQuestionFiles(engine: Engine, goal: Goal, messages: ConversationMessage[], root: string): void {
  for (const m of messages) {
    if (m.role !== 'person' || !m.attachments?.length) continue;
    const dir = join(root, RECORDS_DIR, 'asked', m.id);
    for (const a of m.attachments) {
      try {
        const copies: [string | null, string][] = [
          [attachmentAbsPath(engine.config.dataDir, goal.id, a), a.name],
          [markdownAbsPath(engine.config.dataDir, goal.id, a), markdownFileName(a)],
        ];
        for (const [from, name] of copies) {
          if (!from) continue;
          mkdirSync(dir, { recursive: true });
          const to = join(dir, name);
          if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
          copyFileSync(from, to);
        }
      } catch (err) {
        engine.config.log(`[conversation] ${goal.id}: could not place ${a.name} for the Explainer: ${String((err as Error).message ?? err)}`);
      }
    }
  }
}
