/**
 * Discord as a two-way channel (ADR-0039). A channel webhook can post but not carry buttons that answer, so a bot posts
 * the messages that wait for the person, in the webhook's channel, and reads the presses over the gateway (a WebSocket
 * Foundry opens: nothing on the computer is reachable from the internet). Words are asked for with a modal, a form
 * Discord shows over the chat. Only interactions in that channel are answered. On with a bot token beside the webhook;
 * only the `serve` engine connects.
 */
import { createHash } from 'node:crypto';
import type { NotificationSettings } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { DONE, type Keyboard, type Outcome, type Target, type TextTarget, parsePress, press, pressTarget, reply } from './actions.ts';
import { discordLinks, type Link } from './channels.ts';
import { ChatBot, type ChatState, aboutText, clip } from './chat-bot.ts';

export const DISCORD_API = 'https://discord.com/api/v10';
export const DISCORD_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const MAX_LEN = 1900;
const JSON_HEADERS = { 'content-type': 'application/json' };
/** no @everyone, role or user mention is acted on: a message's text comes partly from file names and model output */
const NO_MENTIONS = { parse: [] as string[] };
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

interface DcUser {
  id: string;
  username?: string;
  global_name?: string | null;
}
interface Interaction {
  id: string;
  application_id: string;
  /** 2 a command, 3 a button, 5 a modal sent */
  type: number;
  token: string;
  channel_id?: string;
  message?: { id: string };
  member?: { user?: DcUser };
  user?: DcUser;
  data?: { custom_id?: string; name?: string; components?: { type: number; component?: { value?: string }; components?: { value?: string }[] }[] };
}

interface DiscordState extends ChatState {
  /** the webhook the channel was read from, as a hash, and that channel */
  webhook: string | null;
  channelId: string | null;
}

export interface DiscordBotOptions {
  api?: string;
  gateway?: string;
  /** how long the reader rests while it is off (a settings change wakes it) */
  idleMs?: number;
  /** the wait after Discord refused the token */
  refusedMs?: number;
  /** waits after a lost connection, one per loss in a row (the last repeats) */
  retryMs?: number[];
  /** a press that takes longer is acknowledged first (Discord waits three seconds for an answer) */
  slowMs?: number;
}

/** a modal's id: what its words answer */
const modalId = (t: TextTarget) => (t.kind === 'answer' ? `a:${t.goalId}:${t.round}:${t.index}` : t.kind === 'note' ? `n:${t.goalId}:${t.round}` : `${t.kind === 'hint' ? 'h' : t.kind === 'provide' ? 'p' : 'f'}:${t.escId}`);
export function parseModalId(id: string): TextTarget | null {
  const p = id.split(':');
  if ((p[0] === 'h' || p[0] === 'f' || p[0] === 'p') && p.length === 2 && p[1]) return { kind: p[0] === 'h' ? 'hint' : p[0] === 'p' ? 'provide' : 'feedback', escId: p[1] };
  if (p[0] === 'a' && p.length === 4 && p[1] && /^\d+$/.test(p[2]!) && /^\d+$/.test(p[3]!)) return { kind: 'answer', goalId: p[1], round: Number(p[2]), index: Number(p[3]) };
  if (p[0] === 'n' && p.length === 3 && p[1] && /^\d+$/.test(p[2]!)) return { kind: 'note', goalId: p[1], round: Number(p[2]) };
  return null;
}
/** the words in a submitted modal: a text input inside a label, or (older clients) inside an action row */
function modalValue(i: Interaction): string {
  for (const c of i.data?.components ?? []) {
    const v = c.component?.value ?? c.components?.[0]?.value;
    if (typeof v === 'string') return v;
  }
  return '';
}

const style = (label: string) => (/🛑/.test(label) ? 4 : /^(✅|▶️)/.test(label) ? 3 : /⭐/.test(label) ? 1 : 2);
/** buttons as Discord rows: five rows of five at most, so a long keyboard is packed (an option list past 24 is cut) */
export function discordComponents(kb: Keyboard): object[] {
  const fits = kb.length <= 5 && kb.every((r) => r.length <= 5);
  const flat = kb.flat().slice(0, 25);
  const rows = fits ? kb : Array.from({ length: Math.ceil(flat.length / 5) }, (_, i) => flat.slice(i * 5, i * 5 + 5));
  return rows.map((r) => ({
    type: 1,
    components: r.map((b) => (b.data === DONE ? { type: 2, style: 2, label: clip(b.label, 80), custom_id: DONE, disabled: true } : { type: 2, style: style(b.label), label: clip(b.label, 80), custom_id: b.data })),
  }));
}

export class DiscordBot extends ChatBot<DiscordState> {
  readonly channel = 'Discord';
  private api: string;
  private ws: WebSocket | null = null;
  private wake: (() => void) | null = null;
  /** why the socket was closed by Foundry itself: new settings to read, or stopping */
  private closing: 'settings' | 'stop' | null = null;
  private session: { bot: string; id: string; url: string } | null = null;
  private seq: number | null = null;
  private appId: string | null = null;
  private registered: string | null = null;
  private noted: string | null = null;

  constructor(
    engine: Engine,
    private opts: DiscordBotOptions = {},
  ) {
    super(engine, 'discord.json');
    this.api = opts.api ?? DISCORD_API;
  }

  protected fresh(): DiscordState {
    return { messages: {}, rounds: {}, webhook: null, channelId: null };
  }

  answers(s: NotificationSettings = this.settings()): boolean {
    return this.running && !!(s.discordBotToken && s.discordWebhookUrl);
  }

  protected settingsChanged(): void {
    this.closing = 'settings';
    this.ws?.close(4000, 'settings changed');
    this.wake?.();
  }
  protected stopReading(): void {
    this.closing = 'stop';
    this.ws?.close(1000, 'stopping');
    this.wake?.();
  }

  // ---------- the gateway ----------

  protected async startReading(): Promise<void> {
    let failures = 0;
    while (this.running) {
      const s = this.settings();
      if (!this.answers(s)) {
        await this.sleep(this.opts.idleMs ?? 60_000);
        continue;
      }
      const token = s.discordBotToken!;
      const end = await this.connect(token);
      if (!this.running) break;
      if (end === 'settings') {
        failures = 0;
        continue;
      }
      if (end === 'refused') {
        this.problem('Discord buttons are off: Discord refused the bot token. Copy it again from the Developer Portal (Bot → Reset Token).');
        await this.sleep(this.opts.refusedMs ?? 300_000);
        continue;
      }
      if (end === 'ready') failures = 0;
      const steps = this.opts.retryMs ?? [1_000, 5_000, 15_000, 60_000];
      await this.sleep(steps[Math.min(++failures, steps.length) - 1] ?? 60_000);
    }
  }

  /** one gateway connection, until it closes: whether it got going, was refused, or closed for new settings */
  private connect(token: string): Promise<'ready' | 'lost' | 'refused' | 'settings'> {
    return new Promise((resolve) => {
      const bot = hash(token);
      const resume = this.session?.bot === bot ? this.session : null;
      const ws = new WebSocket(resume?.url ?? this.opts.gateway ?? DISCORD_GATEWAY);
      this.ws = ws;
      this.closing = null;
      let beat: ReturnType<typeof setInterval> | null = null;
      let first: ReturnType<typeof setTimeout> | null = null;
      let acked = true;
      let ready = false;
      const send = (op: number, d: unknown) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op, d }));
      };
      const heartbeat = () => {
        // no answer to the last heartbeat: the connection is a zombie
        if (!acked) return ws.close(4000, 'no heartbeat ack');
        acked = false;
        send(1, this.seq);
      };
      ws.onmessage = (ev) => {
        let msg: { op: number; d: any; s?: number | null; t?: string | null };
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.s != null) this.seq = msg.s;
        switch (msg.op) {
          case 10: {
            const every = Number(msg.d?.heartbeat_interval) || 41_250;
            first = setTimeout(() => {
              heartbeat();
              beat = setInterval(heartbeat, every);
            }, Math.floor(every * Math.random()));
            if (resume) send(6, { token, session_id: resume.id, seq: this.seq });
            // no intents: interactions come without any, and Foundry reads no message text
            else send(2, { token, intents: 0, properties: { os: process.platform, browser: 'foundry', device: 'foundry' } });
            return;
          }
          case 11:
            acked = true;
            return;
          case 1:
            send(1, this.seq);
            return;
          case 7:
            ws.close(4000, 'reconnect asked');
            return;
          case 9:
            // a session that cannot be resumed starts over with a fresh identify
            if (!msg.d) this.session = null;
            setTimeout(() => ws.close(4000, 'invalid session'), 1_000 + Math.random() * 4_000);
            return;
          case 0:
            if (msg.t === 'READY') {
              ready = true;
              this.noted = null;
              this.session = { bot, id: String(msg.d.session_id), url: `${String(msg.d.resume_gateway_url).replace(/\/+$/, '')}/?v=10&encoding=json` };
              this.appId = String(msg.d.application?.id ?? '') || null;
              void this.register(token);
            } else if (msg.t === 'RESUMED') ready = true;
            else if (msg.t === 'INTERACTION_CREATE') this.track(this.onInteraction(msg.d as Interaction).catch((err) => this.engine.config.log(`[discord] interaction: ${String(err)}`)));
            return;
        }
      };
      ws.onerror = () => {};
      ws.onclose = (ev) => {
        if (first) clearTimeout(first);
        if (beat) clearInterval(beat);
        if (this.ws === ws) this.ws = null;
        // 4004: the token was refused; 4010-4014: the connection cannot work as asked (shard, version, intents)
        if (ev.code === 4004 || (ev.code >= 4010 && ev.code <= 4014)) {
          this.session = null;
          return resolve('refused');
        }
        if (this.closing === 'settings') return resolve('settings');
        resolve(ready ? 'ready' : 'lost');
      };
    });
  }

  /** the `/inbox` command, registered once per bot (the bulk call replaces what was there) */
  private async register(token: string): Promise<void> {
    if (!this.appId || this.registered === this.appId) return;
    try {
      await this.rest('PUT', `/applications/${this.appId}/commands`, [{ name: 'inbox', description: 'Send again what waits for you in Foundry', type: 1 }], token);
      this.registered = this.appId;
    } catch (err) {
      this.engine.config.log(`[discord] could not register /inbox: ${String(err)}`);
    }
  }

  private problem(text: string): void {
    if (this.noted === text) return;
    this.noted = text;
    this.engine.config.log(`[discord] ${text}`);
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

  // ---------- interactions ----------

  private who(i: Interaction): string | null {
    const u = i.member?.user ?? i.user;
    return u ? (u.global_name ?? u.username ?? null) : null;
  }

  private async onInteraction(i: Interaction): Promise<void> {
    const channel = await this.channelId().catch(() => null);
    if (!channel || i.channel_id !== channel) return this.respond(i, { type: 4, data: { content: 'Foundry answers only in the channel its webhook posts to.', flags: 64 } });
    if (i.type === 2) {
      if (i.data?.name !== 'inbox') return this.respond(i, { type: 4, data: { content: 'Foundry knows /inbox only.', flags: 64 } });
      await this.respond(i, { type: 4, data: { content: 'Sending what waits for you…', flags: 64 } });
      return this.sendInbox();
    }
    if (i.type === 3) return this.onPress(i);
    if (i.type === 5) return this.onModal(i);
  }

  private async onPress(i: Interaction): Promise<void> {
    const data = i.data?.custom_id ?? '';
    const msgId = i.message?.id ?? null;
    const p = parsePress(data);
    const t = p ? pressTarget(p) : null;
    const release = this.hold(t ? [t] : []);
    try {
      const run = press(this.host, data, this.via(this.who(i))).catch((err): Outcome => ({ toast: clip(`Something went wrong: ${String((err as Error)?.message ?? err)}`, 200), alert: true }));
      // Discord waits three seconds for the first answer: a slow press is acknowledged first and finished after
      const quick = await Promise.race([run, Bun.sleep(this.opts.slowMs ?? 2_000).then(() => null)]);
      if (quick?.ask) return void (await this.respond(i, { type: 9, data: this.modal(quick.ask.target, quick.ask.placeholder) }));
      if (quick) await this.respond(i, quick.buttons ? { type: 7, data: { components: discordComponents(quick.buttons) } } : { type: 6 });
      else await this.respond(i, { type: 6 });
      const out = quick ?? (await run);
      if (!quick && out.buttons && msgId) await this.setButtons(msgId, out.buttons);
      await this.followup(i, out.ask ? 'Press the button again to type your answer.' : out.toast, out.alert);
      await this.apply({ ...out, buttons: undefined }, msgId);
    } finally {
      release();
    }
  }

  private async onModal(i: Interaction): Promise<void> {
    const words = parseModalId(i.data?.custom_id ?? '');
    if (!words) return this.respond(i, { type: 4, data: { content: 'This form no longer does anything.', flags: 64 } });
    // the words may take a while (milestone feedback is read by a model first): say so at once, only to the sender
    await this.respond(i, { type: 5, data: { flags: 64 } });
    const release = this.hold([aboutText(words)]);
    try {
      const out = await reply(this.host, words, modalValue(i), this.via(this.who(i))).catch((err): Outcome => ({ toast: clip(`Something went wrong: ${String((err as Error)?.message ?? err)}`, 200), alert: true }));
      await this.webhookCall('PATCH', `/webhooks/${i.application_id}/${i.token}/messages/@original`, { content: `${out.alert ? '⚠️' : '✓'} ${out.toast}` });
      await this.apply(out, null);
    } finally {
      release();
    }
  }

  /** the form a press opens for words: a title, the question or what the words do, one text field */
  private modal(t: TextTarget, placeholder: string): object {
    const question = t.kind === 'answer' ? this.host.goal(t.goalId)?.interview?.rounds.find((r) => r.round === t.round)?.questions[t.index]?.text : null;
    const [title, label, description] =
      t.kind === 'hint'
        ? ['Retry with hint', 'Your hint', 'The task runs again with your words.']
        : t.kind === 'feedback'
          ? ['Give feedback', 'What should change?', 'Foundry says what it makes of it before anything happens.']
          : t.kind === 'note'
            ? [`Round ${t.round}: your note`, 'Your note', 'What the questions missed or got wrong. Sent with your answers; it becomes a Decision.']
            : t.kind === 'provide'
              ? ['Answer the request', 'What you can give, in words', 'The task goes on with your words; files come through the web.']
              : [`Q${t.index + 1}: your answer`, 'Your answer', question ?? ''];
    return {
      custom_id: modalId(t),
      title: clip(title, 45),
      components: [{ type: 18, label: clip(label, 45), ...(description ? { description: clip(description, 100) } : {}), component: { type: 4, custom_id: 'words', style: 2, placeholder: clip(placeholder, 100), required: true, max_length: 4000 } }],
    };
  }

  protected footer(t: Extract<Target, { kind: 'esc' }>): string {
    const esc = this.host.escalation(t.id);
    return esc?.trigger === 'boundary_action' ? 'Approve it in the Inbox: a command outside the workspace never runs from a chat.' : '';
  }

  protected roundHint(): string {
    return 'Press an answer under each (⭐ recommended), or ✍️ for your own, then use the buttons at the end.';
  }

  // ---------- Discord calls ----------

  /** the channel the webhook posts to: the bot's messages go there too, and only presses there are answered */
  async channelId(): Promise<string | null> {
    const url = this.settings().discordWebhookUrl;
    if (!url) return null;
    const h = hash(url);
    if (this.state.webhook === h && this.state.channelId) return this.state.channelId;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const j = (await res.json().catch(() => null)) as { channel_id?: string } | null;
    if (!res.ok || !j?.channel_id) throw new Error(`discord webhook ${res.status}`);
    // another channel: the messages Foundry remembers belong to the old one
    if (this.state.channelId !== j.channel_id) this.state = { ...this.fresh(), webhook: h, channelId: String(j.channel_id) };
    else this.state.webhook = h;
    this.save();
    return this.state.channelId;
  }

  protected async send(text: string, links: Link[], kb: Keyboard): Promise<string | null> {
    const channel = await this.channelId();
    if (!channel) throw new Error('no Discord channel: the webhook is not set');
    const sent = (await this.rest('POST', `/channels/${channel}/messages`, { content: discordLinks(text, links).slice(0, MAX_LEN), components: kb.length ? discordComponents(kb) : [], allowed_mentions: NO_MENTIONS })) as { id?: string } | null;
    return sent?.id ? String(sent.id) : null;
  }

  protected async editButtons(messageId: string, kb: Keyboard): Promise<void> {
    const channel = await this.channelId();
    if (channel) await this.rest('PATCH', `/channels/${channel}/messages/${messageId}`, { components: discordComponents(kb) });
  }

  protected async say(text: string, replyTo: string | null = null): Promise<void> {
    const channel = await this.channelId().catch(() => null);
    if (!channel) return;
    await this.rest('POST', `/channels/${channel}/messages`, { content: text.slice(0, MAX_LEN), allowed_mentions: NO_MENTIONS, ...(replyTo ? { message_reference: { message_id: replyTo, fail_if_not_exists: false } } : {}) }).catch((err) => this.engine.config.log(`[discord] could not post: ${String(err)}`));
  }

  /** "Send test message": the bot posts one line in the webhook's channel, with the draft token when one is typed */
  async test(token: string, webhookUrl: string): Promise<{ channel: string; ok: boolean; error: string | null }> {
    try {
      const res = await fetch(webhookUrl, { signal: AbortSignal.timeout(15_000) });
      const j = (await res.json().catch(() => null)) as { channel_id?: string } | null;
      if (!res.ok || !j?.channel_id) throw new Error(`discord webhook ${res.status}`);
      await this.rest('POST', `/channels/${j.channel_id}/messages`, { content: '👋 Foundry test — buttons answer in this channel.', allowed_mentions: NO_MENTIONS }, token);
      return { channel: 'discord bot', ok: true, error: null };
    } catch (err) {
      return { channel: 'discord bot', ok: false, error: String(err).slice(0, 300) };
    }
  }

  private async respond(i: Interaction, body: object): Promise<void> {
    await this.webhookCall('POST', `/interactions/${i.id}/${i.token}/callback`, body).catch((err) => this.engine.config.log(`[discord] could not answer an interaction: ${String(err)}`));
  }

  private async followup(i: Interaction, text: string, alert?: boolean): Promise<void> {
    if (!text) return;
    await this.webhookCall('POST', `/webhooks/${i.application_id}/${i.token}`, { content: `${alert ? '⚠️ ' : ''}${text}`, flags: 64 }).catch((err) => this.engine.config.log(`[discord] could not follow up: ${String(err)}`));
  }

  /** interaction calls carry their own token: no bot authorisation */
  private async webhookCall(method: string, path: string, body: object): Promise<unknown> {
    const res = await fetch(`${this.api}${path}`, { method, headers: JSON_HEADERS, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`discord ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  private async rest(method: string, path: string, body: unknown, token = this.settings().discordBotToken): Promise<unknown> {
    if (!token) throw new Error('no Discord bot token');
    for (let tries = 0; ; tries++) {
      const res = await fetch(`${this.api}${path}`, { method, headers: { ...JSON_HEADERS, authorization: `Bot ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      // rate limited: wait as long as Discord says, once
      if (res.status === 429 && tries === 0) {
        const j = (await res.json().catch(() => null)) as { retry_after?: number } | null;
        await Bun.sleep(Math.min(10_000, Math.max(100, (j?.retry_after ?? 1) * 1000)));
        continue;
      }
      if (!res.ok) throw new Error(`discord ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
      return res.status === 204 ? null : res.json().catch(() => null);
    }
  }
}
