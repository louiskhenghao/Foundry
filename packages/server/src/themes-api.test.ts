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
    expect(first.themes.map((t: { id: string }) => t.id)).toEqual(['wayfinding', 'classic']);
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
    expect(after.themes.map((t: { id: string }) => t.id)).toEqual(['wayfinding', 'classic', 'classic-2', 'night-shift', 'wayfinding-copy', 'wayfinding-copy-2']);
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
    const r = await app.request('/api/themes/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'no-such-app' }) });
    expect(r.status).toBe(404);
    expect(existsSync(join(home, 'themes', 'theme.schema.json'))).toBe(true);
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);
