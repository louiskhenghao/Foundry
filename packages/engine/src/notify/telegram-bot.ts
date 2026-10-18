/**
 * Telegram as a two-way channel (ADR-0038). Foundry reads its bot's updates by long polling (`getUpdates`, so no public
 * address is needed) and acts on the button presses and the replies that come from the configured chat, through
 * notify/actions.ts. Updates from any other chat are ignored. When something else reads the same bot (a second Foundry,
 * a webhook), Telegram refuses the poll; that is noted once and waited out. Off with `notifications.telegramActions`, or
 * without a token and a chat; only the `serve` engine reads.
 */
import { createHash } from 'node:crypto';
import type { NotificationSettings } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { type Keyboard, type Outcome, type Target, parsePress, press, pressTarget, reply } from './actions.ts';
import { TELEGRAM_API, TelegramNotifier, type Link } from './channels.ts';
import { ChatBot, type ChatState, aboutText, clip } from './chat-bot.ts';

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

interface TelegramState extends ChatState {
  /** the bot and the chat the rest belongs to, as hashes (the token is not written twice) */
  bot: string | null;
  chat: string | null;
  /** the next update to read: Telegram forgets an update once a poll asks past it */
  offset: number;
  /** the chat that last wrote to the bot (Settings → Detect asks for it while Foundry reads the updates) */
  seen: { bot: string; chatId: string; who: string } | null;
}
const JSON_HEADERS = { 'content-type': 'application/json' };
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const inline = (kb: Keyboard) => ({ inline_keyboard: kb.map((row) => row.map((b) => ({ text: b.label, callback_data: b.data }))) });

export const TELEGRAM_HELP = [
  'Foundry answers here.',
  '• The buttons under a message answer it, as the Inbox does.',
  '• Reply to a message to answer in words: a hint for a task, feedback on a milestone, your own answer to a question.',
  '• /inbox sends again what waits for you.',
  'A command outside the workspace is approved in the Inbox only.',
].join('\n');

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

export class TelegramBot extends ChatBot<TelegramState> {
  readonly channel = 'Telegram';
  private api: string;
  private poll: AbortController | null = null;
  /** a settings change aborted the poll: read again with the new settings, no failure */
  private repoll = false;
  private wake: (() => void) | null = null;
  private noted: string | null = null;

  constructor(
    engine: Engine,
    private opts: TelegramBotOptions = {},
  ) {
    super(engine, 'telegram.json');
    this.api = opts.api ?? TELEGRAM_API;
  }

  protected fresh(): TelegramState {
    return { messages: {}, rounds: {}, bot: null, chat: null, offset: 0, seen: null };
  }

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

  protected settingsChanged(): void {
    this.repoll = true;
    this.poll?.abort();
    this.wake?.();
  }
  protected stopReading(): void {
    this.poll?.abort();
    this.wake?.();
  }

  // ---------- reading ----------

  protected async startReading(): Promise<void> {
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
    if (this.state.bot !== bot) this.state = { ...this.fresh(), bot, chat, seen: this.state.seen };
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

  private who(from: TgUser | undefined): string | null {
    return from?.username ? `@${from.username}` : (from?.first_name ?? null);
  }

  private async onPress(cq: TgCallback): Promise<void> {
    const msgId = cq.message ? String(cq.message.message_id) : null;
    const p = parsePress(cq.data ?? '');
    const t = p ? pressTarget(p) : null;
    const release = this.hold(t ? [t] : []);
    try {
      const run = press(this.host, cq.data ?? '', this.via(this.who(cq.from))).catch((err): Outcome => ({ toast: clip(`Something went wrong: ${String((err as Error)?.message ?? err)}`, 200), alert: true }));
      // Telegram shows a spinner until a press is answered: a slow answer (approving a Brief, a delivery) is acknowledged first
      const quick = await Promise.race([run, Bun.sleep(this.opts.slowMs ?? 2_500).then(() => null)]);
      await this.answerCallback(cq.id, quick ? quick.toast : 'Working on it…', quick?.alert);
      const out = quick ?? (await run);
      if (!quick && out.alert) await this.say(`⚠️ ${out.toast}`, msgId);
      if (out.ask) {
        // words are asked for with Telegram's reply prompt: the person's reply lands on it
        const id = await this.notifier().sendMessage(out.ask.text, [], { force_reply: true, input_field_placeholder: out.ask.placeholder.slice(0, 64) });
        if (id != null) this.remember(String(id), { ask: out.ask.target });
      }
      await this.apply(out, msgId);
    } finally {
      release();
    }
  }

  private async onMessage(m: TgMessage): Promise<void> {
    const text = (m.text ?? '').trim();
    if (!text) return;
    const mine = String(m.message_id);
    const command = /^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i.exec(text)?.[1]?.toLowerCase();
    if (command === 'inbox') return this.sendInbox();
    if (command) return this.say(TELEGRAM_HELP, mine);
    const to = m.reply_to_message;
    const data = to?.reply_markup?.inline_keyboard?.flat().find((b) => b.callback_data)?.callback_data;
    const pressed = data ? parsePress(data) : null;
    const words = to ? this.textTargetFor(String(to.message_id), pressed ? pressTarget(pressed) : null) : null;
    if (!words) return this.say(to ? 'That message takes no answer in words: use its buttons, or send /inbox.' : TELEGRAM_HELP, mine);
    const release = this.hold([aboutText(words)]);
    try {
      // reading feedback is a model call of its own: say that something happens
      if (words.kind === 'feedback') await this.say('⏳ Reading your feedback…', mine);
      const out = await reply(this.host, words, text, this.via(this.who(m.from))).catch((err): Outcome => ({ toast: clip(`Something went wrong: ${String((err as Error)?.message ?? err)}`, 200), alert: true }));
      await this.say(`${out.alert ? '⚠️' : '✓'} ${out.toast}`, mine);
      await this.apply(out, null);
    } finally {
      release();
    }
  }

  protected footer(t: Extract<Target, { kind: 'esc' }>): string {
    const esc = this.host.escalation(t.id);
    if (esc?.trigger === 'boundary_action') return 'Approve it in the Inbox: a command outside the workspace never runs from a chat.';
    if (esc?.trigger === 'milestone') return 'Or reply to this message with what to change.';
    return esc && ['retries_exhausted', 'permission_denial'].includes(esc.trigger) ? 'Or reply to this message with a hint: it runs again with your words.' : '';
  }

  protected roundHint(): string {
    return 'Tap an answer under each (⭐ recommended) or reply to a question with your own, then use the buttons at the end.';
  }

  // ---------- Telegram calls ----------

  private notifier(): TelegramNotifier {
    const s = this.settings();
    return new TelegramNotifier(s.telegramBotToken ?? '', s.telegramChatId ?? '', this.api);
  }

  protected async send(text: string, links: Link[], kb: Keyboard): Promise<string | null> {
    const id = await this.notifier().sendMessage(text, links, kb.length ? inline(kb) : undefined);
    return id == null ? null : String(id);
  }

  protected async editButtons(messageId: string, kb: Keyboard): Promise<void> {
    await this.call('editMessageReplyMarkup', { chat_id: this.settings().telegramChatId, message_id: Number(messageId), reply_markup: inline(kb) });
  }

  protected async say(text: string, replyTo: string | null = null): Promise<void> {
    await this.notifier()
      .sendMessage(text, [], undefined, replyTo != null ? Number(replyTo) : undefined)
      .catch((err) => this.engine.config.log(`[telegram] could not reply: ${String(err)}`));
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
}
