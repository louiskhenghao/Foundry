import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BriefOutput } from '@foundry/core';
import { getEscalation, getGoal, listTasks } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { raiseEscalation } from '../escalation.ts';
import { FakeRunner, makeRepo, terminal, waitFor } from '../test-helpers.ts';
import { TelegramBot } from './telegram-bot.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const CHAT = 42;

type Call = { method: string; body: any; id: number | null };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

/** Telegram's Bot API as far as Foundry uses it, in-process: updates are queued by the test, every other call is recorded */
class FakeTelegram {
  calls: Call[] = [];
  polls = 0;
  conflict = false;
  private queue: { update_id: number }[] = [];
  private uid = 0;
  private mid = 1000;
  private real = globalThis.fetch;
  install(): void {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(input));
      if (!m) return this.real(input as RequestInfo, init);
      const method = m[1]!;
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      if (method === 'getUpdates') {
        this.polls++;
        if (this.conflict) return json({ ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request; make sure that only one bot instance is running' }, 409);
        const ready = () => this.queue.filter((u) => u.update_id >= (body.offset ?? 0));
        if (!ready().length) await this.hold(init?.signal ?? undefined);
        return json({ ok: true, result: ready() });
      }
      const id = method === 'sendMessage' ? ++this.mid : null;
      this.calls.push({ method, body, id });
      return json({ ok: true, result: id != null ? { message_id: id, chat: { id: Number(body.chat_id) } } : true });
    }) as typeof fetch;
  }
  restore(): void {
    globalThis.fetch = this.real;
  }
  private hold(signal: AbortSignal | undefined): Promise<void> {
    return new Promise((done) => {
      const t = setTimeout(done, 30);
      signal?.addEventListener('abort', () => (clearTimeout(t), done()));
    });
  }
  private push(u: object): void {
    this.queue.push({ update_id: ++this.uid, ...u });
  }
  press(messageId: number, data: string, chat = CHAT): void {
    this.push({ callback_query: { id: `cq${this.uid + 1}`, from: { id: 7, username: 'ann' }, message: { message_id: messageId, chat: { id: chat } }, data } });
  }
  /** the person writes; `replyTo` = the message they reply to. Returns the id of what they wrote */
  write(text: string, replyTo?: number, chat = CHAT): number {
    const id = ++this.mid;
    this.push({ message: { message_id: id, chat: { id: chat, first_name: 'Ann' }, from: { id: 7, first_name: 'Ann' }, text, ...(replyTo ? { reply_to_message: { message_id: replyTo, chat: { id: chat } } } : {}) } });
    return id;
  }
  sent(text: RegExp): Call | undefined {
    return this.calls.find((c) => c.method === 'sendMessage' && text.test(c.body.text));
  }
  /** the button data under a sent message */
  buttons(c: Call | undefined): string[] {
    return (c?.body.reply_markup?.inline_keyboard ?? []).flat().map((b: { callback_data: string }) => b.callback_data);
  }
  /** every set of button labels a message was changed to, in order */
  edits(messageId: number): string[] {
    return this.calls.filter((c) => c.method === 'editMessageReplyMarkup' && c.body.message_id === messageId).map((c) => c.body.reply_markup.inline_keyboard.flat().map((b: { text: string }) => b.text).join(' | '));
  }
  toasts(): string[] {
    return this.calls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.body.text);
  }
}

let dataDir: string;
let repo: string;
let tg: FakeTelegram;
const engines: Engine[] = [];
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-telegram-'));
  repo = await makeRepo();
  tg = new FakeTelegram();
  tg.install();
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  tg.restore();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
  rmSync(`${repo}-foundry`, { recursive: true, force: true });
});

/** an engine whose notifications go to the fake Telegram; Tailscale off, so no test touches this computer's tailnet */
function engineWith(runner: ClaudeRunner, notifications: Record<string, unknown> = {}): Engine {
  const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} }), runner);
  engines.push(engine);
  engine.updateSettings({ notifications: { telegramBotToken: '123:TEST', telegramChatId: String(CHAT), tailscale: 'off', onGoalFinished: false, ...notifications } });
  return engine;
}

/** a finished goal to raise escalations on */
async function doneGoal(engine: Engine) {
  const goal = await engine.createGoal({ prompt: 'noop', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
  await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
  return { goal: getGoal(engine.store.db, goal.id)!, task: listTasks(engine.store.db, goal.id)[0]! };
}

describe('Telegram buttons', () => {
  test('an escalation is answered from its buttons; another chat cannot; an answer in Foundry closes them', async () => {
    const engine = engineWith(new FakeRunner(() => {}));
    engine.telegram.start();
    const { goal, task } = await doneGoal(engine);

    const e1 = raiseEscalation(engine, { goal, task, trigger: 'retries_exhausted', message: 'Task "noop" used 3 attempts without passing its Must checks' });
    await waitFor(() => !!tg.sent(/used 3 attempts/));
    const m1 = tg.sent(/used 3 attempts/)!;
    expect(tg.buttons(m1)).toEqual([`e:${e1.id}:r`, `e:${e1.id}:h`, `e:${e1.id}:s`, `e:${e1.id}:x`]);
    expect(m1.body.text).toContain('reply to this message with a hint');

    tg.press(m1.id!, `e:${e1.id}:s`, 99);
    await waitFor(() => tg.toasts().some((t) => /only the chat/.test(t)));
    expect(getEscalation(engine.store.db, e1.id)!.state).toBe('open');

    tg.press(m1.id!, `e:${e1.id}:s`);
    await waitFor(() => getEscalation(engine.store.db, e1.id)!.state === 'answered');
    expect(getEscalation(engine.store.db, e1.id)!.answer).toEqual({ action: 'skip_task' });
    await waitFor(() => tg.edits(m1.id!).some((l) => /^✓ Skipped · /.test(l)));
    expect(tg.toasts()).toContain('Skipped: the tasks after it go on.');
    expect(engine.store.listByGoal(goal.id, 5000).some((e) => e.type === 'engine.note' && /Skipped from Telegram by @ann/.test((e.payload as { message: string }).message))).toBe(true);

    // a reply to the message is a hint
    const e2 = raiseEscalation(engine, { goal, task, trigger: 'permission_denial', message: 'The coding agent refused Bash(rm -rf build)' });
    await waitFor(() => !!tg.sent(/refused Bash/));
    const m2 = tg.sent(/refused Bash/)!;
    const mine = tg.write('use the fixture in test/data', m2.id!);
    await waitFor(() => getEscalation(engine.store.db, e2.id)!.state === 'answered');
    expect(getEscalation(engine.store.db, e2.id)!.answer).toEqual({ action: 'retry_with_hint', hint: 'use the fixture in test/data', extraAttempts: 1 });
    await waitFor(() => !!tg.sent(/Retrying with your hint/));
    expect(tg.sent(/Retrying with your hint/)!.body.reply_parameters.message_id).toBe(mine);
    await waitFor(() => tg.edits(m2.id!).some((l) => /Retried with your hint/.test(l)));

    // answered in the Inbox: the chat's buttons close
    const e3 = raiseEscalation(engine, { goal, trigger: 'budget_exceeded', message: 'The goal hit its budget' });
    await waitFor(() => !!tg.sent(/hit its budget/));
    const m3 = tg.sent(/hit its budget/)!;
    expect(tg.buttons(m3)).toEqual([`e:${e3.id}:b`, `e:${e3.id}:x`]);
    await engine.answerEscalation(e3.id, { action: 'raise_budget' });
    await waitFor(() => tg.edits(m3.id!).some((l) => /^✓ Answered · /.test(l)));
  }, 30_000);

  test('a command outside the workspace can be denied from the chat, and the message says where it is approved', async () => {
    const engine = engineWith(new FakeRunner(() => {}));
    engine.telegram.start();
    const { goal, task } = await doneGoal(engine);
    const e = raiseEscalation(engine, { goal, task, trigger: 'boundary_action', message: 'wants to run `git push origin main`', payload: { command: 'git push origin main' } });
    await waitFor(() => !!tg.sent(/git push origin main/));
    const m = tg.sent(/git push origin main/)!;
    expect(tg.buttons(m)).toEqual([`e:${e.id}:d`]);
    expect(m.body.text).toContain('Approve it in the Inbox');
    // a forged approval is refused: the chat never runs the command
    tg.press(m.id!, `e:${e.id}:a`);
    await waitFor(() => tg.toasts().includes('That answer does not apply here.'));
    expect(getEscalation(engine.store.db, e.id)!.state).toBe('open');
    tg.press(m.id!, `e:${e.id}:d`);
    await waitFor(() => getEscalation(engine.store.db, e.id)!.answer?.action === 'deny');
  }, 30_000);

  test('/inbox sends again what waits; words that answer nothing get the help', async () => {
    const engine = engineWith(new FakeRunner(() => {}));
    engine.telegram.start();
    const { goal, task } = await doneGoal(engine);
    const e = raiseEscalation(engine, { goal, task, trigger: 'retries_exhausted', message: 'Task "noop" is stuck' });
    await waitFor(() => !!tg.sent(/is stuck/));
    tg.write('/inbox@my_foundry_bot');
    await waitFor(() => tg.calls.filter((c) => c.method === 'sendMessage' && /is stuck/.test(c.body.text)).length === 2);
    expect(tg.buttons(tg.calls.filter((c) => c.method === 'sendMessage' && /is stuck/.test(c.body.text))[1])).toContain(`e:${e.id}:r`);
    tg.write('hello?');
    await waitFor(() => !!tg.sent(/Foundry answers here/));
  }, 30_000);

  test('the reader notes once that something else reads the bot, and carries on when it stops', async () => {
    const engine = engineWith(new FakeRunner(() => {}));
    const bot = new TelegramBot(engine, { conflictMs: 10 });
    tg.conflict = true;
    bot.start();
    await waitFor(() => tg.polls >= 4);
    const notes = () => engine.store.listByType('engine.note', 100).filter((e) => /something else reads this bot/.test((e.payload as { message: string }).message));
    expect(notes()).toHaveLength(1);
    tg.conflict = false;
    const before = tg.polls;
    await waitFor(() => tg.polls >= before + 2);
    await bot.stop();
  }, 30_000);

  test('Detect learns the chat that wrote last while Foundry reads the bot, and only the chat in Settings is answered', async () => {
    const engine = engineWith(new FakeRunner(() => {}));
    engine.telegram.start();
    expect(engine.telegram.reads('123:TEST')).toBe(true);
    expect(engine.telegram.reads('456:OTHER')).toBe(false);
    tg.write('hi', undefined, 77);
    await waitFor(() => engine.telegram.seenChat('123:TEST')?.chatId === '77');
    expect(engine.telegram.seenChat('123:TEST')).toEqual({ chatId: '77', who: 'Ann' });
    await Bun.sleep(100);
    expect(tg.calls.filter((c) => c.method === 'sendMessage')).toEqual([]);
  }, 30_000);

  test('with the switch off nothing reads the bot and messages carry no buttons', async () => {
    const engine = engineWith(new FakeRunner(() => {}), { telegramActions: false });
    engine.telegram.start();
    const { goal, task } = await doneGoal(engine);
    raiseEscalation(engine, { goal, task, trigger: 'retries_exhausted', message: 'Task "noop" is stuck' });
    await waitFor(() => !!tg.sent(/is stuck/));
    expect(tg.sent(/is stuck/)!.body.reply_markup).toBeUndefined();
    expect(tg.polls).toBe(0);
  }, 30_000);
});

/** answers every session with a scripted structured output by call index (the nature classification apart) */
class StructuredRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  private mainCalls = 0;
  constructor(private answers: (n: number) => unknown) {}
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const structuredOutput = spec.label?.startsWith('classify nature') ? { nature: 'code' } : this.answers(++this.mainCalls);
    const result: RunResult = { sessionId: `s${this.calls.length}`, subtype: 'success', isError: false, costUsd: 0.5, numTurns: 3, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: JSON.stringify(structuredOutput), structuredOutput, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'init', sessionId: result.sessionId!, model: 'fake', tools: [], raw: {} }, { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}
const areas = [{ key: 'A1', name: 'Settings', slug: 'settings', description: 'the settings screen' }];
const task = (key: string, title: string): BriefOutput['tasks'][number] => ({ key, title, spec: `do ${title}`, kind: 'feature', scope: null, scenario: 'frontend', difficulty: 'standard', areaKey: 'A1', dependsOnKeys: [], parallelizable: true, relevantFiles: ['README.md'], milestone: null });
const fullBrief = (): BriefOutput => ({ title: 'feat(settings): dark mode', understanding: 'A dark theme for the settings screen.', nature: 'code', areas, assumptions: ['a'], tasks: [task('T1', 'add the dark theme')], checks: [{ key: 'C1', name: 'C1', tier: 'must', taskKey: 'T1', areaKey: null, type: 'command', cmd: 'true', rubric: null }], costEstimateUsd: 4, timeEstimateMin: 30, openQuestions: [], styleOptions: [], run: null, apps: null });
const q = (key: string, text: string, options: string[], blocking = true) => ({ key, text, options, reason: `found nothing about ${text}`, dependsOn: null, blocking });

test('an interview round is answered from Telegram, then the Brief approved', async () => {
  const runner = new StructuredRunner((n) => (n === 1 ? { questions: [q('R1Q1', 'Which database?', ['Postgres', 'SQLite']), q('R1Q2', 'Accounts?', ['none', 'email'], false)], brief: null } : { questions: [], brief: fullBrief() }));
  const engine = engineWith(runner);
  engine.telegram.start();
  const goal = await engine.createGoal({ prompt: 'dark mode for the settings screen', repoPath: repo });
  // the first line of every message is its title, in bold
  await waitFor(() => !!tg.sent(/^<b>Round 1: when you are done<\/b>/));
  const intro = tg.sent(/^<b>❓ Round 1 — /)!;
  const q1 = tg.sent(/^<b>Q1 · blocking<\/b>/)!;
  const controls = tg.sent(/^<b>Round 1: when you are done<\/b>/)!;
  expect(intro.body.text).toContain('2 questions before the plan is written');
  expect(tg.buttons(q1)).toEqual([`q:${goal.id}:1:0:0`, `q:${goal.id}:1:0:1`, `q:${goal.id}:1:0:w`]);
  expect(tg.buttons(controls)).toEqual([`r:${goal.id}:1:a`, `r:${goal.id}:1:n`, `r:${goal.id}:1:s`, `r:${goal.id}:1:e`]);

  tg.press(q1.id!, `q:${goal.id}:1:0:1`);
  await waitFor(() => tg.edits(q1.id!).some((l) => l.includes('✓ SQLite')));
  // words in reply to the round's own message are a note: kept with the answers, shown on the round's buttons
  tg.write('keep the old login page too', controls.id!);
  await waitFor(() => tg.edits(controls.id!).some((l) => l.includes('✓ ✍️ keep the old login page too')));
  tg.press(controls.id!, `r:${goal.id}:1:s`);
  await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
  expect(getGoal(engine.store.db, goal.id)!.interview!.rounds[0]).toMatchObject({ answers: { R1Q1: 'SQLite' }, note: 'keep the old login page too' });
  await waitFor(() => tg.edits(q1.id!).some((l) => /^✓ SQLite$/.test(l)));

  await waitFor(() => !!tg.sent(/Brief ready/));
  const ready = tg.sent(/Brief ready/)!;
  expect(ready.body.text).toContain('1 task · estimate $4.00 · ~30 min');
  expect(tg.buttons(ready)).toEqual([`b:${goal.id}:a`]);
  tg.press(ready.id!, `b:${goal.id}:a`);
  await waitFor(() => tg.edits(ready.id!).some((l) => l.includes('Yes, approve and run')));
  tg.press(ready.id!, `b:${goal.id}:A`);
  await waitFor(() => getGoal(engine.store.db, goal.id)!.state !== 'awaiting_brief_approval');
  expect(listTasks(engine.store.db, goal.id).map((t) => t.title)).toEqual(['add the dark theme']);
  await waitFor(() => tg.edits(ready.id!).some((l) => /^✓ Approved · /.test(l)));
  engine.cancelGoal(goal.id);
}, 30_000);
