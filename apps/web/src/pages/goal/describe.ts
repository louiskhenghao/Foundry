import type { EngineEvent } from '@foundry/core/browser';

export type Tone = 'info' | 'ok' | 'warn' | 'err' | 'muted';

export function describe(e: EngineEvent): { text: string; tone: Tone } {
  const p: any = e.payload;
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
      return { text: `Session ended: ${p.resultSubtype} · $${p.costUsd.toFixed(3)} · ${p.numTurns} turns${p.skillsUsed?.length ? ` · used ${p.skillsUsed.map((s: string) => `/${s}`).join(', ')}` : ''}`, tone: p.resultSubtype === 'success' ? 'muted' : 'warn' };
    case 'attempt.concluded':
      return { text: `Attempt ${p.state}: ${p.reason}`, tone: p.state === 'passed' ? 'ok' : 'warn' };
    case 'check.finished':
      return { text: `Check ${p.result.status}: ${p.result.summary.split('\n')[0]?.slice(0, 100)}`, tone: p.result.status === 'pass' ? 'ok' : 'err' };
    case 'review.task.finished':
      return { text: p.verdict.pass ? 'Task reviewer: no blockers' : `Task reviewer blockers: ${p.verdict.blockers.join(' | ')}`, tone: p.verdict.pass ? 'ok' : 'warn' };
    case 'review.goal.finished':
      return { text: p.passed ? (p.overDelivered ? 'Goal review: over-delivered ✨' : 'Goal review: passed') : `Goal review failed; ${p.fixTaskIds.length} fix task(s)`, tone: p.passed ? 'ok' : 'warn' };
    case 'escalation.raised':
      return { text: `Needs you: ${p.escalation.trigger.replace(/_/g, ' ')} — ${p.escalation.message.split('\n')[0]}`, tone: 'warn' };
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
    case 'goal.cost_added':
      return { text: `+$${p.costUsd.toFixed(3)} ${p.source}`, tone: 'muted' };
    case 'goal.budgets_changed':
      return { text: `Budget ${p.reason === 'auto-from-brief' ? 'proposed from the Brief estimate' : 'changed'}: ${p.budgets.maxCostUsd == null ? 'no cost cap' : `$${p.budgets.maxCostUsd}`} / ${p.budgets.maxDurationMin == null ? 'no time cap' : `${p.budgets.maxDurationMin} min`}`, tone: 'info' };
    case 'engine.note':
      return { text: p.message.split('\n')[0], tone: p.level === 'error' ? 'err' : p.level === 'warn' ? 'warn' : 'muted' };
    case 'boundary.blocked':
      return { text: `Blocked command: ${p.command}`, tone: 'warn' };
    case 'session.usage':
      return { text: `${p.kind} session · ${p.model ?? '?'} · $${p.costUsd.toFixed(3)}`, tone: 'muted' };
    default:
      return { text: e.type, tone: 'muted' };
  }
}

export const NOISY = new Set(['goal.cost_added', 'workspace.committed', 'session.usage', 'attempt.session', 'check.created', 'task.workspace_assigned']);
