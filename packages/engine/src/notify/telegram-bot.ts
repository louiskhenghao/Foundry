/**
 * Telegram as a two-way channel (ADR-0038). Foundry reads its bot's updates by long polling (`getUpdates`, so no public
 * address is needed) and acts on the button presses and the replies that come from the configured chat, through
 * notify/actions.ts. Updates from any other chat are ignored. When something else reads the same bot (a second Foundry,
 * a webhook), Telegram refuses the poll; that is noted once and waited out. Off with `notifications.telegramActions`, or
 * without a token and a chat; only the `serve` engine reads.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { EngineEvent, InterviewQuestion, NotificationSettings } from '@foundry/core';
import { getBrief, getGoal, isHistory, listEscalations, listGoals } from '@foundry/core';
import type { Engine } from '../engine.ts';
import {
  type ActionHost,
  type Keyboard,
  type Outcome,
  type Target,
  type TextTarget,
  JsonDrafts,
  briefKeyboard,
  clock,
  escalationKeyboard,
  parsePress,
  press,
  pressTarget,
  questionKeyboard,
  reply,
  roundKeyboard,
  statusRow,
  targetKey,
  textTargetOf,
  usageKeyboard,
} from './actions.ts';
import { TELEGRAM_API, TelegramNotifier, type Link } from './channels.ts';
import { composeBriefReady, composeEscalation } from './dispatcher.ts';
import { engineHost } from './host.ts';

interface TgChat {
  id: number;
  title?: string;
  username?: string;
  first_name?: string;
}
interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
}
interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  reply_to_message?: TgMessage;
  reply_markup?: { inline_keyboard?: { callback_data?: string }[][] };
}
interface TgCallback {
  id: string;
  from?: TgUser;
  message?: TgMessage;
  data?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallback;
}
type TgReply = { ok?: boolean; result?: unknown; description?: string } | null;

/** what one message the bot sent is about: buttons about a target, or a prompt for words */
interface Entry {
  t?: Target;
  ask?: TextTarget;
  at: number;
}
interface BotState {
  /** the bot and the chat the rest belongs to, as hashes (the token is not written twice) */
  bot: string | null;
  chat: string | null;
  /** the next update to read: Telegram forgets an update once a poll asks past it */
  offset: number;
  messages: Record<string, Entry>;
  /** the messages of an interview round already sent, so a retried send does not repeat them */
  rounds: Record<string, { intro?: number; questions: Record<string, number>; controls?: number }>;
  /** the chat that last wrote to the bot (Settings → Detect asks for it while Foundry reads the updates) */
  seen: { bot: string; chatId: string; who: string } | null;
}
const fresh = (): BotState => ({ bot: null, chat: null, offset: 0, messages: {}, rounds: {}, seen: null });
const KEEP_MESSAGES = 500;
const JSON_HEADERS = { 'content-type': 'application/json' };
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const inline = (kb: Keyboard) => ({ inline_keyboard: kb.map((row) => row.map((b) => ({ text: b.label, callback_data: b.data }))) });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const TELEGRAM_HELP = [
  'Foundry answers here.',
  '• The buttons under a message answer it, as the Inbox does.',
  '• Reply to a message to answer in words: a hint for a task, feedback on a milestone, your own answer to a question.',
  '• /inbox sends again what waits for you.',
  'A command outside the workspace is approved in the Inbox only.',
].join('\n');

/** messages whose state goes with another's: a plan with its milestone, a question with its round */
const related = (t: Target): string[] => (t.kind === 'plan' ? [`esc:${t.escId}`] : t.kind === 'esc' ? [`plan:${t.id}`] : t.kind === 'question' ? [`round:${t.goalId}:${t.round}`] : []);
/** the message words in reply are about */
const aboutText = (t: TextTarget): Target => (t.kind === 'answer' ? { kind: 'question', goalId: t.goalId, round: t.round, index: t.index } : { kind: 'esc', id: t.escId });

export interface TelegramBotOptions {
  api?: string;
  /** how long Telegram holds a poll open when nothing comes (seconds) */
  pollSec?: number;
  /** how long the reader rests while it is off (a settings change wakes it) */
  idleMs?: number;
  /** the wait after Telegram said something else reads the bot */
  conflictMs?: number;
  /** the wait after Telegram refused the token */
  refusedMs?: number;
  /** waits after network failures, one per failure in a row (the last repeats) */
  retryMs?: number[];
  /** a press that takes longer is acknowledged at once ("Working on it…") */
  slowMs?: number;
}

export class TelegramBot {
  readonly drafts: JsonDrafts;
  readonly host: ActionHost;
  private api: string;
  private running = false;
  private loopDone: Promise<void> = Promise.resolve();
  private poll: AbortController | null = null;
  /** a settings change aborted the poll: read again with the new settings, no failure */
  private repoll = false;
  private wake: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private work = new Set<Promise<unknown>>();
  /** targets a press or a reply is answering now: their own events do not overwrite what the answer shows */
  private busy = new Map<string, number>();
  /** button changes to one message go out in order, so the last word is the last one sent */
  private edits = new Map<number, Promise<void>>();
  private noted: string | null = null;
  private state: BotState;
  private statePath: string;

  constructor(
    private engine: Engine,
    private opts: TelegramBotOptions = {},
  ) {
    this.api = opts.api ?? TELEGRAM_API;
    const dir = join(engine.config.dataDir, 'notify');
    this.statePath = join(dir, 'telegram.json');
    this.drafts = new JsonDrafts(join(dir, 'drafts.json'));
    this.host = engineHost(engine, this.drafts);
    this.state = this.load();
  }

  private settings(): NotificationSettings {
    return this.engine.settings.values().notifications;
  }

  /** the reader runs and the settings let it answer: messages then carry buttons */
  answers(s: NotificationSettings = this.settings()): boolean {
    return this.running && !!(s.telegramActions && s.telegramBotToken && s.telegramChatId);
  }

  /** Foundry reads this token's updates now: Telegram hands a new chat's first message to it, not to Detect */
  reads(token: string): boolean {
    return this.answers() && this.settings().telegramBotToken === token;
  }

  /** the chat that last wrote to the bot of this token, as Foundry saw it */
  seenChat(token: string): { chatId: string; who: string } | null {
    const seen = this.state.seen;
    return seen && seen.bot === hash(token) ? { chatId: seen.chatId, who: seen.who } : null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.unsubscribe = this.engine.store.subscribe((e) => this.onEvent(e));
    this.loopDone = this.loop().catch((err) => this.engine.config.log(`[telegram] the reader stopped: ${String(err)}`));
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.poll?.abort();
    this.wake?.();
    await this.loopDone;
    await Promise.allSettled([...this.work]);
    this.save();
  }

  // ---------- reading ----------

  private async loop(): Promise<void> {
    let failures = 0;
    while (this.running) {
      const s = this.settings();
      if (!this.answers(s)) {
        await this.sleep(this.opts.idleMs ?? 60_000);
        continue;
      }
      const token = s.telegramBotToken!;
      this.adopt(token, s.telegramChatId!);
      const pollSec = this.opts.pollSec ?? 50;
      const ac = (this.poll = new AbortController());
      const timer = setTimeout(() => ac.abort(), (pollSec + 15) * 1000);
      (timer as { unref?: () => void }).unref?.();
      let res: Response | null = null;
      let body: TgReply = null;
      try {
        res = await fetch(`${this.api}/bot${token}/getUpdates`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ offset: this.state.offset, timeout: pollSec, allowed_updates: ['message', 'callback_query'] }), signal: ac.signal });
        body = (await res.json().catch(() => null)) as TgReply;
      } catch {
        res = null;
      } finally {
        clearTimeout(timer);
        this.poll = null;
      }
      if (!this.running) break;
      if (!res) {
        if (this.repoll) this.repoll = false;
        else await this.sleep(this.backoff(++failures));
        continue;
      }
      if (!res.ok || !body?.ok) {
        const why = body?.description ?? `HTTP ${res.status}`;
        if (res.status === 409) {
          this.problem(
            /webhook/i.test(why)
              ? `Telegram buttons wait: this bot sends its updates to a webhook (${why}). Remove the webhook, or give Foundry a bot of its own.`
              : `Telegram buttons wait: something else reads this bot's updates (${why}). Give each Foundry a bot of its own; Foundry tries again every minute.`,
          );
          await this.sleep(this.opts.conflictMs ?? 60_000);
        } else if (res.status === 401 || res.status === 404) {
          this.problem(`Telegram buttons are off: Telegram refused the bot token (${why}).`);
          await this.sleep(this.opts.refusedMs ?? 300_000);
        } else await this.sleep(this.backoff(++failures));
        continue;
      }
      failures = 0;
      this.noted = null;
      const updates = Array.isArray(body.result) ? (body.result as TgUpdate[]) : [];
      for (const u of updates) {
        this.state.offset = Math.max(this.state.offset, u.update_id + 1);
        this.track(this.handle(u, s).catch((err) => this.engine.config.log(`[telegram] update ${u.update_id}: ${String(err)}`)));
      }
      if (updates.length) this.save();
    }
  }

  private backoff(failures: number): number {
    const steps = this.opts.retryMs ?? [2_000, 5_000, 15_000, 60_000];
    return steps[Math.min(failures, steps.length) - 1] ?? 60_000;
  }

  /** a reason the buttons do not work, noted once until a poll goes through again */
  private problem(text: string): void {
    if (this.noted === text) return;
    this.noted = text;
    this.engine.config.log(`[telegram] ${text}`);
    this.engine.store.append({ type: 'engine.note', goalId: null, payload: { level: 'warn', message: text } });
  }

  private sleep(ms: number): Promise<void> {
    if (!this.running) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        if (this.wake === done) this.wake = null;
        resolve();
      };
      const t = setTimeout(done, ms);
      (t as { unref?: () => void }).unref?.();
      this.wake = done;
    });
  }

  /** a new bot starts its updates over; a new chat has none of the old messages */
  private adopt(token: string, chat: string): void {
    const bot = hash(token);
    if (this.state.bot !== bot) this.state = { ...fresh(), bot, chat, seen: this.state.seen };
    else if (this.state.chat !== chat) this.state = { ...this.state, chat, messages: {}, rounds: {} };
  }

  private async handle(u: TgUpdate, s: NotificationSettings): Promise<void> {
    const chat = u.callback_query?.message?.chat ?? u.message?.chat;
    if (u.message && chat && this.state.bot) this.state.seen = { bot: this.state.bot, chatId: String(chat.id), who: chat.title ?? chat.username ?? chat.first_name ?? String(chat.id) };
    const mine = !!chat && String(chat.id) === s.telegramChatId;
    if (u.callback_query) {
      if (mine) return this.onPress(u.callback_query);
      return this.answerCallback(u.callback_query.id, 'Foundry answers only the chat set in its Settings.');
    }
    if (u.message && mine) return this.onMessage(u.message);
  }

  private via(from: TgUser | undefined) {
    return { channel: 'Telegram', who: from?.username ? `@${from.username}` : (from?.first_name ?? null) };
  }

  private async onPress(cq: TgCallback): Promise<void> {
    const msgId = cq.message?.message_id ?? null;
    const p = parsePress(cq.data ?? '');
    const t = p ? pressTarget(p) : null;
    const release = this.hold(t ? [t] : []);
    try {
      const run = press(this.host, cq.data ?? '', this.via(cq.from)).catch((err): Outcome => ({ toast: clip(`Something went wrong: ${String((err as Error)?.message ?? err)}`, 200), alert: true }));
      // Telegram shows a spinner until a press is answered: a slow answer (approving a Brief, a delivery) is acknowledged first
      const quick = await Promise.race([run, Bun.sleep(this.opts.slowMs ?? 2_500).then(() => null)]);
      await this.answerCallback(cq.id, quick ? quick.toast : 'Working on it…', quick?.alert);
      const out = quick ?? (await run);
      if (!quick && out.alert) await this.say(`⚠️ ${out.toast}`, msgId);
      await this.apply(out, msgId);
    } finally {
      release();
    }
  }

  private async onMessage(m: TgMessage): Promise<void> {
    const text = (m.text ?? '').trim();
    if (!text) return;
    const command = /^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i.exec(text)?.[1]?.toLowerCase();
    if (command === 'inbox') return this.sendInbox();
    if (command) return this.say(TELEGRAM_HELP, m.message_id);
    const to = m.reply_to_message;
    const words = to ? this.textTarget(to) : null;
    if (!words) return this.say(to ? 'That message takes no answer in words: use its buttons, or send /inbox.' : TELEGRAM_HELP, m.message_id);
    const release = this.hold([aboutText(words)]);
    try {
      // reading feedback is a model call of its own: say that something happens
      if (words.kind === 'feedback') await this.say('⏳ Reading your feedback…', m.message_id);
      const out = await reply(this.host, words, text, this.via(m.from)).catch((err): Outcome => ({ toast: clip(`Something went wrong: ${String((err as Error)?.message ?? err)}`, 200), alert: true }));
      await this.say(`${out.alert ? '⚠️' : '✓'} ${out.toast}`, m.message_id);
      await this.apply(out, null);
    } finally {
      release();
    }
  }

  /** what a reply to this message of the bot's means: from what Foundry remembers of it, else from its buttons */
  private textTarget(m: TgMessage): TextTarget | null {
    const entry = this.state.messages[String(m.message_id)];
    if (entry?.ask) return entry.ask;
    const data = m.reply_markup?.inline_keyboard?.flat().find((b) => b.callback_data)?.callback_data;
    const pressed = data ? parsePress(data) : null;
    const t = entry?.t ?? (pressed ? pressTarget(pressed) : null);
    return t ? textTargetOf(this.host, t) : null;
  }

  private async apply(out: Outcome, pressed: number | null): Promise<void> {
    if (pressed != null && out.buttons) await this.setButtons(pressed, out.buttons);
    if (out.ask) {
      const id = await this.notifier().sendMessage(out.ask.text, [], { force_reply: true, input_field_placeholder: out.ask.placeholder.slice(0, 64) });
      if (id != null) this.remember(id, { ask: out.ask.target });
    }
    for (const m of out.send ?? []) {
      const id = await this.notifier().sendMessage(m.text, [], m.buttons.length ? inline(m.buttons) : undefined);
      if (id != null) this.remember(id, { t: m.target });
    }
    for (const u of out.update ?? []) for (const id of this.messagesAbout(u.target)) await this.setButtons(id, u.buttons);
    this.save();
  }

  // ---------- sending ----------

  /** a message about `t`, with its buttons; a line says when a reply in words answers it too */
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
        const goal = this.host.goal(t.goalId);
        const waiting = goal?.state === 'awaiting_brief_approval';
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

  private footer(t: Extract<Target, { kind: 'esc' }>): string {
    const esc = this.host.escalation(t.id);
    if (esc?.trigger === 'boundary_action') return 'Approve it in the Inbox: a command outside the workspace never runs from a chat.';
    const words = textTargetOf(this.host, t);
    return words?.kind === 'hint' ? 'Or reply to this message with a hint: it runs again with your words.' : words?.kind === 'feedback' ? 'Or reply to this message with what to change.' : '';
  }

  private async post(text: string, links: Link[], kb: Keyboard, t: Target | null): Promise<number | null> {
    const id = await this.notifier().sendMessage(text, links, kb.length ? inline(kb) : undefined);
    if (id != null && t) {
      this.remember(id, { t });
      this.save();
    }
    return id;
  }

  /**
   * An interview round: a line on what to do, one message per question with its options, then the round's buttons
   * (Accept all recommended, Send answers, Enough). A send that failed half-way goes on where it stopped; `again`
   * (the /inbox command) sends the whole round anew.
   */
  private async sendRound(goalId: string, round: number, links: Link[], again = false): Promise<void> {
    const goal = this.host.goal(goalId);
    const r = goal?.interview?.rounds.find((x) => x.round === round);
    if (!goal || !r || r.answers) return;
    const key = `${goalId}:${round}`;
    const sent = again ? { questions: {} as Record<string, number> } : (this.state.rounds[key] ??= { questions: {} });
    const n = r.questions.length;
    if (sent.intro == null)
      sent.intro =
        (await this.post(`❓ Round ${round} — ${goal.title}\n${n} question${n === 1 ? '' : 's'} before the plan is written. Tap an answer under each (⭐ recommended) or reply to a question with your own, then use the buttons at the end.`, links, [], null)) ?? undefined;
    const draft = this.drafts.answers(goalId, round);
    for (const [i, q] of r.questions.entries()) {
      if (sent.questions[i] != null) continue;
      const id = await this.post(questionText(i, q), [], questionKeyboard(goalId, round, i, q, draft[q.key] ?? null), { kind: 'question', goalId, round, index: i });
      if (id != null) sent.questions[i] = id;
    }
    if (sent.controls == null) sent.controls = (await this.post(`Round ${round}: when you are done`, [], roundKeyboard(goalId, round), { kind: 'round', goalId, round })) ?? undefined;
    this.save();
  }

  /** `/inbox`: what waits for the person, sent again with its buttons */
  private async sendInbox(): Promise<void> {
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
    if (!total) return this.say('✓ Nothing waits for you.', null);
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
      const round = g.interview!.rounds.at(-1)!.round;
      await this.sendRound(g.id, round, await this.engine.notifications.links(s, `/goals/${g.id}`), true);
    }
    if (total > MAX) await this.say(`…and ${total - MAX} more in the Inbox.`, null);
  }

  // ---------- keeping messages current ----------

  /** an answer from the web UI (or the engine) closes the buttons of the messages about it */
  private onEvent(e: EngineEvent): void {
    if (e.type === 'settings.changed') {
      if (e.payload.keys.some((k) => k.startsWith('notifications.'))) {
        this.repoll = true;
        this.poll?.abort();
        this.wake?.();
      }
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
          if (entry.t?.kind === 'question' && entry.t.goalId === e.goalId && entry.t.round === e.payload.round) this.track(this.setButtons(Number(id), []));
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

  private hold(ts: Target[]): () => void {
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

  private messagesAbout(t: Target): number[] {
    const key = targetKey(t);
    return Object.entries(this.state.messages)
      .filter(([, e]) => e.t && targetKey(e.t) === key)
      .map(([id]) => Number(id));
  }

  private setButtons(messageId: number, kb: Keyboard): Promise<void> {
    const prev = this.edits.get(messageId) ?? Promise.resolve();
    const next = prev.then(() =>
      this.call('editMessageReplyMarkup', { chat_id: this.settings().telegramChatId, message_id: messageId, reply_markup: inline(kb) }).then(
        () => {},
        (err) => {
          if (!/not modified/i.test(String(err))) this.engine.config.log(`[telegram] could not update message ${messageId}: ${String(err)}`);
        },
      ),
    );
    this.edits.set(messageId, next);
    void next.then(() => {
      if (this.edits.get(messageId) === next) this.edits.delete(messageId);
    });
    return next;
  }

  // ---------- Telegram calls ----------

  private notifier(): TelegramNotifier {
    const s = this.settings();
    return new TelegramNotifier(s.telegramBotToken ?? '', s.telegramChatId ?? '', this.api);
  }

  private async call(method: string, body: object): Promise<unknown> {
    const token = this.settings().telegramBotToken;
    if (!token) throw new Error('no bot token');
    const res = await fetch(`${this.api}/bot${token}/${method}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const j = (await res.json().catch(() => null)) as TgReply;
    if (!res.ok || !j?.ok) throw new Error(`telegram ${res.status}: ${j?.description ?? ''}`);
    return j.result;
  }

  private answerCallback(id: string, text: string, alert = false): Promise<void> {
    return this.call('answerCallbackQuery', { callback_query_id: id, text: text.slice(0, 200), show_alert: alert }).then(
      () => {},
      () => {},
    );
  }

  private async say(text: string, replyTo: number | null): Promise<void> {
    await this.notifier()
      .sendMessage(text, [], undefined, replyTo ?? undefined)
      .catch((err) => this.engine.config.log(`[telegram] could not reply: ${String(err)}`));
  }

  // ---------- state ----------

  private remember(messageId: number, entry: Omit<Entry, 'at'>): void {
    this.state.messages[String(messageId)] = { ...entry, at: Date.now() };
  }

  private track(p: Promise<unknown>): void {
    this.work.add(p);
    void p.finally(() => this.work.delete(p));
  }

  private load(): BotState {
    try {
      if (existsSync(this.statePath)) return { ...fresh(), ...(JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<BotState>) };
    } catch {}
    return fresh();
  }

  private save(): void {
    const ids = Object.keys(this.state.messages);
    if (ids.length > KEEP_MESSAGES) {
      ids.sort((a, b) => this.state.messages[a]!.at - this.state.messages[b]!.at);
      for (const id of ids.slice(0, ids.length - KEEP_MESSAGES)) delete this.state.messages[id];
      const kept = new Set(Object.keys(this.state.messages).map(Number));
      for (const [k, r] of Object.entries(this.state.rounds)) if (r.controls != null && !kept.has(r.controls)) delete this.state.rounds[k];
    }
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      writeFileSync(`${this.statePath}.tmp`, JSON.stringify(this.state));
      renameSync(`${this.statePath}.tmp`, this.statePath);
    } catch {}
  }
}

/** a question as its own message: the number and whether it blocks, the question, why it is asked */
function questionText(index: number, q: InterviewQuestion): string {
  return [`Q${index + 1}${q.blocking ? ' · blocking' : ''}`, clip(q.text, 700), q.reason.trim() ? `Why: ${clip(q.reason.trim(), 300)}` : ''].filter(Boolean).join('\n');
}
