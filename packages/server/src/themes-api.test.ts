import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

test('themes: the built-in ones, copies to edit by hand, and files that cannot be used saying why', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-themes-api-'));
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  const app = createApp(engine);
  const dir = join(home, 'themes');
  const list = async () => (await app.request('/api/themes')).json();
  const copy = (body: unknown) => app.request('/api/themes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const first = await list();
    expect(first.dir).toBe(dir);
    expect(first.themes.map((t: { id: string }) => t.id)).toEqual(['wayfinding', 'ledger', 'classic']);
    expect(first.problems).toEqual([]);

    const made = await copy({ from: 'wayfinding' });
    expect(made.status).toBe(201);
    const entry = await made.json();
    expect(entry).toMatchObject({ id: 'wayfinding-copy', builtIn: false, file: join(dir, 'wayfinding-copy.json'), theme: { name: 'Wayfinding copy' } });
    // the file names the schema written beside it, so an editor checks it and explains each setting
    const written = JSON.parse(readFileSync(entry.file, 'utf8'));
    expect(written.$schema).toBe('./theme.schema.json');
    expect(written.light.you).toBe('#ffc61a');
    expect(JSON.parse(readFileSync(join(dir, 'theme.schema.json'), 'utf8')).properties.light.properties.you.description).toContain('waits for you');

    expect((await (await copy({ from: 'wayfinding' })).json()).id).toBe('wayfinding-copy-2');
    expect((await (await copy({ from: 'classic', name: 'Night shift' })).json()).id).toBe('night-shift');
    // a copy of a copy is a copy like any other
    expect((await (await copy({ from: 'night-shift', name: 'Classic' })).json()).id).toBe('classic-2');
    expect((await copy({ from: 'nope' })).status).toBe(404);

    writeFileSync(join(dir, 'Bad Name.json'), '{}');
    writeFileSync(join(dir, 'wayfinding.json'), JSON.stringify(written));
    writeFileSync(join(dir, 'broken.json'), JSON.stringify({ ...written, dark: { ...written.dark, page: 'black' } }));
    writeFileSync(join(dir, 'notes.txt'), 'not a theme');
    const after = await list();
    expect(after.themes.map((t: { id: string }) => t.id)).toEqual(['wayfinding', 'ledger', 'classic', 'classic-2', 'night-shift', 'wayfinding-copy', 'wayfinding-copy-2']);
    expect(after.problems).toEqual([
      { file: 'Bad Name.json', error: expect.stringContaining('rename the file') },
      { file: 'broken.json', error: 'dark.page: a colour is written #rgb or #rrggbb, e.g. #1f2933' },
      { file: 'wayfinding.json', error: 'wayfinding is the name of a built-in theme: rename the file' },
    ]);
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

test('opening the themes folder makes it first, and names an app that is not there', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-themes-open-'));
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  const app = createApp(engine);
  try {
    mkdirSync(join(home, 'claude'), { recursive: true });
    const open = (body: unknown) => app.request('/api/themes/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const r = await open({ target: 'no-such-app' });
    expect(r.status).toBe(404);
    expect(existsSync(join(home, 'themes', 'theme.schema.json'))).toBe(true);
    // one theme of your own opens as its file, in an editor only; a built-in theme has no file, an unknown one is not there
    await app.request('/api/themes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: 'classic' }) });
    const inFinder = await open({ target: 'finder', theme: 'classic-copy' });
    expect(inFinder.status).toBe(400);
    expect(await inFinder.json()).toMatchObject({ code: 'not-an-editor', path: join(home, 'themes', 'classic-copy.json') });
    expect((await open({ target: 'vscode', theme: 'classic' })).status).toBe(404);
    expect((await open({ target: 'vscode', theme: 'nope' })).status).toBe(404);
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

test('a theme of your own can be renamed, exported and deleted; a theme file can be imported', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-themes-manage-'));
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  const app = createApp(engine);
  const dir = join(home, 'themes');
  const send = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ids = async () => ((await (await app.request('/api/themes')).json()).themes as { id: string }[]).map((t) => t.id);
  try {
    await send('POST', '/api/themes', { from: 'classic' });

    // renamed, its file follows its name; what else the file says stays as written
    const renamed = await send('PATCH', '/api/themes/classic-copy', { name: 'Night shift' });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ id: 'night-shift', builtIn: false, file: join(dir, 'night-shift.json'), theme: { name: 'Night shift' } });
    expect(existsSync(join(dir, 'classic-copy.json'))).toBe(false);
    const written = JSON.parse(readFileSync(join(dir, 'night-shift.json'), 'utf8'));
    expect(written).toMatchObject({ $schema: './theme.schema.json', name: 'Night shift' });
    expect(await ids()).toEqual(['wayfinding', 'ledger', 'classic', 'night-shift']);
    // the same name again keeps the file where it is
    expect((await (await send('PATCH', '/api/themes/night-shift', { name: 'Night Shift' })).json()).id).toBe('night-shift');
    expect((await send('PATCH', '/api/themes/classic', { name: 'Mine now' })).status).toBe(404);
    expect((await send('PATCH', '/api/themes/night-shift', { name: '  ' })).status).toBe(400);

    // exported: the file as it is, to save
    const exported = await app.request('/api/themes/night-shift/file');
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toContain('night-shift.json');
    expect(await exported.text()).toBe(readFileSync(join(dir, 'night-shift.json'), 'utf8'));
    expect((await app.request('/api/themes/classic/file')).status).toBe(404);

    // imported: checked as the folder's files are, under its file's name where that is free
    const paper = { name: 'Paper', light: { page: '#f4f1ea', panel: '#fffdf8', line: '#e2dccf', ink: '#2b2622' }, dark: { page: '#16130f', panel: '#201c17', line: '#36302a', ink: '#efe9df' } };
    const imported = await send('POST', '/api/themes/import', { file: 'Paper.json', text: JSON.stringify({ $schema: 'https://example.com/elsewhere.json', ...paper }) });
    expect(imported.status).toBe(201);
    expect(await imported.json()).toMatchObject({ id: 'paper', builtIn: false, theme: { name: 'Paper' } });
    expect(JSON.parse(readFileSync(join(dir, 'paper.json'), 'utf8')).$schema).toBe('./theme.schema.json');
    expect((await (await send('POST', '/api/themes/import', { file: 'paper.json', text: JSON.stringify(paper) })).json()).id).toBe('paper-2');
    expect((await (await send('POST', '/api/themes/import', { file: 'wayfinding.json', text: JSON.stringify(paper) })).json()).id).toBe('wayfinding-2');
    const bad = await send('POST', '/api/themes/import', { file: 'broken.json', text: JSON.stringify({ ...paper, light: { ...paper.light, page: 'beige' } }) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain('light.page');
    expect((await send('POST', '/api/themes/import', { file: 'notes.json', text: 'not json' })).status).toBe(400);

    // deleted: its file is gone, a built-in theme stays
    expect((await send('DELETE', '/api/themes/night-shift')).status).toBe(200);
    expect(existsSync(join(dir, 'night-shift.json'))).toBe(false);
    expect((await send('DELETE', '/api/themes/classic')).status).toBe(404);
    expect(await ids()).toEqual(['wayfinding', 'ledger', 'classic', 'paper', 'paper-2', 'wayfinding-2']);
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);
