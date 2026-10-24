/**
 * Conversations on goals' pages (ADR-0073): the person asks about a goal, and the Explainer — a read-only session of the
 * goal's coding agent on the preset's Conversation row — answers from the goal's code and Foundry's records of it. One
 * session per Conversation, resumed turn by turn (a fresh one is given the conversation so far when the coding agent
 * cannot pick it up); questions sent while an answer is being written wait their turn; the answers stream on a channel
 * of their own and are kept as events, with what they cost on the goal but outside its budget. Nothing here takes a
 * slot from the goal's work, and nothing the Explainer does changes the goal.
 */
import type { Attachment } from '@foundry/core';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONVERSATION_ATTACHMENTS_MAX, CONVERSATION_FILES_ONLY_TEXT, CONVERSATION_QUESTION_MAX, IdPrefix, getConversation, getGoal, isHistory, listConversations, listGoals, newId, pendingQuestions, reportsDollars, type AnswerStatus, type Conversation, type Goal, parseProposalBlocks } from '@foundry/core';
import { resumeRefused, type RunHandle, type RunResult } from '@foundry/runner';
import { attachmentsDir } from '../attachments.ts';
import type { Engine } from '../engine.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundaryEnv, explainerSettings } from '../guards/boundary.ts';
import { MCP_SERVER_PREFIX } from '../memory/memory.ts';
import { metaFor, modelFor } from '../models/roles.ts';
import { AttachmentError, claimStaged } from '../attachments.ts';
import { conversationSoFar, openingPrompt, turnPrompt } from './prompt.ts';
import { applyProposal } from './proposals.ts';
import { describeEvents, goalSummary, writeGoalRecords, writeQuestionFiles } from './records.ts';
import { conversationWorkspacePath, prepareConversationWorkspace, removeConversationWorkspace } from './workspace.ts';

/** one answer's room: enough to read a few dozen files and a transcript or two, wider than a Suggestion, narrower than a second opinion */
export const CONVERSATION_MAX_TURNS = 50;
export const CONVERSATION_MAX_BUDGET_USD = 3;
export const CONVERSATION_TIMEOUT_MS = 8 * 60_000;
export const CONVERSATION_IDLE_TIMEOUT_MS = 3 * 60_000;
/** a worktree no question touched for this long is removed; the next question makes it again at the same path */
export const CONVERSATION_WORKTREE_IDLE_MS = 24 * 3600_000;
const SWEEP_MS = 30 * 60_000;
/** the live channel of a Conversation: every answer's events, and its transcript's name */
export const conversationChannel = (conversationId: string) => `conversation-${conversationId}`;
/** a session stopped by its own cap: the answer as far as it got, said so */
const CUT = new Set(['error_max_turns', 'error_max_budget_usd', 'killed_timeout', 'killed_idle']);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const cutReason = (subtype: string) => (subtype === 'error_max_turns' ? 'the answer ran out of turns' : subtype === 'error_max_budget_usd' ? 'the answer ran out of budget' : subtype === 'killed_timeout' ? 'the answer ran out of time' : 'the session went quiet for too long');

/** what a request could not do, with the HTTP status the API answers with */
export class ConversationError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
  }
}

export interface ConversationLive {
  /** the question being answered now */
  answering: string | null;
  /** the questions waiting their turn, in order */
  queued: string[];
}
export interface ConversationsView {
  enabled: boolean;
  conversations: Conversation[];
  live: Record<string, ConversationLive>;
}

interface Running {
  messageId: string;
  handle: RunHandle | null;
  /** the person pressed Stop before the session had a process */
  stopAsked: boolean;
  done: Promise<void>;
}

export class Conversations {
  private running = new Map<string, Running>();
  private queues = new Map<string, string[]>();
  /** goals deleted while an answer ran: nothing more is written for them */
  private gone = new Set<string>();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private ending = false;
  constructor(private engine: Engine) {}

  /** Settings → Beta → Conversation */
  enabled(): boolean {
    return this.engine.config.betaConversation;
  }

  view(goalId: string): ConversationsView {
    const conversations = listConversations(this.engine.store.db, goalId);
    const live: Record<string, ConversationLive> = {};
    for (const c of conversations) live[c.id] = { answering: this.running.get(c.id)?.messageId ?? null, queued: [...(this.queues.get(c.id) ?? [])] };
    return { enabled: this.enabled(), conversations, live };
  }

  /**
   * A question: into the Conversation named, the goal's newest one, or a new one (`fresh`). Recorded at once and
   * answered in the background, on the channel the answer streams on; a question that arrives while another is being
   * answered waits its turn.
   */
  ask(goalId: string, text: string, opts: { by?: string | null; conversationId?: string | null; fresh?: boolean; /** staged uploads (and links) the person put on the question, as the upload answered them */ attachments?: Attachment[] } = {}): { conversationId: string; messageId: string; channel: string } {
    const { store, config } = this.engine;
    const goal = getGoal(store.db, goalId);
    if (!goal) throw new ConversationError('goal not found', 404);
    if (!this.enabled()) throw new ConversationError('the Conversation is off: Settings → Beta switches it on', 409);
    const staged = opts.attachments ?? [];
    if (staged.length > CONVERSATION_ATTACHMENTS_MAX) throw new ConversationError(`a question takes at most ${CONVERSATION_ATTACHMENTS_MAX} attachments`, 400);
    const question = text.trim() || (staged.length ? CONVERSATION_FILES_ONLY_TEXT : '');
    if (!question) throw new ConversationError('ask something', 400);
    if (question.length > CONVERSATION_QUESTION_MAX) throw new ConversationError(`a question is at most ${CONVERSATION_QUESTION_MAX} characters`, 400);
    const provider = goal.provider ?? config.provider;
    if (this.engine.isRateLimited(provider)) throw new ConversationError(`the ${provider} usage limit pauses new sessions until ${this.engine.rateLimitedUntilIso(provider)}`, 409);
    let conversation: Conversation | null = null;
    if (opts.conversationId) {
      conversation = getConversation(store.db, opts.conversationId);
      if (!conversation || conversation.goalId !== goalId) throw new ConversationError('conversation not found', 404);
    } else if (!opts.fresh) conversation = listConversations(store.db, goalId).at(-1) ?? null;
    const by = opts.by ?? null;
    if (!conversation) {
      const id = newId(IdPrefix.conversation);
      store.append({ type: 'conversation.started', goalId, payload: { conversationId: id, by } });
      conversation = getConversation(store.db, id)!;
    }
    const messageId = newId(IdPrefix.message);
    // the uploads move from staging to the goal's attachments folder, as a goal's own do; the records keep the final paths
    let attachments: Attachment[] = [];
    try {
      attachments = staged.length ? claimStaged(config.dataDir, goalId, staged.map((a) => this.engine.stagedView(a.id) ?? a), goal.attachments.length) : [];
    } catch (e) {
      if (e instanceof AttachmentError) throw new ConversationError(e.message, 400);
      throw e;
    }
    store.append({ type: 'conversation.asked', goalId, payload: { conversationId: conversation.id, messageId, text: question, by, attachments } });
    const queue = this.queues.get(conversation.id) ?? [];
    queue.push(messageId);
    this.queues.set(conversation.id, queue);
    this.pump(conversation.id);
    return { conversationId: conversation.id, messageId, channel: conversationChannel(conversation.id) };
  }

  /** the person applies what the Explainer proposed (ADR-0075); what came of it, in a few words */
  async apply(goalId: string, conversationId: string, proposalId: string, by: string | null): Promise<string> {
    const goal = getGoal(this.engine.store.db, goalId);
    if (!goal) throw new ConversationError('goal not found', 404);
    const c = getConversation(this.engine.store.db, conversationId);
    if (!c || c.goalId !== goalId) throw new ConversationError('conversation not found', 404);
    const m = c.messages.find((x) => (x.proposals ?? []).some((p) => p.id === proposalId));
    const p = m?.proposals?.find((x) => x.id === proposalId);
    if (!m || !p) throw new ConversationError('proposal not found', 404);
    return applyProposal(this.engine, goal, c, m, p, by);
  }

  /** the person pressed Stop: the answer being written ends where it is, and the questions waiting their turn are let go; false when nothing was running */
  stopAnswer(conversationId: string): boolean {
    const c = getConversation(this.engine.store.db, conversationId);
    if (!c) throw new ConversationError('conversation not found', 404);
    const entry = this.running.get(conversationId);
    const queued = this.queues.get(conversationId) ?? [];
    if (!entry && !queued.length) return false;
    this.queues.set(conversationId, []);
    for (const askedId of queued) this.engine.store.append({ type: 'conversation.answered', goalId: c.goalId, payload: { conversationId, messageId: newId(IdPrefix.message), askedId, text: '', status: 'stopped', reason: 'stopped before it was answered', costUsd: 0, costAvailable: false, model: null, sessionId: null, durationMs: 0 } });
    if (entry) {
      entry.stopAsked = true;
      entry.handle?.kill('killed_manual');
    }
    return true;
  }

  /** at the engine's start: the questions left unanswered when it stopped are answered now; idle worktrees are swept from here on */
  start(): void {
    const db = this.engine.store.db;
    for (const g of listGoals(db)) {
      if (isHistory(g)) continue;
      for (const c of listConversations(db, g.id)) {
        const pending = pendingQuestions(c);
        if (!pending.length) continue;
        this.queues.set(c.id, pending.map((m) => m.id));
        this.pump(c.id);
      }
    }
    if (!this.sweeper) {
      this.sweeper = setInterval(() => void this.sweep(), SWEEP_MS);
      (this.sweeper as { unref?: () => void }).unref?.();
    }
  }

  /** the engine stops: an answer in flight ends with it and its question stays asked, for the next start */
  async shutdown(): Promise<void> {
    this.ending = true;
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
    for (const r of this.running.values()) r.handle?.kill('killed_manual');
    const work = [...this.running.values()].map((r) => r.done);
    if (!work.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.allSettled(work), new Promise((res) => (timer = setTimeout(res, 5_000)))]);
    clearTimeout(timer);
  }

  /** the goal goes: its answers in flight end, its questions are forgotten, and its folders are removed */
  async onGoalDeleted(goal: Goal): Promise<void> {
    this.gone.add(goal.id);
    for (const c of listConversations(this.engine.store.db, goal.id)) {
      this.queues.delete(c.id);
      this.running.get(c.id)?.handle?.kill('killed_manual');
    }
    await removeConversationWorkspace(this.engine.config.dataDir, goal).catch(() => {});
  }

  /** the next question of a Conversation, when none is being answered */
  private pump(conversationId: string): void {
    if (this.ending || this.running.has(conversationId) || !this.enabled()) return;
    const next = this.queues.get(conversationId)?.shift();
    if (!next) return;
    const entry: Running = { messageId: next, handle: null, stopAsked: false, done: Promise.resolve() };
    this.running.set(conversationId, entry);
    entry.done = this.answer(conversationId, next, entry)
      .catch((err) => this.engine.config.log(`[conversation] ${conversationId}: ${String((err as Error).message ?? err)}`))
      .finally(() => {
        this.running.delete(conversationId);
        this.pump(conversationId);
      });
  }

  private async answer(conversationId: string, askedId: string, entry: Running): Promise<void> {
    const { store, config } = this.engine;
    const c0 = getConversation(store.db, conversationId);
    const goal = c0 ? getGoal(store.db, c0.goalId) : null;
    const asked = c0?.messages.find((m) => m.id === askedId && m.role === 'person');
    if (!c0 || !goal || !asked) return;
    const channel = conversationChannel(conversationId);
    const say = (text: string) => this.engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: { kind: 'text', text }, ts: new Date().toISOString() });
    const provider = goal.provider ?? config.provider;
    const row = modelFor(config, goal, 'explainer');
    const started = Date.now();
    let sessionId: string | null = null;
    let model: string | null = null;
    let said: string[] = [];
    let live = '';
    const settle = (status: AnswerStatus, text: string, reason: string | null, r: RunResult | null) => {
      // the engine is stopping (the question stays asked, for the next start) or the goal went: nothing more is written
      if (this.ending || this.gone.has(goal.id)) return;
      // what the Explainer proposed, as cards the person applies (ADR-0075); only a finished answer proposes
      const proposals = status === 'done' ? parseProposalBlocks(text).map((p) => ({ ...p, id: newId(IdPrefix.proposal), applied: null })) : [];
      store.append({
        type: 'conversation.answered',
        goalId: goal.id,
        payload: { conversationId, messageId: newId(IdPrefix.message), askedId, text, status, reason, proposals, costUsd: r?.costUsd ?? 0, costAvailable: !!r && reportsDollars(provider) && r.costStatus !== 'unavailable', model: model ?? row.model, sessionId: r?.sessionId ?? sessionId, durationMs: Date.now() - started },
      });
    };
    try {
      say('— reading the goal: a read-only checkout of its code and Foundry\'s records of it are being prepared…');
      const place = await prepareConversationWorkspace(this.engine, goal);
      writeGoalRecords(this.engine, goal, place.cwd);
      writeQuestionFiles(this.engine, goal, c0.messages, place.cwd);
      if (entry.stopAsked) return settle('stopped', '', 'stopped before it was answered', null);
      const prior = c0.messages.filter((m) => m.id !== askedId);
      // the session goes on where an earlier answer left it; a Conversation whose answers all failed starts anew
      const resumable = !!c0.sessionId && prior.some((m) => m.role === 'explainer' && m.status !== 'failed');
      const lastAnswer = store.listByGoalOfTypes(goal.id, ['conversation.answered']).filter((e) => e.type === 'conversation.answered' && e.payload.conversationId === conversationId).at(-1);
      const policy = this.engine.mcpToolPolicy(provider, this.engine.mcpAllowedFor(goal));
      // Memory's tools reach the Explainer when the person installed its server and allowed it in goals (ADR-0072)
      const bank = policy.allowed.includes(MCP_SERVER_PREFIX) ? await this.engine.memory.bankFor(goal.repoPath) : null;
      const opening = () => openingPrompt({ goal, summary: goalSummary(this.engine, goal), place, question: asked.text, asked, history: conversationSoFar(prior), memoryBank: bank });
      const delta = resumable ? describeEvents(this.engine, goal, store.listByGoal(goal.id, 5000).filter((e) => e.seq > (lastAnswer?.seq ?? 0))) : [];
      const run = async (prompt: string, resume: string | undefined): Promise<RunResult> => {
        const handle = await this.engine.runner.run({
          prompt,
          cwd: place.cwd,
          model: row.model,
          meta: metaFor(goal.id, row),
          maxTurns: CONVERSATION_MAX_TURNS,
          maxBudgetUsd: CONVERSATION_MAX_BUDGET_USD,
          permissionMode: 'dontAsk',
          allowedTools: [...READONLY_TOOLS, ...policy.allowed.filter((p) => p.startsWith('mcp__'))],
          disallowedTools: [...READONLY_DISALLOWED, ...(policy.denied ?? [])],
          appendSystemPromptFile: this.engine.roles.path('explainer'),
          settings: explainerSettings(config.hooksDir),
          settingSources: config.settingSources,
          addDirs: goal.attachments.length ? [attachmentsDir(config.dataDir, goal.id)] : undefined,
          resumeSessionId: resume,
          timeoutMs: CONVERSATION_TIMEOUT_MS,
          idleTimeoutMs: CONVERSATION_IDLE_TIMEOUT_MS,
          transcriptPath: join(config.dataDir, 'transcripts', `${channel}.jsonl`),
          env: boundaryEnv(config, goal.id),
          label: `conversation ${goal.title}`,
          // beside the limit: a question never waits for a worker, nor takes its slot
          lane: 'aside',
          partialText: true,
          readOnlyShell: true,
        });
        entry.handle = handle;
        if (entry.stopAsked) handle.kill('killed_manual');
        for await (const ev of handle.events) {
          if (ev.kind === 'init') {
            sessionId = ev.sessionId || sessionId;
            model = ev.model ?? model;
          } else if (ev.kind === 'text_delta') live += ev.text;
          else if (ev.kind === 'text') {
            said.push(ev.text);
            live = '';
          }
          this.engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: ev, ts: new Date().toISOString() });
        }
        const result = await handle.result;
        if (!this.gone.has(goal.id)) {
          store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source: 'conversation' } });
          this.engine.recordSessionUsage(result, { goalId: goal.id, kind: 'conversation', model: row.model });
        }
        return result;
      };
      let result = await run(resumable ? turnPrompt({ delta, question: asked.text, asked }) : opening(), resumable ? c0.sessionId! : undefined);
      if (resumable && resumeRefused(result) && !this.ending && !entry.stopAsked) {
        say('— the earlier session could not be resumed; a fresh one is given the conversation so far…');
        said = [];
        live = '';
        result = await run(opening(), undefined);
      }
      const text = (result.subtype === 'success' && result.finalText?.trim()) || [...said, live].filter((t) => t.trim()).join('\n\n').trim();
      const status: AnswerStatus = result.subtype === 'success' ? 'done' : result.subtype === 'killed_manual' ? 'stopped' : CUT.has(result.subtype) ? 'cut' : 'failed';
      const reason = status === 'done' ? null : status === 'stopped' ? 'stopped by the person' : status === 'cut' ? cutReason(result.subtype) : clip(result.errorMessage ?? result.subtype, 500);
      settle(status, text, reason, result);
    } catch (err) {
      settle('failed', [...said, live].filter((t) => t.trim()).join('\n\n').trim(), clip(String((err as Error).message ?? err), 500), null);
    }
  }

  /** the worktrees of goals nobody asked about for a day go; the next question makes them again */
  private async sweep(): Promise<void> {
    const db = this.engine.store.db;
    const now = Date.now();
    for (const g of listGoals(db)) {
      const cs = listConversations(db, g.id);
      if (!cs.length || cs.some((c) => this.running.has(c.id))) continue;
      if (now - Math.max(...cs.map((c) => Date.parse(c.updatedAt))) < CONVERSATION_WORKTREE_IDLE_MS) continue;
      if (!existsSync(conversationWorkspacePath(this.engine.config.dataDir, g))) continue;
      await removeConversationWorkspace(this.engine.config.dataDir, g).catch(() => {});
    }
  }
}
