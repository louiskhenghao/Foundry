import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiscordNotifier, TelegramNotifier, fitting, mediaType, reachableUrl, type MediaFile } from './channels.ts';

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
    expect(JSON.parse(String(form.get('media')))).toEqual([{ type: 'photo', media: 'attach://f0', caption: '<b>look</b>', parse_mode: 'HTML' }, { type: 'photo', media: 'attach://f1' }, { type: 'video', media: 'attach://f2' }]);
    calls = capture();
    await new TelegramNotifier('tok', '42').sendMedia('look', files, [{ label: 'Open', url: 'https://mac.ts.net/goals/g1' }]);
    expect(JSON.parse(String((calls[0]!.body as FormData).get('media')))[0]).toEqual({ type: 'photo', media: 'attach://f0', caption: '<b>look</b>\n<a href="https://mac.ts.net/goals/g1">Open</a>', parse_mode: 'HTML' });
    calls = capture();
    await new DiscordNotifier('https://discord.test/hook').sendMedia('look', files);
    const d = calls[0]!.body as FormData;
    expect(JSON.parse(String(d.get('payload_json')))).toEqual({ content: '**look**', allowed_mentions: { parse: [] } });
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

test('files are uploaded with the content type of their format', () => {
  expect([mediaType({ path: '/x/a.JPG', kind: 'photo' }), mediaType({ path: '/x/b.webp', kind: 'photo' }), mediaType({ path: '/x/c.mp4', kind: 'video' }), mediaType({ path: '/x/d.mov', kind: 'video' }), mediaType({ path: '/x/shot', kind: 'photo' })]).toEqual(['image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime', 'image/png']);
});

describe('a picture Telegram refuses', () => {
  const telegram = (refuse: (method: string, body: FormData | string) => boolean) => {
    const methods: string[] = [];
    const sent: { method: string; body: FormData | string }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      const method = String(url).split('/').pop()!;
      methods.push(method);
      if (refuse(method, init.body as FormData | string)) return new Response('{"ok":false,"description":"Bad Request: PHOTO_INVALID_DIMENSIONS"}', { status: 400 });
      sent.push({ method, body: init.body as FormData | string });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    return { methods, sent };
  };

  test('goes as a file instead of a photo, so the picture still arrives', async () => {
    const { methods, sent } = telegram((m) => m === 'sendPhoto');
    await new TelegramNotifier('tok', '42').sendMedia('look', [file('wide.png', 10, 'photo')]);
    expect(methods).toEqual(['sendPhoto', 'sendPhoto', 'sendDocument']);
    expect((sent[0]!.body as FormData).get('document')).toBeTruthy();
    // several refused pictures go as one album of files
    const media = (body: FormData | string) => JSON.parse(String((body as FormData).get('media'))) as { type: string }[];
    const album = telegram((m, body) => m === 'sendMediaGroup' && media(body).some((x) => x.type === 'photo'));
    await new TelegramNotifier('tok', '42').sendMedia('look', [file('a.png', 10, 'photo'), file('b.png', 10, 'photo')]);
    expect(album.methods).toEqual(['sendMediaGroup', 'sendMediaGroup', 'sendMediaGroup']);
    expect(media(album.sent[0]!.body).map((x) => x.type)).toEqual(['document', 'document']);
  });

  test('refused even as a file, the text goes alone, saying the files could not be attached', async () => {
    const { methods, sent } = telegram((m) => m === 'sendPhoto' || m === 'sendDocument');
    await new TelegramNotifier('tok', '42').sendMedia('look', [file('wide.png', 10, 'photo')]);
    expect(methods).toEqual(['sendPhoto', 'sendPhoto', 'sendDocument', 'sendDocument', 'sendMessage']);
    const text = JSON.parse(String(sent[0]!.body)).text;
    expect(text).toContain('look');
    expect(text).toContain('could not be attached');
  });
});

describe('Discord', () => {
  test('acts on no mention in a message: a file name with @everyone pings nobody', async () => {
    const calls = capture();
    await new DiscordNotifier('https://discord.test/hook').send('look at @everyone.png');
    expect(JSON.parse(String(calls[0]!.body)).allowed_mentions).toEqual({ parse: [] });
  });
});

describe('links', () => {
  test('Telegram gets named links in HTML, and the addresses written out when it refuses them', async () => {
    const calls: { body: any }[] = [];
    let first = true;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      calls.push({ body: JSON.parse(String(init.body)) });
      if (first) {
        first = false;
        return new Response('Bad Request: wrong HTTP URL', { status: 400 });
      }
      return new Response('{}');
    }) as typeof fetch;
    await new TelegramNotifier('tok', '42').send('Goal <done> & dusted\nall checks pass', [{ label: 'Open in Foundry', url: 'https://foundry.example.com/goals/g1' }]);
    expect(calls[0]!.body).toMatchObject({ parse_mode: 'HTML', text: '<b>Goal &lt;done&gt; &amp; dusted</b>\nall checks pass\n<a href="https://foundry.example.com/goals/g1">Open in Foundry</a>' });
    expect(calls[1]!.body.text).toBe('Goal <done> & dusted\nall checks pass\nOpen in Foundry: https://foundry.example.com/goals/g1');
    expect(calls[1]!.body.parse_mode).toBeUndefined();
  });

  test('an address only this computer can open is written out as code on Telegram, not dropped as a dead link', async () => {
    const calls = capture();
    await new TelegramNotifier('tok', '42').send('done', [{ label: 'Open in Foundry', url: 'http://localhost:4111/goals/g1' }]);
    expect(JSON.parse(String(calls[0]!.body))).toMatchObject({ parse_mode: 'HTML', text: '<b>done</b>\nOpen in Foundry: <code>http://localhost:4111/goals/g1</code>' });
    expect([reachableUrl('http://localhost:4111/x'), reachableUrl('http://127.0.0.1:4111'), reachableUrl('http://mac:4111'), reachableUrl('https://mac.tail1.ts.net/x'), reachableUrl('http://192.168.1.5:4111')]).toEqual([false, false, false, true, true]);
  });

  test('Discord gets masked links that unfold no preview', async () => {
    const calls = capture();
    await new DiscordNotifier('https://discord.test/hook').send('done', [{ label: 'Open on your tailnet', url: 'https://mac.ts.net/goals/g1' }]);
    expect(JSON.parse(String(calls[0]!.body)).content).toBe('**done**\n[Open on your tailnet](<https://mac.ts.net/goals/g1>)');
  });
});

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
