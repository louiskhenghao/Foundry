import type { EngineEvent } from '@foundry/core/browser';
import { stamp } from '../../time.ts';

export type Tone = 'info' | 'ok' | 'warn' | 'err' | 'muted';

/** `full` is the whole text when `text` shows only part of it (the Activity row then opens it); `raw` = start the dialog in Raw. */
export function describe(e: EngineEvent, costAvailable = true): { text: string; tone: Tone; full?: string; raw?: boolean } {
  const p: any = e.payload;
  const cost = (n: number) => costAvailable ? `$${n.toFixed(3)}` : 'cost unavailable';
  switch (e.type) {
    case 'goal.state_changed':
      return { text: `Goal ${p.from} → ${p.to} (${p.reason})`, tone: ['done', 'over_delivered'].includes(p.to) ? 'ok' : ['failed', 'cancelled'].includes(p.to) ? 'err' : p.to === 'blocked' ? 'warn' : 'info' };
    case 'task.state_changed':
      return { text: `Task ${p.from} → ${p.to} (${p.reason})`, tone: p.to === 'done' ? 'ok' : p.to === 'failed' ? 'err' : p.to === 'blocked' ? 'warn' : 'muted' };
    case 'task.created':
      return { text: `Task created: ${p.task.title}${p.task.origin !== 'brief' ? ` (${p.task.origin})` : ''}`, tone: 'info' };
    case 'attempt.started':
      return { text: `Attempt #${p.attempt.index}${p.attempt.kind === 'merge' ? ' (merge)' : ''} started`, tone: 'muted' };
    case 'attempt.finished':
      return { text: `Session ended: ${p.resultSubtype} · ${cost(p.costUsd)} · ${costAvailable ? p.numTurns + ' turns' : 'turn count unavailable'}${p.skillsUsed?.length ? ` · used ${p.skillsUsed.map((s: string) => `/${s}`).join(', ')}` : ''}`, tone: p.resultSubtype === 'success' ? 'muted' : 'warn' };
    case 'attempt.concluded':
      return { text: `Attempt ${p.state}: ${p.reason}`, tone: p.state === 'passed' ? 'ok' : 'warn' };
    case 'check.finished':
      return { text: `Check ${p.result.status}: ${p.result.summary.split('\n')[0]?.slice(0, 100)}`, tone: p.result.status === 'pass' ? 'ok' : 'err', ...cut(p.result.summary, 100, true) };
    case 'review.task.finished':
      return { text: p.verdict.pass ? 'Task reviewer: no blockers' : `Task reviewer blockers: ${p.verdict.blockers.join(' | ')}`, tone: p.verdict.pass ? 'ok' : 'warn' };
    case 'review.goal.finished':
      return { text: p.passed ? (p.overDelivered ? 'Goal review: over-delivered ✨' : 'Goal review: passed') : `Goal review failed; ${p.fixTaskIds.length} fix task(s)`, tone: p.passed ? 'ok' : 'warn' };
    case 'goal.audit_finished':
      return { text: p.status === 'ok' ? `Audit: ${p.detail}` : `Audit ${p.status}: ${p.detail}`, tone: p.status === 'failed' ? 'warn' : p.fixTaskIds.length ? 'warn' : 'ok', ...cut(p.summary) };
    case 'escalation.raised':
      return { text: `Needs you: ${p.escalation.trigger.replace(/_/g, ' ')} — ${p.escalation.message.split('\n')[0]}`, tone: 'warn', ...cut(p.escalation.message) };
    case 'escalation.answered':
      return { text: `You answered: ${p.answer.action}${p.answer.hint ? ` — "${p.answer.hint}"` : ''}`, tone: 'info' };
    case 'merge.started':
      return { text: `Merging task branch into ${p.into}`, tone: 'muted' };
    case 'merge.conflict':
      return { text: `Merge conflict in ${p.files.join(', ')}`, tone: 'warn' };
    case 'merge.completed':
      return { text: `Merged (${p.ref.slice(0, 7)})`, tone: 'ok' };
    case 'workspace.committed':
      return { text: `Committed ${p.ref.slice(0, 7)}`, tone: 'muted' };
    case 'workspace.rolled_back':
      return { text: `Rolled back to ${p.toRef.slice(0, 7)}: ${p.reason}`, tone: 'warn' };
    case 'brief.proposed':
      return { text: `Brief proposed: ${p.brief.tasks.length} task(s), ${p.brief.checks.length} check(s)`, tone: 'info' };
    case 'brief.approved':
      return { text: 'Brief approved', tone: 'ok' };
    case 'clarify.started':
      return { text: 'Clarifier exploring the repository', tone: 'muted' };
    case 'clarify.stage':
      return { text: p.stage === 'planning' ? 'Planner splitting the goal into tasks' : p.stage === 'queued' ? 'Waiting for a free session slot' : p.stage === 'investigating' ? 'REA studying the references' : 'Clarifier at work', tone: 'muted' };
    case 'brief.skeleton_proposed':
      return { text: `Brief skeleton proposed: ${n(p.brief.areas.length, 'Area')}; the planner is splitting the goal into tasks`, tone: 'info' };
    case 'brief.edited':
      return { text: 'Brief edited', tone: 'muted' };
    case 'brief.second_opinion':
      return { text: `Second opinion${p.auto ? ' (by itself)' : ''}: ${p.changeSummary}`, tone: 'info' };
    case 'brief.second_opinion_failed':
      return { text: `Second opinion${p.auto ? ' (by itself)' : ''} could not finish: ${p.reason}`, tone: 'warn' };
    case 'brief.decision_added':
      return { text: `Note added: ${p.text.split('\n')[0]}`, tone: 'info', ...cut(p.text) };
    case 'interview.round_asked':
      return { text: `Clarifier asked round ${p.round}: ${n(p.questions.length, 'question')}`, tone: 'info' };
    case 'interview.round_answered': {
      const k = Object.keys(p.answers ?? {}).length;
      const answers = `${k ? n(k, 'answer') : 'no answers'}${p.note ? ', with a note' : ''}`;
      return { text: p.finish ? `You asked for the Brief after round ${p.round}: ${answers}` : `You answered round ${p.round}: ${answers}`, tone: 'info' };
    }
    case 'interview.finished':
      return { text: p.reason === 'nothing_to_ask' ? 'Interview over: nothing to ask' : `Interview over after ${n(p.rounds, 'round')}: ${p.reason === 'human' ? 'you asked for the Brief' : p.reason === 'cap' ? 'the round cap was reached' : 'nothing left to ask'}`, tone: 'muted' };
    case 'revise.round_asked':
      return { text: `Revise asked round ${p.round}: ${n(p.questions.length, 'question')}`, tone: 'info' };
    case 'revise.round_answered': {
      const k = Object.keys(p.answers ?? {}).length;
      return { text: `You answered the Revise round ${p.round}: ${k ? n(k, 'answer') : 'no answers'}${p.note ? ', with a note' : ''}${p.finish ? ' (asked it to propose)' : ''}`, tone: 'info' };
    }
    case 'revise.finished':
      return { text: p.reason === 'proposal' ? `Revise proposed after ${n(p.rounds, 'round')}` : p.reason === 'abandoned' ? `Revise let go after ${n(p.rounds, 'round')}` : p.reason === 'cap' ? `Revise proposed at the round cap (${n(p.rounds, 'round')})` : `Revise failed after ${n(p.rounds, 'round')}`, tone: p.reason === 'failed' ? 'warn' : 'muted' };
    case 'goal.nature_set':
      return { text: `Nature: ${p.nature} (${p.reason})`, tone: 'muted' };
    case 'goal.reclarified':
      return { text: `Clarify re-run: ${p.reason}`, tone: 'info' };
    case 'goal.cost_added':
      return { text: `+${cost(p.costUsd)} ${p.source}`, tone: 'muted' };
    case 'goal.budgets_changed':
      return { text: `Budget ${p.reason === 'auto-from-brief' ? 'proposed from the Brief estimate' : 'changed'}: ${p.budgets.maxCostUsd == null ? 'no cost cap' : `$${p.budgets.maxCostUsd}`} / ${p.budgets.maxDurationMin == null ? 'no time cap' : `${p.budgets.maxDurationMin} min`}`, tone: 'info' };
    case 'engine.note':
      return { text: p.message.split('\n')[0], tone: p.level === 'error' ? 'err' : p.level === 'warn' ? 'warn' : 'muted', ...cut(p.message, Infinity, true) };
    case 'boundary.blocked':
      return { text: `Blocked command: ${p.command}`, tone: 'warn' };
    case 'goal.imported':
      return { text: `Imported from ${p.from.hostname} (Foundry ${p.from.release}, written ${stamp(String(p.from.exportedAt))})`, tone: 'info' };
    case 'goal.repo_mapped':
      return { text: `Repository mapped: ${p.from} → ${p.to}`, tone: 'info' };
    case 'goal.branch_restored':
      return { text: `Branch ${p.branch} restored at ${String(p.head).slice(0, 7)}`, tone: 'info' };
    case 'goal.reattached':
      return { text: `Reattached here — progress folder ${p.workspaceDir}`, tone: 'ok' };
    case 'session.usage':
      return { text: `${p.kind} session · ${p.model ?? '?'} · ${cost(p.costUsd)}`, tone: 'muted' };
    case 'task.delegated':
      return { text: `Delegated to the goal "${p.title}" (${p.goalId})`, tone: 'info' };
    case 'task.delegation_restarted':
      return { text: `The delegated goal failed: ${p.restarted.length} task(s) restarted there (restart ${p.n})`, tone: 'warn' };
    case 'task.summary_set':
      return { text: 'Recorded what the step delivered, for the tasks after it', tone: 'muted', ...cut(p.summary) };
    case 'task.revised':
      return { text: `Task touched up after a step landed: ${p.reason}`, tone: 'info', ...cut(p.spec) };
    case 'memory.recalled': {
      const stage = MEMORY_STAGE[p.stage] ?? p.stage;
      return p.text ? { text: `Memory recalled for the ${stage} (${p.ms} ms${p.kind === 'recall' ? '; the memories themselves, the answer did not come in time' : ''})`, tone: 'muted', full: p.text } : { text: p.error ? `Memory did not answer the ${stage}: ${p.error}` : `Memory had nothing for the ${stage}`, tone: p.error ? 'warn' : 'muted' };
    }
    case 'memory.retained':
      return { text: p.error ? `Memory could not write the ${p.source}: ${p.error}` : `Memory: wrote the ${p.source}${p.count > 1 ? ` (${p.count})` : ''}`, tone: p.error ? 'warn' : 'muted' };
    default:
      return { text: e.type, tone: 'muted' };
  }
}

/** a count with its noun: "1 question", "3 rounds" */
const n = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** the stages that ask Memory (ADR-0072), in words */
export const MEMORY_STAGE: Record<string, string> = { attempt: 'attempt', clarify: 'Clarifier', person: 'Clarifier, about you', replan: 'replan', review_task: 'task review', review_goal: 'goal review' };

/** the whole text, when the one-line description keeps only its first line (up to `max` characters) */
function cut(text: string, max = Infinity, raw = false): { full?: string; raw?: boolean } {
  const first = text.split('\n')[0] ?? '';
  return text.trim() !== first.trim() || first.length > max ? { full: text, raw } : {};
}

export const NOISY = new Set(['goal.cost_added', 'workspace.committed', 'session.usage', 'attempt.session', 'check.created', 'task.workspace_assigned', 'memory.retained']);
