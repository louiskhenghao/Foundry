import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ServerWebSocket } from 'bun';
import { getEscalation, getGoal, listTasks } from '@foundry/core';
import type { ClaudeRunner } from '@foundry/runner';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { raiseEscalation } from '../escalation.ts';
import { FakeRunner, makeRepo, terminal, waitFor } from '../test-helpers.ts';
import { DiscordBot, discordComponents, parseModalId } from './discord-bot.ts';
import { questionKeyboard, statusRow } from './actions.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const WEBHOOK = 'https://discord.com/api/webhooks/1/hook-token';
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
type Call = { method: string; path: string; body: any; auth: string | null };

/** Discord in-process: a gateway (a local WebSocket server) and the REST calls Foundry makes, recorded */
class FakeDiscord {
  calls: Call[] = [];
  socket: ServerWebSocket<unknown> | null = null;
  identified: any = null;
  refuse = false;
  private seq = 0;
  private mid = 5000;
  private real = globalThis.fetch;
  server = Bun.serve({
    port: 0,
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response('no', { status: 400 })),
    websocket: {
      open: (ws) => {
        this.socket = ws;
        ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 30_000 } }));
      },
      message: (ws, raw) => {
        const m = JSON.parse(String(raw));
        if (m.op === 2) {
          if (this.refuse) return ws.close(4004, 'Authentication failed.');
          this.identified = m.d;
          ws.send(JSON.stringify({ op: 0, t: 'READY', s: ++this.seq, d: { session_id: 'sess-1', resume_gateway_url: this.url, application: { id: 'app-1' } } }));
        }
        if (m.op === 1) ws.send(JSON.stringify({ op: 11 }));
      },
      close: () => {
        this.socket = null;
      },
    },
  });
  get url() {
    return `ws://127.0.0.1:${this.server.port}`;
  }
  install(): void {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      if (url === WEBHOOK) {
        if (method === 'GET') return json({ id: '1', channel_id: 'C1' });
        this.calls.push({ method: 'WEBHOOK', path: '', body, auth: null });
        return new Response(null, { status: 204 });
      }
      const m = /^https:\/\/discord\.com\/api\/v10(\/.*)$/.exec(url);
      if (!m) return this.real(input as RequestInfo, init);
      this.calls.push({ method, path: m[1]!, body, auth: (init?.headers as Record<string, string> | undefined)?.authorization ?? null });
      if (method === 'POST' && m[1] === '/channels/C1/messages') return json({ id: String(++this.mid), channel_id: 'C1' });
      if (method === 'PATCH' || method === 'PUT') return json({});
      return new Response(null, { status: 204 });
    }) as typeof fetch;
  }
  restore(): void {
    globalThis.fetch = this.real;
    this.server.stop(true);
  }
  private interact(d: object): void {
    this.socket!.send(JSON.stringify({ op: 0, t: 'INTERACTION_CREATE', s: ++this.seq, d }));
  }
  private base(channel: string) {
    const n = ++this.seq;
    return { id: `i${n}`, application_id: 'app-1', token: `tok${n}`, channel_id: channel, member: { user: { id: 'u1', username: 'ann', global_name: 'Ann' } } };
  }
  press(messageId: string, data: string, channel = 'C1'): string {
    const b = this.base(channel);
    this.interact({ ...b, type: 3, message: { id: messageId }, data: { custom_id: data, component_type: 2 } });
    return b.id;
  }
  submit(customId: string, value: string): string {
    const b = this.base('C1');
    this.interact({ ...b, type: 5, data: { custom_id: customId, components: [{ type: 18, id: 1, component: { type: 4, id: 2, custom_id: 'words', value } }] } });
    return b.token;
  }
  command(name: string): void {
    this.interact({ ...this.base('C1'), type: 2, data: { name } });
  }
  posted(text: RegExp): (Call & { id: string }) | undefined {
    const i = this.calls.findIndex((c) => c.method === 'POST' && c.path === '/channels/C1/messages' && text.test(c.body.content ?? ''));
    return i < 0 ? undefined : { ...this.calls[i]!, id: String(5001 + this.calls.slice(0, i).filter((c) => c.method === 'POST' && c.path === '/channels/C1/messages').length) };
  }
  callback(interactionId: string): any {
    return this.calls.find((c) => c.path.startsWith(`/interactions/${interactionId}/`))?.body;
  }
  ids(body: any): string[] {
    return (body?.components ?? []).flatMap((r: any) => r.components.map((b: any) => b.custom_id));
  }
  edits(messageId: string): string[] {
    return this.calls.filter((c) => c.method === 'PATCH' && c.path === `/channels/C1/messages/${messageId}`).map((c) => c.body.components.flatMap((r: any) => r.components.map((b: any) => `${b.label}${b.disabled ? ' (disabled)' : ''}`)).join(' | '));
  }
}

let dataDir: string;
let repo: string;
let dc: FakeDiscord;
const engines: Engine[] = [];
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-discord-'));
  repo = await makeRepo();
  dc = new FakeDiscord();
  dc.install();
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  dc.restore();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
  rmSync(`${repo}-foundry`, { recursive: true, force: true });
});

/** an engine whose Discord bot talks to the fake gateway; Tailscale off, so no test touches this computer's tailnet */
function engineWith(runner: ClaudeRunner): { engine: Engine; bot: DiscordBot } {
  const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} }), runner);
  engines.push(engine);
  engine.updateSettings({ notifications: { discordWebhookUrl: WEBHOOK, discordBotToken: 'BOT-TOKEN', tailscale: 'off', onGoalFinished: false } });
  const bot = new DiscordBot(engine, { gateway: dc.url, retryMs: [20], refusedMs: 60_000 });
  (engine as { discord: DiscordBot }).discord = bot;
  return { engine, bot };
}

async function doneGoal(engine: Engine) {
  const goal = await engine.createGoal({ prompt: 'noop', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
  await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
  return { goal: getGoal(engine.store.db, goal.id)!, task: listTasks(engine.store.db, goal.id)[0]! };
}

describe('Discord buttons', () => {
  test('the bot connects with no intents, registers /inbox, and posts what waits with buttons in the webhook channel', async () => {
    const { engine, bot } = engineWith(new FakeRunner(() => {}));
    bot.start();
    await waitFor(() => dc.calls.some((c) => c.method === 'PUT' && c.path === '/applications/app-1/commands'));
    expect(dc.identified).toMatchObject({ token: 'BOT-TOKEN', intents: 0 });
    expect(dc.calls.find((c) => c.method === 'PUT')!.body).toEqual([{ name: 'inbox', description: 'Send again what waits for you in Foundry', type: 1 }]);

    const { goal, task } = await doneGoal(engine);
    const e = raiseEscalation(engine, { goal, task, trigger: 'retries_exhausted', message: 'Task "noop" used 3 attempts' });
    await waitFor(() => !!dc.posted(/used 3 attempts/));
    const m = dc.posted(/used 3 attempts/)!;
    expect(m.auth).toBe('Bot BOT-TOKEN');
    expect(m.body.allowed_mentions).toEqual({ parse: [] });
    expect(dc.ids(m.body)).toEqual([`e:${e.id}:r`, `e:${e.id}:h`, `e:${e.id}:s`, `e:${e.id}:x`]);
    // the bot's message is the one: the webhook does not post it a second time
    expect(dc.calls.some((c) => c.method === 'WEBHOOK' && /used 3 attempts/.test(c.body.content))).toBe(false);

    // a press answers, updates the buttons in the same response, and says the outcome only to the presser
    const pressed = dc.press(m.id, `e:${e.id}:s`);
    await waitFor(() => getEscalation(engine.store.db, e.id)!.state === 'answered');
    await waitFor(() => !!dc.callback(pressed));
    expect(dc.callback(pressed).type).toBe(7);
    expect(dc.callback(pressed).data.components[0].components[0]).toMatchObject({ disabled: true, label: expect.stringMatching(/^✓ Skipped · /) });
    await waitFor(() => dc.calls.some((c) => c.path.startsWith('/webhooks/app-1/') && c.body.flags === 64 && /Skipped/.test(c.body.content)));
    expect(engine.store.listByGoal(goal.id, 5000).some((x) => x.type === 'engine.note' && /Skipped from Discord by Ann/.test((x.payload as { message: string }).message))).toBe(true);
  }, 30_000);

  test('words come through a form: Retry with hint opens it, sending it retries with them', async () => {
    const { engine, bot } = engineWith(new FakeRunner(() => {}));
    bot.start();
    await waitFor(() => !!dc.identified);
    const { goal, task } = await doneGoal(engine);
    const e = raiseEscalation(engine, { goal, task, trigger: 'permission_denial', message: 'The coding agent refused Bash(rm -rf build)' });
    await waitFor(() => !!dc.posted(/refused Bash/));
    const m = dc.posted(/refused Bash/)!;
    const asked = dc.press(m.id, `e:${e.id}:h`);
    await waitFor(() => !!dc.callback(asked));
    const modal = dc.callback(asked);
    expect(modal.type).toBe(9);
    expect(modal.data).toMatchObject({ custom_id: `h:${e.id}`, title: 'Retry with hint', components: [{ type: 18, label: 'Your hint', component: { type: 4, style: 2, required: true } }] });
    expect(getEscalation(engine.store.db, e.id)!.state).toBe('open');

    const token = dc.submit(`h:${e.id}`, 'use the fixture in test/data');
    await waitFor(() => getEscalation(engine.store.db, e.id)!.state === 'answered');
    expect(getEscalation(engine.store.db, e.id)!.answer).toEqual({ action: 'retry_with_hint', hint: 'use the fixture in test/data', extraAttempts: 1 });
    await waitFor(() => dc.calls.some((c) => c.method === 'PATCH' && c.path === `/webhooks/app-1/${token}/messages/@original` && /Retrying with your hint/.test(c.body.content)));
    await waitFor(() => dc.edits(m.id).some((l) => /^✓ Retried with your hint · \d\d:\d\d \(disabled\)$/.test(l)));
  }, 30_000);

  test('a press from another channel changes nothing; an answer in Foundry closes the buttons', async () => {
    const { engine, bot } = engineWith(new FakeRunner(() => {}));
    bot.start();
    await waitFor(() => !!dc.identified);
    const { goal } = await doneGoal(engine);
    const e = raiseEscalation(engine, { goal, trigger: 'budget_exceeded', message: 'The goal hit its budget' });
    await waitFor(() => !!dc.posted(/hit its budget/));
    const m = dc.posted(/hit its budget/)!;
    const elsewhere = dc.press(m.id, `e:${e.id}:b`, 'C2');
    await waitFor(() => !!dc.callback(elsewhere));
    expect(dc.callback(elsewhere)).toEqual({ type: 4, data: { content: 'Foundry answers only in the channel its webhook posts to.', flags: 64 } });
    expect(getEscalation(engine.store.db, e.id)!.state).toBe('open');
    await engine.answerEscalation(e.id, { action: 'raise_budget' });
    await waitFor(() => dc.edits(m.id).some((l) => /^✓ Answered · .* \(disabled\)$/.test(l)));
  }, 30_000);

  test('/inbox sends again what waits', async () => {
    const { engine, bot } = engineWith(new FakeRunner(() => {}));
    bot.start();
    await waitFor(() => !!dc.identified);
    const { goal, task } = await doneGoal(engine);
    raiseEscalation(engine, { goal, task, trigger: 'retries_exhausted', message: 'Task "noop" is stuck' });
    await waitFor(() => !!dc.posted(/is stuck/));
    dc.command('inbox');
    await waitFor(() => dc.calls.filter((c) => c.method === 'POST' && c.path === '/channels/C1/messages' && /is stuck/.test(c.body.content)).length === 2);
  }, 30_000);

  test('a refused token is noted once and the bot waits', async () => {
    dc.refuse = true;
    const { engine, bot } = engineWith(new FakeRunner(() => {}));
    bot.start();
    await waitFor(() => engine.store.listByType('engine.note', 50).some((x) => /Discord refused the bot token/.test((x.payload as { message: string }).message)));
    await Bun.sleep(100);
    expect(engine.store.listByType('engine.note', 50).filter((x) => /Discord refused the bot token/.test((x.payload as { message: string }).message))).toHaveLength(1);
    expect(bot.answers()).toBe(true);
  }, 30_000);

  test('Send test message tries the bot in the webhook channel', async () => {
    const { engine } = engineWith(new FakeRunner(() => {}));
    const results = await engine.notifications.test();
    expect(results).toEqual([
      { channel: 'discord', ok: true, error: null },
      { channel: 'discord bot', ok: true, error: null },
    ]);
    expect(dc.posted(/buttons answer in this channel/)!.auth).toBe('Bot BOT-TOKEN');
  }, 30_000);
});

describe('Discord shapes', () => {
  test('a long option list is packed into five rows of five; a status is a disabled button', () => {
    const kb = questionKeyboard('g_1', 1, 0, { options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, 'b');
    const rows = discordComponents(kb) as { components: { custom_id: string; style: number; label: string }[] }[];
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(rows.every((r) => r.components.length <= 5)).toBe(true);
    expect(rows.flatMap((r) => r.components.map((b) => b.custom_id))).toEqual(['q:g_1:1:0:0', 'q:g_1:1:0:1', 'q:g_1:1:0:2', 'q:g_1:1:0:3', 'q:g_1:1:0:4', 'q:g_1:1:0:5', 'q:g_1:1:0:6', 'q:g_1:1:0:w']);
    expect(rows[0]!.components[0]!.style).toBe(1);
    expect(discordComponents(statusRow('✓ Done'))).toEqual([{ type: 1, components: [{ type: 2, style: 2, label: '✓ Done', custom_id: 'x', disabled: true }] }]);
  });

  test("a form's id reads back as what its words answer", () => {
    expect(parseModalId('h:esc_1')).toEqual({ kind: 'hint', escId: 'esc_1' });
    expect(parseModalId('f:esc_1')).toEqual({ kind: 'feedback', escId: 'esc_1' });
    expect(parseModalId('a:g_1:2:3')).toEqual({ kind: 'answer', goalId: 'g_1', round: 2, index: 3 });
    expect(parseModalId('n:g_1:2')).toEqual({ kind: 'note', goalId: 'g_1', round: 2 });
    for (const junk of ['', 'h:', 'a:g_1:x:1', 'z:esc_1', 'n:g_1', 'n:g_1:x']) expect(parseModalId(junk)).toBeNull();
  });
});
