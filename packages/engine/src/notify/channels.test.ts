import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiscordNotifier, TelegramNotifier, fitting, type MediaFile } from './channels.ts';

const dir = mkdtempSync(join(tmpdir(), 'foundry-channels-'));
const file = (name: string, bytes: number, kind: MediaFile['kind']): MediaFile => {
  writeFileSync(join(dir, name), Buffer.alloc(bytes));
  return { path: join(dir, name), kind };
};
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const capture = () => {
  const calls: { url: string; body: FormData | string }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: init.body as FormData | string });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return calls;
};

describe('media in notifications', () => {
  test('files over a limit are left out, and a left-out video is mentioned', () => {
    const shot = file('a.png', 10, 'photo');
    const big = file('w.webm', 2_000, 'video');
    expect(fitting([shot, big], { photo: 100, video: 1_000, total: 5_000, count: 10 })).toEqual({ files: [shot], note: expect.stringContaining('too large') });
    expect(fitting([shot, big], { photo: 100, video: 5_000, total: 5_000, count: 10 })).toEqual({ files: [shot, big], note: null });
  });

  test('Telegram sends several files as one album with the caption on the first; Discord attaches them to the webhook message', async () => {
    const files = [file('1.png', 10, 'photo'), file('2.png', 10, 'photo'), file('w.webm', 10, 'video')];
    let calls = capture();
    await new TelegramNotifier('tok', '42').sendMedia('look', files);
    expect(calls[0]!.url).toEndWith('/sendMediaGroup');
    const form = calls[0]!.body as FormData;
    expect(JSON.parse(String(form.get('media')))).toEqual([{ type: 'photo', media: 'attach://f0', caption: 'look' }, { type: 'photo', media: 'attach://f1' }, { type: 'video', media: 'attach://f2' }]);
    calls = capture();
    await new DiscordNotifier('https://discord.test/hook').sendMedia('look', files);
    const d = calls[0]!.body as FormData;
    expect(JSON.parse(String(d.get('payload_json')))).toEqual({ content: 'look' });
    expect([...d.keys()].filter((k) => k.startsWith('files['))).toEqual(['files[0]', 'files[1]', 'files[2]']);
  });

  test('a single video goes to Telegram as a video; nothing that fits sends the text alone', async () => {
    let calls = capture();
    await new TelegramNotifier('tok', '42').sendMedia('look', [file('v.webm', 10, 'video')]);
    expect(calls[0]!.url).toEndWith('/sendVideo');
    calls = capture();
    await new DiscordNotifier('https://discord.test/hook').sendMedia('look', [file('huge.webm', 10_000_001, 'video')]);
    expect(JSON.parse(String(calls[0]!.body)).content).toContain('too large');
  });
});

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
