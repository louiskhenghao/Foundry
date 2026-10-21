/**
 * Answers from a Notification Channel (ADR-0038). A message about something that waits for the person carries buttons,
 * and a reply to it answers in words. Both go through the engine calls the web UI makes — the Inbox's answers, the
 * interview's Send / Accept all recommended / Enough, the Brief's Approve, Resume now — and through nothing else. A
 * command outside the workspace is approved in the Inbox only: from a chat it can be denied, never run.
 *
 * Channel-agnostic: a channel turns a `Keyboard` into its buttons, a button's `data` back into a `press`, a reply into
 * a `reply`, and shows the `Outcome`.
 */
import { AgentProvider, PROVIDER_LABEL, reportsDollars } from '@foundry/core';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ACTIONS_BY_TRIGGER, proposeBudgetFromEstimate, calibratedEstimate, type Calibration } from '@foundry/core';
import type { Brief, Budgets, Escalation, EscalationAction, EscalationAnswer, FeedbackPlan, Goal, InterviewQuestion } from '@foundry/core';

/** what a message with buttons is about */
export type Target =
  | { kind: 'esc'; id: string }
  | { kind: 'question'; goalId: string; round: number; index: number }
  | { kind: 'round'; goalId: string; round: number }
  | { kind: 'brief'; goalId: string }
  | { kind: 'plan'; escId: string }
  | { kind: 'usage'; provider: AgentProvider };

/** what words sent in reply mean */
export type TextTarget = { kind: 'hint'; escId: string } | { kind: 'feedback'; escId: string } | { kind: 'answer'; goalId: string; round: number; index: number } | { kind: 'note'; goalId: string; round: number };

export function targetKey(t: Target): string {
  switch (t.kind) {
    case 'esc':
      return `esc:${t.id}`;
    case 'question':
      return `question:${t.goalId}:${t.round}:${t.index}`;
    case 'round':
      return `round:${t.goalId}:${t.round}`;
    case 'brief':
      return `brief:${t.goalId}`;
    case 'plan':
      return `plan:${t.escId}`;
    case 'usage':
      return `usage:${t.provider}`;
  }
}

export interface Button {
  label: string;
  /** what a press sends back: at most 64 bytes (Telegram's limit) */
  data: string;
}
export type Keyboard = Button[][];

/** a button that only says what happened; pressing it changes nothing */
export const DONE = 'x';
const btn = (label: string, data: string): Button => ({ label, data });
export const statusRow = (text: string): Keyboard => [[btn(text, DONE)]];

/** the time of day on this computer's clock (the person shares it): 14:02 */
export const clock = (d = new Date()) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const errText = (err: unknown) => String((err as Error)?.message ?? err).replace(/^Error:\s*/, '');

export type Press =
  | { kind: 'done' }
  | { kind: 'esc'; id: string; code: string }
  | { kind: 'question'; goalId: string; round: number; index: number; option: number | 'own' }
  | { kind: 'round'; goalId: string; round: number; code: 'a' | 's' | 'e' | 'n' }
  | { kind: 'brief'; goalId: string; code: 'a' | 'A' | 'n' }
  | { kind: 'plan'; escId: string; code: 'a' | 'n' }
  | { kind: 'usage'; provider: AgentProvider };

const ID = /^[a-z]+_[0-9a-z]+$/;
const num = (s: string | undefined) => (s && /^\d{1,3}$/.test(s) ? Number(s) : null);

/** a button's data back into what it asks for; null for anything this version never wrote */
export function parsePress(data: string): Press | null {
  const p = data.split(':');
  const id = p[1] && ID.test(p[1]) ? p[1] : null;
  switch (p[0]) {
    case DONE:
      return p.length === 1 ? { kind: 'done' } : null;
    case 'e':
      return p.length === 3 && id && /^[a-zA-Z]$/.test(p[2]!) ? { kind: 'esc', id, code: p[2]! } : null;
    case 'q': {
      const round = num(p[2]);
      const index = num(p[3]);
      const option = p[4] === 'w' ? ('own' as const) : num(p[4]);
      return p.length === 5 && id && round != null && index != null && option != null ? { kind: 'question', goalId: id, round, index, option } : null;
    }
    case 'r': {
      const round = num(p[2]);
      return p.length === 4 && id && round != null && (p[3] === 'a' || p[3] === 's' || p[3] === 'e' || p[3] === 'n') ? { kind: 'round', goalId: id, round, code: p[3] } : null;
    }
    case 'b':
      return p.length === 3 && id && (p[2] === 'a' || p[2] === 'A' || p[2] === 'n') ? { kind: 'brief', goalId: id, code: p[2] } : null;
    case 'p':
      return p.length === 3 && id && (p[2] === 'a' || p[2] === 'n') ? { kind: 'plan', escId: id, code: p[2] } : null;
    case 'u':
      return p.length === 2 && AgentProvider.safeParse(p[1]).success ? { kind: 'usage', provider: p[1] as AgentProvider } : null;
    default:
      return null;
  }
}

/** the message a press came from is about this */
export function pressTarget(p: Press): Target | null {
  switch (p.kind) {
    case 'done':
      return null;
    case 'esc':
      return { kind: 'esc', id: p.id };
    case 'question':
      return { kind: 'question', goalId: p.goalId, round: p.round, index: p.index };
    case 'round':
      return { kind: 'round', goalId: p.goalId, round: p.round };
    case 'brief':
      return { kind: 'brief', goalId: p.goalId };
    case 'plan':
      return { kind: 'plan', escId: p.escId };
    case 'usage':
      return { kind: 'usage', provider: p.provider };
  }
}

// ---------- keyboards ----------

/** a goal-level review escalation: Retry turns the findings into fix tasks, Skip accepts the goal as it is */
const isGoalReview = (esc: Escalation) => !esc.taskId && (esc.payload as { kind?: string } | undefined)?.kind === 'goal-review';

/** the answers a chat offers for an escalation: the Inbox's, without Approve (a command outside the workspace) and without Resolve manually (a page of its own) */
export function escalationKeyboard(esc: Escalation): Keyboard {
  if (esc.state !== 'open') return [];
  const e = (code: string) => `e:${esc.id}:${code}`;
  switch (esc.trigger) {
    case 'retries_exhausted':
    case 'permission_denial': {
      const review = isGoalReview(esc);
      return [
        [btn(review ? '🔁 Fix and review again' : '🔁 Retry', e('r')), btn('✍️ Retry with hint…', e('h'))],
        [btn(review ? '✅ Accept as-is' : '⏭ Skip task', e('s')), btn('🛑 Abort goal…', e('x'))],
      ];
    }
    case 'budget_exceeded':
      return [[btn('💰 Raise budget ×2', e('b')), btn('🛑 Abort goal…', e('x'))]];
    case 'boundary_action':
      return [[btn('🚫 Deny', e('d'))]];
    case 'milestone':
      return [[btn('▶️ Continue', e('c')), btn('💬 Give feedback…', e('f'))]];
    case 'delivery_failed':
      return [[btn('🔁 Retry delivery', e('D')), btn('✅ Mark as delivered…', e('m'))]];
    case 'brief_question':
      return [];
  }
}

/** an interview question: one button per option (the first is the Clarifier's recommendation), then "my own answer" */
export function questionKeyboard(goalId: string, round: number, index: number, q: Pick<InterviewQuestion, 'options'>, chosen: string | null): Keyboard {
  const rows = q.options.map((o, i) => [btn(`${chosen === o ? '✓ ' : ''}${i === 0 ? '⭐ ' : ''}${clip(o, 60)}`, `q:${goalId}:${round}:${index}:${i}`)]);
  const own = chosen != null && !q.options.includes(chosen);
  rows.push([btn(own ? `✓ ✍️ ${clip(chosen, 40)}` : '✍️ My own answer…', `q:${goalId}:${round}:${index}:w`)]);
  return rows;
}

/** the round's own buttons; `note` = the note drafted for it so far, shown on its button */
export function roundKeyboard(goalId: string, round: number, note: string | null = null): Keyboard {
  return [
    [btn('✅ Accept all recommended', `r:${goalId}:${round}:a`)],
    [btn(note ? `✓ ✍️ ${clip(note, 40)}` : '✍️ Add a note…', `r:${goalId}:${round}:n`)],
    [btn('📨 Send answers', `r:${goalId}:${round}:s`), btn('✋ Enough — write the Brief', `r:${goalId}:${round}:e`)],
  ];
}

const blockingLeft = (brief: Brief) => brief.questions.filter((q) => q.blocking && !q.answer?.trim());

/** Approve on a ready Brief, unless a blocking question is left: that is answered on the Brief's page */
export function briefKeyboard(goalId: string, brief: Brief | null): Keyboard {
  if (!brief || blockingLeft(brief).length) return [];
  return [[btn('▶️ Approve and run…', `b:${goalId}:a`)]];
}

export const planKeyboard = (escId: string): Keyboard => [[btn('✅ Apply', `p:${escId}:a`), btn('↩︎ Drop', `p:${escId}:n`)]];
export const usageKeyboard = (provider: AgentProvider): Keyboard => [[btn('▶️ Resume now', `u:${provider}`)]];

/**
 * The budget a Brief is approved with, as the Brief page does it: an Auto goal with no limits yet takes the estimate ×2
 * (no dollar limit for Codex, which reports no cost); otherwise the goal's limits stand.
 */
export function budgetOnApproval(goal: Pick<Goal, 'provider' | 'budgetPreset' | 'budgets'>, brief: Pick<Brief, 'costEstimateUsd' | 'timeEstimateMin'>, calibration: Calibration | null = null): { budgets?: Partial<Budgets>; text: string } {
  const codex = !reportsDollars(goal.provider);
  if (goal.budgetPreset === 'auto' && goal.budgets.maxCostUsd == null && goal.budgets.maxDurationMin == null) {
    // the estimate as earlier goals corrected it (ADR-0056), then ×2 as on the Brief page
    const corrected = calibration && calibration.scope !== 'none';
    const p = proposeBudgetFromEstimate(calibratedEstimate(brief, calibration));
    return { budgets: codex ? { maxDurationMin: p.maxDurationMin } : p, text: `${codex ? '' : `$${p.maxCostUsd} / `}${p.maxDurationMin} min (the ${corrected ? 'calibrated ' : ''}estimate ×2)` };
  }
  const { maxCostUsd, maxDurationMin } = goal.budgets;
  return { text: `${codex ? '' : `${maxCostUsd == null ? 'no cost limit' : `$${maxCostUsd}`} / `}${maxDurationMin == null ? 'no time limit' : `${maxDurationMin} min`}` };
}

// ---------- what the engine does for a chat ----------

/** a draft the person builds up in the chat before sending it: interview answers and a note per round, a feedback plan per milestone */
export interface Drafts {
  answers(goalId: string, round: number): Record<string, string>;
  setAnswer(goalId: string, round: number, key: string, answer: string): void;
  /** what the person wrote unasked for the round, sent with its answers */
  note(goalId: string, round: number): string | null;
  setNote(goalId: string, round: number, note: string | null): void;
  /** the round was sent: its answers and its note are no longer drafts */
  clearAnswers(goalId: string, round: number): void;
  plan(escId: string): { feedback: string; plan: FeedbackPlan } | null;
  setPlan(escId: string, value: { feedback: string; plan: FeedbackPlan } | null): void;
}

/** the engine calls a chat may make — the web UI's, nothing more */
export interface ActionHost {
  goal(id: string): Goal | null;
  brief(goalId: string): Brief | null;
  escalation(id: string): Escalation | null;
  answerEscalation(id: string, answer: EscalationAnswer): Promise<void>;
  answerInterview(goalId: string, answers: Record<string, string>, finish: boolean, note: string | null): void;
  approveBrief(goalId: string, budgets?: Partial<Budgets>): Promise<void>;
  classifyFeedback(goalId: string, text: string): Promise<FeedbackPlan>;
  resumeNow(provider: AgentProvider): boolean;
  /** how far earlier goals ran from their estimate, for the budget a Brief is approved with (ADR-0056) */
  calibration?(goal: Goal): Calibration | null;
  /** an entry in the activity: what was answered, from where, by whom */
  note(goalId: string | null, message: string): void;
  drafts: Drafts;
}

/** where an answer came from, for the activity */
export interface Via {
  channel: string;
  who: string | null;
}

/** what the channel shows after a press or a reply */
export interface Outcome {
  /** a short note (at most 200 characters) */
  toast: string;
  /** something went wrong: shown so it is read, not as a passing note */
  alert?: boolean;
  /** new buttons for the message pressed ([] removes them); absent = unchanged */
  buttons?: Keyboard;
  /** ask for words: a message the person answers by replying */
  ask?: { text: string; placeholder: string; target: TextTarget };
  /** new messages (a feedback plan to confirm) */
  send?: { text: string; buttons: Keyboard; target: Target }[];
  /** other messages whose buttons change (a round's questions once it is sent, a milestone once its feedback applied) */
  update?: { target: Target; buttons: Keyboard }[];
}

/** escalation buttons: the answer each sends, the word for it once done, and the note on the press */
const ESC_CODES: Record<string, { action: EscalationAction; done: string; toast: (esc: Escalation) => string }> = {
  r: { action: 'retry_with_hint', done: 'Retried', toast: (e) => (isGoalReview(e) ? 'Fix tasks for the findings run next; then the goal is reviewed again.' : 'Retrying: the task gets another attempt.') },
  s: { action: 'skip_task', done: 'Skipped', toast: (e) => (isGoalReview(e) ? 'Accepted as it is: the goal finishes.' : 'Skipped: the tasks after it go on.') },
  X: { action: 'abort_goal', done: 'Goal aborted', toast: () => 'The goal is aborted.' },
  b: { action: 'raise_budget', done: 'Budget raised', toast: () => 'Budget doubled: the goal goes on.' },
  d: { action: 'deny', done: 'Denied', toast: () => 'Denied: the command does not run.' },
  c: { action: 'continue', done: 'Continued', toast: () => 'Continuing with the remaining tasks.' },
  D: { action: 'retry_delivery', done: 'Delivery retried', toast: () => 'The delivery runs again.' },
  M: { action: 'mark_delivered', done: 'Marked as delivered', toast: () => 'Recorded as delivered.' },
};
/** a confirming press, offered only after the press that asks */
const CONFIRMS: Record<string, string> = { X: 'x', M: 'm' };
const DONE_WORD: Partial<Record<EscalationAction, string>> = Object.fromEntries(Object.values(ESC_CODES).map((c) => [c.action, c.done]));

function answeredStatus(esc: Escalation): Keyboard {
  const word = esc.answer ? (DONE_WORD[esc.answer.action] ?? esc.answer.action) : esc.state;
  return statusRow(`✓ ${word}`);
}

/** who answered, for the activity: "from Telegram by Ann" */
const fromVia = (via: Via) => `from ${via.channel}${via.who ? ` by ${via.who}` : ''}`;

export async function press(host: ActionHost, data: string, via: Via): Promise<Outcome> {
  const p = parsePress(data);
  if (!p) return { toast: 'This button no longer does anything.', buttons: [] };
  switch (p.kind) {
    case 'done':
      return { toast: 'Done already.' };
    case 'esc':
      return pressEscalation(host, p, via);
    case 'question':
      return pressQuestion(host, p);
    case 'round':
      return pressRound(host, p, via);
    case 'brief':
      return pressBrief(host, p, via);
    case 'plan':
      return pressPlan(host, p, via);
    case 'usage': {
      const resumed = host.resumeNow(p.provider);
      if (resumed) host.note(null, `${PROVIDER_LABEL[p.provider]} sessions resumed ${fromVia(via)}`);
      return { toast: resumed ? 'Sessions start again now. If the limit still holds, the next one pauses them again.' : 'Not paused any more.', buttons: statusRow(`✓ Resumed · ${clock()}`) };
    }
  }
}

async function pressEscalation(host: ActionHost, p: Extract<Press, { kind: 'esc' }>, via: Via): Promise<Outcome> {
  const esc = host.escalation(p.id);
  if (!esc) return { toast: 'This item is gone.', buttons: [] };
  if (esc.state !== 'open') return { toast: `Already ${esc.state}.`, buttons: answeredStatus(esc) };
  const keyboard = escalationKeyboard(esc);
  const offered = new Set(keyboard.flat().map((b) => b.data.split(':')[2]!));
  const e = (code: string) => `e:${esc.id}:${code}`;
  if (p.code === 'n') return { toast: 'Nothing changed.', buttons: keyboard };
  if (p.code === 'x' && offered.has('x')) return { toast: 'Abort the goal? Its sessions stop and it ends as failed.', buttons: [[btn('🛑 Yes, abort the goal', e('X'))], [btn('↩︎ No', e('n'))]] };
  if (p.code === 'm' && offered.has('m')) return { toast: 'Mark it as delivered? Do so when you merged or shipped it yourself.', buttons: [[btn('✅ Yes, it is delivered', e('M'))], [btn('↩︎ No', e('n'))]] };
  if (p.code === 'h' && offered.has('h'))
    return { toast: 'Reply with your hint.', ask: { text: `✍️ Your hint\nReply to this message with it: ${isGoalReview(esc) ? 'the fix tasks carry your words' : 'the task runs again with your words'}.`, placeholder: 'What should it do differently?', target: { kind: 'hint', escId: esc.id } } };
  if (p.code === 'f' && offered.has('f')) return { toast: 'Reply with what you saw.', ask: { text: '💬 Your feedback\nReply to this message with what to change. Foundry says what it makes of it before anything happens.', placeholder: 'What should change?', target: { kind: 'feedback', escId: esc.id } } };
  const code = ESC_CODES[p.code];
  const allowed = offered.has(p.code) || (CONFIRMS[p.code] != null && offered.has(CONFIRMS[p.code]!));
  if (!code || !allowed || !ACTIONS_BY_TRIGGER[esc.trigger].includes(code.action)) return { toast: 'That answer does not apply here.', buttons: keyboard };
  try {
    await host.answerEscalation(esc.id, code.action === 'retry_with_hint' ? { action: code.action, extraAttempts: 1 } : { action: code.action });
  } catch (err) {
    return { toast: clip(`Not done: ${errText(err)}`, 200), alert: true };
  }
  host.note(esc.goalId, `${code.done} ${fromVia(via)}`);
  return { toast: code.toast(esc), buttons: statusRow(`✓ ${code.done} · ${clock()}`) };
}

/** the round still waiting for answers, or why a press on it changes nothing */
function openRound(host: ActionHost, goalId: string, round: number): { goal: Goal; questions: InterviewQuestion[] } | string {
  const goal = host.goal(goalId);
  if (!goal) return 'This goal is gone.';
  const iv = goal.interview;
  const last = iv?.rounds.at(-1);
  if (goal.state !== 'clarifying' || iv?.status !== 'awaiting_answers' || !last || last.round !== round || last.answers) return 'This round is closed.';
  return { goal, questions: last.questions };
}

function pressQuestion(host: ActionHost, p: Extract<Press, { kind: 'question' }>): Outcome {
  const open = openRound(host, p.goalId, p.round);
  if (typeof open === 'string') return { toast: open, buttons: [] };
  const q = open.questions[p.index];
  if (!q) return { toast: 'This question is gone.', buttons: [] };
  if (p.option === 'own') return { toast: 'Reply with your answer.', ask: { text: `✍️ Q${p.index + 1}: ${clip(q.text, 300)}\nReply to this message with your answer.`, placeholder: 'Your answer', target: { kind: 'answer', goalId: p.goalId, round: p.round, index: p.index } } };
  const option = q.options[p.option];
  if (option == null) return { toast: 'This option is gone.' };
  host.drafts.setAnswer(p.goalId, p.round, q.key, option);
  return { toast: clip(`Q${p.index + 1}: ${option}`, 200), buttons: questionKeyboard(p.goalId, p.round, p.index, q, option) };
}

/** after a round is sent: every question shows its answer, or loses its buttons when it had none */
function closedQuestions(goalId: string, round: number, questions: InterviewQuestion[], answers: Record<string, string>): Outcome['update'] {
  return questions.map((q, index) => ({ target: { kind: 'question' as const, goalId, round, index }, buttons: answers[q.key]?.trim() ? statusRow(`✓ ${clip(answers[q.key]!.trim(), 50)}`) : [] }));
}

function pressRound(host: ActionHost, p: Extract<Press, { kind: 'round' }>, via: Via): Outcome {
  const open = openRound(host, p.goalId, p.round);
  if (typeof open === 'string') return { toast: open, buttons: [] };
  if (p.code === 'n') return { toast: 'Reply with your note.', ask: { text: `✍️ Your note for round ${p.round}\nReply to this message with what the questions missed or got wrong. It is sent with your answers and becomes a Decision.`, placeholder: 'What should Foundry know?', target: { kind: 'note', goalId: p.goalId, round: p.round } } };
  const draft = host.drafts.answers(p.goalId, p.round);
  const note = host.drafts.note(p.goalId, p.round);
  // "Accept all recommended": what was picked stays, every other question takes its first option
  const answers = p.code === 'a' ? Object.fromEntries(open.questions.map((q) => [q.key, draft[q.key]?.trim() || q.options[0] || '']).filter(([, v]) => v)) : draft;
  if (p.code !== 'e') {
    const missing = open.questions.flatMap((q, i) => (q.blocking && !answers[q.key]?.trim() ? [`Q${i + 1}`] : []));
    if (missing.length)
      return {
        toast: clip(p.code === 'a' ? `${missing.join(', ')} has no recommended answer: reply to it with yours, or press Enough.` : `Answer ${missing.join(', ')} first (blocking), or press Accept all recommended or Enough.`, 200),
        alert: true,
      };
  }
  try {
    host.answerInterview(p.goalId, answers, p.code === 'e', note);
  } catch (err) {
    return { toast: clip(`Not sent: ${errText(err)}`, 200), alert: true };
  }
  host.drafts.clearAnswers(p.goalId, p.round);
  const done = p.code === 'e' ? 'Brief asked for' : p.code === 'a' ? 'Recommended answers sent' : 'Answers sent';
  host.note(p.goalId, `interview round ${p.round}: ${done.toLowerCase()} ${fromVia(via)}`);
  return {
    toast: p.code === 'e' ? 'Enough: the Brief is written with these answers.' : 'Sent: the Clarifier goes on.',
    buttons: statusRow(`✓ ${done} · ${clock()}`),
    update: closedQuestions(p.goalId, p.round, open.questions, answers),
  };
}

async function pressBrief(host: ActionHost, p: Extract<Press, { kind: 'brief' }>, via: Via): Promise<Outcome> {
  const goal = host.goal(p.goalId);
  if (!goal) return { toast: 'This goal is gone.', buttons: [] };
  if (goal.state !== 'awaiting_brief_approval') return { toast: `The goal is ${goal.state.replace(/_/g, ' ')}: nothing to approve.`, buttons: [] };
  const brief = host.brief(p.goalId);
  if (!brief) return { toast: 'The Brief is gone.', buttons: [] };
  const left = blockingLeft(brief).length;
  if (left) return { toast: `Answer the Brief's ${left} blocking question${left === 1 ? '' : 's'} on its page first.`, buttons: [] };
  const budget = budgetOnApproval(goal, brief, host.calibration?.(goal) ?? null);
  if (p.code === 'n') return { toast: 'Not approved: the Brief waits on its page.', buttons: briefKeyboard(p.goalId, brief) };
  if (p.code === 'a')
    return { toast: clip(`Approve and run with ${budget.text}?`, 200), buttons: [[btn('✅ Yes, approve and run', `b:${p.goalId}:A`)], [btn('↩︎ Not now', `b:${p.goalId}:n`)]] };
  try {
    await host.approveBrief(p.goalId, budget.budgets);
  } catch (err) {
    return { toast: clip(`Not approved: ${errText(err)}`, 200), alert: true };
  }
  host.note(p.goalId, `Brief approved ${fromVia(via)} (${budget.text})`);
  return { toast: 'Approved: the goal starts.', buttons: statusRow(`✓ Approved · ${clock()}`) };
}

async function pressPlan(host: ActionHost, p: Extract<Press, { kind: 'plan' }>, via: Via): Promise<Outcome> {
  const draft = host.drafts.plan(p.escId);
  const esc = host.escalation(p.escId);
  if (!draft || !esc || esc.state !== 'open' || esc.trigger !== 'milestone') {
    host.drafts.setPlan(p.escId, null);
    return { toast: esc && esc.state !== 'open' ? `The milestone is ${esc.state} already.` : 'This plan is gone.', buttons: [] };
  }
  if (p.code === 'n') {
    host.drafts.setPlan(p.escId, null);
    return { toast: 'Dropped. The milestone still waits: Continue, or reply to it again.', buttons: statusRow('↩︎ Dropped') };
  }
  try {
    await host.answerEscalation(p.escId, { action: 'feedback', feedback: draft.feedback, plan: draft.plan });
  } catch (err) {
    return { toast: clip(`Not applied: ${errText(err)}`, 200), alert: true };
  }
  host.drafts.setPlan(p.escId, null);
  host.note(esc.goalId, `milestone feedback applied ${fromVia(via)}`);
  const at = clock();
  return { toast: 'Applied: the goal goes on with your feedback.', buttons: statusRow(`✓ Applied · ${at}`), update: [{ target: { kind: 'esc', id: esc.id }, buttons: statusRow(`✓ Feedback given · ${at}`) }] };
}

/** what words sent in reply to a message about `t` mean, when they mean anything */
export function textTargetOf(host: ActionHost, t: Target): TextTarget | null {
  switch (t.kind) {
    case 'question':
      return { kind: 'answer', goalId: t.goalId, round: t.round, index: t.index };
    case 'round':
      // words under the round's own message: something the questions did not ask
      return { kind: 'note', goalId: t.goalId, round: t.round };
    case 'plan':
      // new words for a plan not yet applied: Foundry reads the feedback again
      return { kind: 'feedback', escId: t.escId };
    case 'esc': {
      const esc = host.escalation(t.id);
      if (!esc) return null;
      if (esc.trigger === 'milestone') return { kind: 'feedback', escId: esc.id };
      return ACTIONS_BY_TRIGGER[esc.trigger].includes('retry_with_hint') ? { kind: 'hint', escId: esc.id } : null;
    }
    default:
      return null;
  }
}

/** how a feedback plan reads in a chat, before the person applies it */
export function renderPlan(plan: FeedbackPlan): string {
  const head = plan.kind === 'hint' ? 'a hint for the tasks still to come' : plan.kind === 'fix' ? `${plan.fixTasks.length} fix task${plan.fixTasks.length === 1 ? '' : 's'}` : 'a decision for the rest of the goal';
  const body =
    plan.kind === 'hint' ? (plan.hint ?? '') : plan.kind === 'fix' ? plan.fixTasks.map((t) => `• ${t.title}`).join('\n') : (plan.decision ?? '');
  return [`💬 Foundry makes of it: ${head}`, clip(plan.rationale.trim(), 500), clip(body.trim(), 900), 'Apply it, or Drop it: the milestone waits until you answer.'].filter(Boolean).join('\n');
}

export async function reply(host: ActionHost, target: TextTarget, text: string, via: Via): Promise<Outcome> {
  const words = text.trim();
  if (!words) return { toast: 'An empty reply changes nothing.' };
  switch (target.kind) {
    case 'hint': {
      const esc = host.escalation(target.escId);
      if (!esc || esc.state !== 'open') return { toast: esc ? `Already ${esc.state}: the hint was not used.` : 'This item is gone.', alert: true };
      try {
        await host.answerEscalation(esc.id, { action: 'retry_with_hint', hint: words, extraAttempts: 1 });
      } catch (err) {
        return { toast: clip(`Not done: ${errText(err)}`, 200), alert: true };
      }
      host.note(esc.goalId, `retried with a hint ${fromVia(via)}`);
      return { toast: isGoalReview(esc) ? 'Fix tasks with your hint run next.' : 'Retrying with your hint.', update: [{ target: { kind: 'esc', id: esc.id }, buttons: statusRow(`✓ Retried with your hint · ${clock()}`) }] };
    }
    case 'feedback': {
      const esc = host.escalation(target.escId);
      if (!esc || esc.state !== 'open' || esc.trigger !== 'milestone') return { toast: esc ? `The milestone is ${esc.state} already.` : 'This item is gone.', alert: true };
      let plan: FeedbackPlan;
      try {
        plan = await host.classifyFeedback(esc.goalId, words);
      } catch (err) {
        return { toast: clip(`Could not read the feedback: ${errText(err)}`, 200), alert: true };
      }
      host.drafts.setPlan(esc.id, { feedback: words, plan });
      return { toast: 'Here is what Foundry makes of it.', send: [{ text: renderPlan(plan), buttons: planKeyboard(esc.id), target: { kind: 'plan', escId: esc.id } }] };
    }
    case 'answer': {
      const open = openRound(host, target.goalId, target.round);
      if (typeof open === 'string') return { toast: open, alert: true };
      const q = open.questions[target.index];
      if (!q) return { toast: 'This question is gone.', alert: true };
      host.drafts.setAnswer(target.goalId, target.round, q.key, words);
      return {
        toast: `Q${target.index + 1}: noted. Press Send answers when the round is done.`,
        update: [{ target: { kind: 'question', goalId: target.goalId, round: target.round, index: target.index }, buttons: questionKeyboard(target.goalId, target.round, target.index, q, words) }],
      };
    }
    case 'note': {
      const open = openRound(host, target.goalId, target.round);
      if (typeof open === 'string') return { toast: open, alert: true };
      host.drafts.setNote(target.goalId, target.round, words);
      return {
        toast: 'Note kept. It goes with your answers: press Send answers, Accept all recommended or Enough when the round is done.',
        update: [{ target: { kind: 'round', goalId: target.goalId, round: target.round }, buttons: roundKeyboard(target.goalId, target.round, words) }],
      };
    }
  }
}

// ---------- drafts on disk ----------

interface DraftFile {
  answers: Record<string, { at: string; answers: Record<string, string>; note?: string }>;
  plans: Record<string, { at: string; feedback: string; plan: FeedbackPlan }>;
}
const KEEP = 50;

/** Drafts kept in a small JSON file, so a press after a restart still finds what was picked before it. */
export class JsonDrafts implements Drafts {
  private data: DraftFile = { answers: {}, plans: {} };
  constructor(private path: string) {
    try {
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<DraftFile>;
        this.data = { answers: raw.answers ?? {}, plans: raw.plans ?? {} };
      }
    } catch {}
  }
  answers(goalId: string, round: number): Record<string, string> {
    return { ...(this.data.answers[`${goalId}:${round}`]?.answers ?? {}) };
  }
  setAnswer(goalId: string, round: number, key: string, answer: string): void {
    const k = `${goalId}:${round}`;
    this.data.answers[k] = { ...this.data.answers[k], at: new Date().toISOString(), answers: { ...(this.data.answers[k]?.answers ?? {}), [key]: answer } };
    this.save();
  }
  note(goalId: string, round: number): string | null {
    return this.data.answers[`${goalId}:${round}`]?.note ?? null;
  }
  setNote(goalId: string, round: number, note: string | null): void {
    const k = `${goalId}:${round}`;
    const { note: _old, ...rest } = this.data.answers[k] ?? { answers: {} };
    this.data.answers[k] = { ...rest, at: new Date().toISOString(), ...(note ? { note } : {}) };
    this.save();
  }
  clearAnswers(goalId: string, round: number): void {
    delete this.data.answers[`${goalId}:${round}`];
    this.save();
  }
  plan(escId: string): { feedback: string; plan: FeedbackPlan } | null {
    const p = this.data.plans[escId];
    return p ? { feedback: p.feedback, plan: p.plan } : null;
  }
  setPlan(escId: string, value: { feedback: string; plan: FeedbackPlan } | null): void {
    if (value) this.data.plans[escId] = { at: new Date().toISOString(), ...value };
    else delete this.data.plans[escId];
    this.save();
  }
  private save(): void {
    for (const part of [this.data.answers, this.data.plans] as Record<string, { at: string }>[]) {
      const keys = Object.keys(part).sort((a, b) => part[a]!.at.localeCompare(part[b]!.at));
      for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete part[k];
    }
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(`${this.path}.tmp`, JSON.stringify(this.data));
      renameSync(`${this.path}.tmp`, this.path);
    } catch {}
  }
}
