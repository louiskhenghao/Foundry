/**
 * What every two-way Notification Channel does alike (ADR-0038): send the messages that wait for the person with their
 * buttons, send an interview round as one message per question, send again what waits (/inbox), keep the buttons
 * current when an answer comes from elsewhere, and show an answer's outcome. A channel adds how it reads presses and
 * words (Telegram's long polling, Discord's gateway) and how it sends and edits a message.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { EngineEvent, InterviewQuestion, NotificationSettings } from '@foundry/core';
import { getBrief, getGoal, isHistory, listEscalations, listGoals } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { type ActionHost, type Keyboard, type Outcome, type Target, type TextTarget, briefKeyboard, clock, escalationKeyboard, questionKeyboard, roundKeyboard, statusRow, targetKey, textTargetOf, usageKeyboard } from './actions.ts';
import type { Link } from './channels.ts';
import { composeBriefReady, composeEscalation } from './dispatcher.ts';
import { chatHost } from './host.ts';

/** what one message the bot sent is about: buttons about a target, or a prompt for words */
export interface Entry {
  t?: Target;
  ask?: TextTarget;
  at: number;
}
export interface ChatState {
  messages: Record<string, Entry>;
  /** the messages of an interview round already sent, so a retried send does not repeat them */
  rounds: Record<string, { intro?: string; questions: Record<string, string>; controls?: string }>;
}
const KEEP_MESSAGES = 500;
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** messages whose state goes with another's: a plan with its milestone, a question with its round */
const related = (t: Target): string[] => (t.kind === 'plan' ? [`esc:${t.escId}`] : t.kind === 'esc' ? [`plan:${t.id}`] : t.kind === 'question' ? [`round:${t.goalId}:${t.round}`] : []);
/** the message words in reply are about */
export const aboutText = (t: TextTarget): Target => (t.kind === 'answer' ? { kind: 'question', goalId: t.goalId, round: t.round, index: t.index } : t.kind === 'note' ? { kind: 'round', goalId: t.goalId, round: t.round } : { kind: 'esc', id: t.escId });

export abstract class ChatBot<S extends ChatState> {
  readonly host: ActionHost;
  protected running = false;
  protected state: S;
  private unsubscribe: (() => void) | null = null;
  private work = new Set<Promise<unknown>>();
  /** targets a press or a reply is answering now: their own events do not overwrite what the answer shows */
  private busy = new Map<string, number>();
  /** button changes to one message go out in order, so the last word is the last one sent */
  private edits = new Map<string, Promise<void>>();
  private statePath: string;

  /** the channel's name in the activity: "Skipped from Telegram by @ann" */
  abstract readonly channel: string;

  constructor(
    protected engine: Engine,
    file: string,
  ) {
    this.host = chatHost(engine);
    this.statePath = join(engine.config.dataDir, 'notify', file);
    this.state = this.load();
  }

  protected settings(): NotificationSettings {
    return this.engine.settings.values().notifications;
  }

  /** the reader runs and the settings let this channel answer: its messages then carry buttons */
  abstract answers(s?: NotificationSettings): boolean;
  protected abstract fresh(): S;
  /** a message with buttons (none when `kb` is empty); its id, or null when the channel gave none */
  protected abstract send(text: string, links: Link[], kb: Keyboard): Promise<string | null>;
  protected abstract editButtons(messageId: string, kb: Keyboard): Promise<void>;
  /** a plain line in the chat, answering a message of the person's when `replyTo` names one */
  protected abstract say(text: string, replyTo?: string | null): Promise<void>;
  /** the line under a message about an escalation: where its words go, or where it is approved */
  protected abstract footer(t: Extract<Target, { kind: 'esc' }>): string;
  /** a settings change (a token, a switch): read again with the new ones */
  protected abstract settingsChanged(): void;
  protected abstract startReading(): Promise<void>;
  protected abstract stopReading(): void;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.unsubscribe = this.engine.store.subscribe((e) => this.onEvent(e));
    this.track(this.startReading().catch((err) => this.engine.config.log(`[${this.channel.toLowerCase()}] the reader stopped: ${String(err)}`)));
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopReading();
    await Promise.allSettled([...this.work]);
    this.save();
  }

  // ---------- sending ----------

  /** a message about `t`, with its buttons; a line says how else it is answered */
  async sendAbout(t: Target, text: string, links: Link[]): Promise<void> {
    switch (t.kind) {
      case 'esc': {
        const esc = this.host.escalation(t.id);
        // answered before the message went: the usual message, without buttons
        if (!esc || esc.state !== 'open') return void (await this.post(text, links, [], null));
        await this.post([text, this.footer(t)].filter(Boolean).join('\n'), links, escalationKeyboard(esc), t);
        return;
      }
      case 'brief': {
        const waiting = this.host.goal(t.goalId)?.state === 'awaiting_brief_approval';
        await this.post(text, links, waiting ? briefKeyboard(t.goalId, this.host.brief(t.goalId)) : [], waiting ? t : null);
        return;
      }
      case 'round':
        return this.sendRound(t.goalId, t.round, links);
      case 'usage':
        await this.post(text, links, usageKeyboard(t.provider), t);
        return;
      default:
        await this.post(text, links, [], null);
    }
  }

  protected async post(text: string, links: Link[], kb: Keyboard, t: Target | null): Promise<string | null> {
    const id = await this.send(text, links, kb);
    if (id != null && t) {
      this.remember(id, { t });
      this.save();
    }
    return id;
  }

  /**
   * An interview round: a line on what to do, one message per question with its options, then the round's buttons
   * (Accept all recommended, Send answers, Enough). A send that failed half-way goes on where it stopped; `again`
   * (sending what waits once more) sends the whole round anew.
   */
  protected async sendRound(goalId: string, round: number, links: Link[], again = false): Promise<void> {
    const goal = this.host.goal(goalId);
    const r = goal?.interview?.rounds.find((x) => x.round === round);
    if (!goal || !r || r.answers) return;
    const key = `${goalId}:${round}`;
    const sent = again ? { questions: {} as Record<string, string> } : (this.state.rounds[key] ??= { questions: {} });
    const n = r.questions.length;
    if (sent.intro == null)
      sent.intro = (await this.post(`❓ Round ${round} — ${goal.title}\n${n} question${n === 1 ? '' : 's'} before the plan is written. ${this.roundHint()}`, links, [], null)) ?? undefined;
    const draft = this.host.drafts.answers(goalId, round);
    for (const [i, q] of r.questions.entries()) {
      if (sent.questions[i] != null) continue;
      const id = await this.post(questionText(i, q), [], questionKeyboard(goalId, round, i, q, draft[q.key] ?? null), { kind: 'question', goalId, round, index: i });
      if (id != null) sent.questions[i] = id;
    }
    if (sent.controls == null) sent.controls = (await this.post(`Round ${round}: when you are done`, [], roundKeyboard(goalId, round, this.host.drafts.note(goalId, round)), { kind: 'round', goalId, round })) ?? undefined;
    this.save();
  }

  /** how a round is answered in this channel, after "N questions before the plan is written." */
  protected roundHint(): string {
    return 'Tap an answer under each (⭐ recommended), or ✍️ for your own, then use the buttons at the end.';
  }

  /** what waits for the person, sent again with its buttons (at most eight, then how many more) */
  protected async sendInbox(): Promise<void> {
    const db = this.engine.store.db;
    const s = this.settings();
    const title = (id: string | null) => (id ? (getGoal(db, id)?.title ?? id) : '');
    const goals = listGoals(db).filter((g) => !isHistory(g));
    const live = new Set(goals.map((g) => g.id));
    const escs = listEscalations(db, { openOnly: true }).filter((e) => live.has(e.goalId));
    const briefs = goals.flatMap((g) => {
      if (g.state !== 'awaiting_brief_approval') return [];
      const c = composeBriefReady(g, getBrief(db, g.id)?.brief ?? null, 'inbox');
      return c ? [{ goal: g, c }] : [];
    });
    const rounds = goals.filter((g) => g.state === 'clarifying' && g.interview?.status === 'awaiting_answers');
    const total = escs.length + briefs.length + rounds.length;
    if (!total) return this.say('✓ Nothing waits for you.');
    const MAX = 8;
    let shown = 0;
    for (const e of escs) {
      if (shown++ >= MAX) break;
      const c = composeEscalation(e, title);
      const preview = e.trigger === 'milestone' ? ((e.payload as { previewUrl?: string | null }).previewUrl ?? null) : null;
      await this.sendAbout({ kind: 'esc', id: e.id }, c.text, await this.engine.notifications.links(s, c.path, preview));
    }
    for (const { goal, c } of briefs) {
      if (shown++ >= MAX) break;
      await this.sendAbout({ kind: 'brief', goalId: goal.id }, c.text, await this.engine.notifications.links(s, c.path));
    }
    for (const g of rounds) {
      if (shown++ >= MAX) break;
      await this.sendRound(g.id, g.interview!.rounds.at(-1)!.round, await this.engine.notifications.links(s, `/goals/${g.id}`), true);
    }
    if (total > MAX) await this.say(`…and ${total - MAX} more in the Inbox.`);
  }

  /** the outcome of a press or of words: the pressed message's buttons, messages to send, other messages to change */
  protected async apply(out: Outcome, pressed: string | null): Promise<void> {
    if (pressed != null && out.buttons) await this.setButtons(pressed, out.buttons);
    for (const m of out.send ?? []) await this.post(m.text, [], m.buttons, m.target);
    for (const u of out.update ?? []) for (const id of this.messagesAbout(u.target)) await this.setButtons(id, u.buttons);
    this.save();
  }

  // ---------- keeping messages current ----------

  /** an answer from the web UI (or the engine) closes the buttons of the messages about it */
  private onEvent(e: EngineEvent): void {
    if (e.type === 'settings.changed') {
      if (e.payload.keys.some((k) => k.startsWith('notifications.'))) this.settingsChanged();
      return;
    }
    if (!this.answers() || !Object.keys(this.state.messages).length) return;
    const at = clock();
    switch (e.type) {
      case 'escalation.answered':
        this.settle({ kind: 'esc', id: e.payload.escalationId }, statusRow(`✓ Answered · ${at}`));
        this.settle({ kind: 'plan', escId: e.payload.escalationId }, []);
        return;
      case 'interview.round_answered': {
        const round: Target = { kind: 'round', goalId: e.goalId!, round: e.payload.round };
        if (this.held(round)) return;
        this.settle(round, statusRow(`✓ Answered · ${at}`));
        for (const [id, entry] of Object.entries(this.state.messages))
          if (entry.t?.kind === 'question' && entry.t.goalId === e.goalId && entry.t.round === e.payload.round) this.track(this.setButtons(id, []));
        return;
      }
      case 'brief.approved':
        this.settle({ kind: 'brief', goalId: e.goalId! }, statusRow(`✓ Approved · ${at}`));
        return;
      case 'rate_limit.resumed':
        this.settle({ kind: 'usage', provider: e.payload.provider ?? this.engine.config.provider }, statusRow(`✓ Resumed · ${at}`));
        return;
    }
  }

  private settle(t: Target, kb: Keyboard): void {
    if (this.held(t)) return;
    for (const id of this.messagesAbout(t)) this.track(this.setButtons(id, kb));
  }

  /** mark targets as being answered here until the returned release is called */
  protected hold(ts: Target[]): () => void {
    const keys = ts.flatMap((t) => [targetKey(t), ...related(t)]);
    for (const k of keys) this.busy.set(k, (this.busy.get(k) ?? 0) + 1);
    return () => {
      for (const k of keys) {
        const n = (this.busy.get(k) ?? 1) - 1;
        if (n > 0) this.busy.set(k, n);
        else this.busy.delete(k);
      }
    };
  }
  private held(t: Target): boolean {
    return this.busy.has(targetKey(t));
  }

  protected messagesAbout(t: Target): string[] {
    const key = targetKey(t);
    return Object.entries(this.state.messages)
      .filter(([, e]) => e.t && targetKey(e.t) === key)
      .map(([id]) => id);
  }

  protected setButtons(messageId: string, kb: Keyboard): Promise<void> {
    const prev = this.edits.get(messageId) ?? Promise.resolve();
    const next = prev.then(() =>
      this.editButtons(messageId, kb).catch((err) => {
        if (!/not modified/i.test(String(err))) this.engine.config.log(`[${this.channel.toLowerCase()}] could not update message ${messageId}: ${String(err)}`);
      }),
    );
    this.edits.set(messageId, next);
    void next.then(() => {
      if (this.edits.get(messageId) === next) this.edits.delete(messageId);
    });
    return next;
  }

  /** what words in reply to a message mean: what Foundry remembers of it, else what its buttons are about */
  protected textTargetFor(messageId: string, fromButtons: Target | null): TextTarget | null {
    const entry = this.state.messages[messageId];
    if (entry?.ask) return entry.ask;
    const t = entry?.t ?? fromButtons;
    return t ? textTargetOf(this.host, t) : null;
  }

  protected via(who: string | null) {
    return { channel: this.channel, who };
  }

  // ---------- state ----------

  protected remember(messageId: string, entry: Omit<Entry, 'at'>): void {
    this.state.messages[messageId] = { ...entry, at: Date.now() };
  }

  protected track(p: Promise<unknown>): void {
    this.work.add(p);
    void p.finally(() => this.work.delete(p));
  }

  private load(): S {
    try {
      if (existsSync(this.statePath)) return { ...this.fresh(), ...(JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<S>) };
    } catch {}
    return this.fresh();
  }

  protected save(): void {
    const ids = Object.keys(this.state.messages);
    if (ids.length > KEEP_MESSAGES) {
      ids.sort((a, b) => this.state.messages[a]!.at - this.state.messages[b]!.at);
      for (const id of ids.slice(0, ids.length - KEEP_MESSAGES)) delete this.state.messages[id];
      for (const [k, r] of Object.entries(this.state.rounds)) if (r.controls != null && !this.state.messages[r.controls]) delete this.state.rounds[k];
    }
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      writeFileSync(`${this.statePath}.tmp`, JSON.stringify(this.state));
      renameSync(`${this.statePath}.tmp`, this.statePath);
    } catch {}
  }
}

/** a question as its own message: the number and whether it blocks, the question, why it is asked */
export function questionText(index: number, q: InterviewQuestion): string {
  return [`Q${index + 1}${q.blocking ? ' · blocking' : ''}`, clip(q.text, 700), q.reason.trim() ? `Why: ${clip(q.reason.trim(), 300)}` : ''].filter(Boolean).join('\n');
}
