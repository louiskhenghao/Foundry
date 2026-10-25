import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const json = { 'content-type': 'application/json' };

function start(home: string) {
  const engine = new Engine(defaultConfig(ROOT, { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  const app = createApp(engine);
  const send = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
  const list = async () => (await app.request('/api/templates')).json();
  return { engine, app, send, list };
}

const OWN = `---
name: Weekly digest
summary: The digest we send every Monday.
nature: docs
settings:
  mode: simple
  budgetPreset: quick
inputs:
  - key: week
    label: Which week
  - key: tone
    type: choice
    options: [plain, warm]
    default: warm
---

Write the {{week}} digest in a {{tone}} tone.

Highlights: {{highlights}}
`;

test('templates: the built-in ones in both languages, then the person\'s own files, and the files that cannot be used saying why', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-templates-api-'));
  const { engine, list } = start(home);
  const dir = join(home, 'templates');
  try {
    const first = await list();
    expect(first.dir).toBe(dir);
    expect(first.builtInDir).toBe(join(ROOT, 'templates'));
    expect(first.problems).toEqual([]);
    const reel = first.templates.find((t: { id: string }) => t.id === 'video-product-reel');
    expect(reel).toMatchObject({ builtIn: true, nature: 'video', settings: { videoPack: 'motion-studio', mode: 'simple', budgetPreset: 'thorough' } });
    expect(reel.en.name).toBe('Product reel');
    expect(reel.zh.name).toMatch(/[一-鿿]/);
    expect(reel.en.inputs.map((i: { key: string }) => i.key)).toEqual(['duration', 'product', 'url', 'formats', 'message', 'brand', 'music']);
    expect(reel.en.file).toBe(join(ROOT, 'templates', 'video-product-reel.md'));

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'weekly-digest.md'), OWN);
    writeFileSync(join(dir, 'Bad Name.md'), OWN);
    writeFileSync(join(dir, 'video-product-reel.md'), OWN);
    writeFileSync(join(dir, 'broken.md'), '---\nname: Broken\nnature: nowhere\n---\nbody');
    writeFileSync(join(dir, 'no-frontmatter.md'), 'just words');
    writeFileSync(join(dir, 'notes.txt'), 'not a template');
    const after = await list();
    const own = after.templates.filter((t: { builtIn: boolean }) => !t.builtIn);
    expect(own.map((t: { id: string }) => t.id)).toEqual(['weekly-digest']);
    // the body's placeholders are the inputs, in its order; the frontmatter refined two of them
    expect(own[0].en.inputs.map((i: { key: string; type: string }) => [i.key, i.type])).toEqual([['week', 'text'], ['tone', 'choice'], ['highlights', 'text']]);
    expect(own[0].zh).toBeNull();
    expect(own[0].settings).toEqual({ mode: 'simple', budgetPreset: 'quick' });
    expect(after.problems).toEqual([
      { file: 'Bad Name.md', error: expect.stringContaining('rename the file') },
      { file: 'broken.md', error: expect.stringMatching(/^nature: /) },
      { file: 'no-frontmatter.md', error: expect.stringContaining('frontmatter') },
      { file: 'video-product-reel.md', error: 'video-product-reel is the name of a built-in template: rename the file' },
    ]);
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

test('a template of your own: copied from a built-in one, saved, renamed, exported, imported and deleted', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-templates-manage-'));
  const { engine, app, send, list } = start(home);
  const dir = join(home, 'templates');
  const ownIds = async () => ((await list()).templates as { id: string; builtIn: boolean }[]).filter((t) => !t.builtIn).map((t) => t.id);
  try {
    // a copy of a built-in template comes in both its languages, under a name of its own
    const made = await send('POST', '/api/templates', { from: 'docs-prd' });
    expect(made.status).toBe(201);
    const copy = await made.json();
    expect(copy).toMatchObject({ id: 'product-requirements-document-copy', builtIn: false, nature: 'docs' });
    expect(copy.en.file).toBe(join(dir, 'product-requirements-document-copy.md'));
    expect(copy.zh.file).toBe(join(dir, 'product-requirements-document-copy.zh.md'));
    expect(copy.en.name).toBe('Product requirements document copy');
    expect(readFileSync(copy.zh.file, 'utf8')).toContain('\nlang: zh\n');
    expect((await (await send('POST', '/api/templates', { from: 'docs-prd', name: 'Our PRD' })).json()).id).toBe('our-prd');
    expect((await send('POST', '/api/templates', { from: 'nope' })).status).toBe(404);

    // a new template from the editor, in one language
    const fresh = await send('POST', '/api/templates', { template: { lang: 'en', name: 'Release notes', summary: '', nature: 'docs', settings: {}, inputs: [{ key: 'version', type: 'text', other: false }], body: 'Write the release notes for {{version}}.' } });
    expect(fresh.status).toBe(201);
    expect((await fresh.json()).id).toBe('release-notes');
    expect(readFileSync(join(dir, 'release-notes.md'), 'utf8')).toBe('---\nname: Release notes\nnature: docs\n---\n\nWrite the release notes for {{version}}.\n');

    // saved whole: the file follows what the editor says
    const saved = await send('PUT', '/api/templates/release-notes', { lang: 'en', name: 'Release notes', summary: 'What changed.', nature: 'docs', settings: { budgetPreset: 'quick' }, inputs: [{ key: 'version', label: 'Version', type: 'text', other: false }], body: 'Write the release notes for {{version}}, in plain words.' });
    expect(saved.status).toBe(200);
    expect((await saved.json()).en).toMatchObject({ summary: 'What changed.', settings: { budgetPreset: 'quick' }, inputs: [{ key: 'version', label: 'Version' }] });
    expect((await send('PUT', '/api/templates/docs-prd', { lang: 'en', name: 'x', nature: 'docs', inputs: [], body: 'x' })).status).toBe(404);

    // renamed, both files follow; the same name again keeps the files where they are
    const renamed = await send('PATCH', '/api/templates/product-requirements-document-copy', { name: 'Team PRD' });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ id: 'team-prd', en: { name: 'Team PRD', file: join(dir, 'team-prd.md') }, zh: { name: 'Team PRD', file: join(dir, 'team-prd.zh.md') } });
    expect(existsSync(join(dir, 'product-requirements-document-copy.md'))).toBe(false);
    expect((await (await send('PATCH', '/api/templates/team-prd', { name: 'Team prd' })).json()).id).toBe('team-prd');
    expect((await send('PATCH', '/api/templates/docs-prd', { name: 'Mine now' })).status).toBe(404);
    expect(await ownIds()).toEqual(['our-prd', 'release-notes', 'team-prd']);

    // exported as its file, in the language asked for; a built-in one too
    const exported = await app.request('/api/templates/team-prd/file?lang=zh');
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toContain('team-prd.zh.md');
    expect(await exported.text()).toBe(readFileSync(join(dir, 'team-prd.zh.md'), 'utf8'));
    expect((await app.request('/api/templates/docs-prd/file')).headers.get('content-disposition')).toContain('docs-prd.md');

    // imported: under its file's name where that is free; a .zh.md joins the template of its id; a bad file says why
    const text = readFileSync(join(dir, 'release-notes.md'), 'utf8');
    expect(await (await send('POST', '/api/templates/import', { file: 'release-notes.md', text })).json()).toMatchObject({ id: 'release-notes-2', lang: 'en' });
    expect(await (await send('POST', '/api/templates/import', { file: 'release-notes.zh.md', text: text.replace('name: Release notes', 'name: 发布说明') })).json()).toMatchObject({ id: 'release-notes', lang: 'zh', zh: { name: '发布说明' } });
    expect((await (await send('POST', '/api/templates/import', { file: 'docs-prd.md', text })).json()).id).toBe('docs-prd-2');
    const bad = await send('POST', '/api/templates/import', { file: 'bad.md', text: '---\nname: Bad\nnature: video\nsettings:\n  budgetPreset: huge\n---\nbody' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain('settings.budgetPreset');

    // rendered: the words and what is missing
    const rendered = await send('POST', '/api/templates/render', { id: 'release-notes', values: {} });
    expect(await rendered.json()).toMatchObject({ prompt: 'Write the release notes for , in plain words.', missing: ['version'], name: 'Release notes', nature: 'docs' });
    expect((await (await send('POST', '/api/templates/render', { id: 'release-notes', values: { version: '2.16' } })).json()).prompt).toBe('Write the release notes for 2.16, in plain words.');

    // deleted: both files go; a built-in one stays
    expect((await send('DELETE', '/api/templates/team-prd')).status).toBe(200);
    expect(existsSync(join(dir, 'team-prd.md'))).toBe(false);
    expect(existsSync(join(dir, 'team-prd.zh.md'))).toBe(false);
    expect((await send('DELETE', '/api/templates/docs-prd')).status).toBe(404);
    expect(await ownIds()).toEqual(['docs-prd-2', 'our-prd', 'release-notes', 'release-notes-2']);
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

test('opening the templates folder makes it first; a file of your own opens in an editor only', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-templates-open-'));
  const { engine, send } = start(home);
  try {
    const r = await send('POST', '/api/templates/open', { target: 'no-such-app' });
    expect(r.status).toBe(404);
    expect(existsSync(join(home, 'templates'))).toBe(true);
    await send('POST', '/api/templates', { from: 'code-bug-fix' });
    const inFinder = await send('POST', '/api/templates/open', { target: 'finder', template: 'bug-fix-copy' });
    expect(inFinder.status).toBe(400);
    expect(await inFinder.json()).toMatchObject({ code: 'not-an-editor', path: join(home, 'templates', 'bug-fix-copy.md') });
    expect((await send('POST', '/api/templates/open', { target: 'vscode', template: 'code-bug-fix' })).status).toBe(404);
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

test('a goal from a template through the API (as the CLI sends it): the template\'s settings where the request said nothing, per key', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-templates-goal-'));
  const repo = join(home, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: repo });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# r\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'start');
  const { engine, send } = start(home);
  try {
    // the bug-fix template: Quick budget, interview depth 1, TDD required
    const made = await (await send('POST', '/api/goals', { repoPath: repo, template: { id: 'code-bug-fix', values: { symptom: 'The total is wrong.', steps: 'Add ten of one item.', expected: 'Ten percent off once.' } }, workflow: { pace: 'fast' } })).json();
    expect(made.template).toEqual({ id: 'code-bug-fix', name: 'Bug fix' });
    expect(made.budgetPreset).toBe('quick');
    expect(made.budgets.maxCostUsd).toBe(3);
    // the request's pace and the template's discipline, side by side
    expect(made.workflow.pace).toBe('fast');
    expect(made.workflow.tdd).toBe('required');
    expect(made.interview.depth).toBe(1);
    // a template that names no budget: Auto, as the CLI's own default
    const figure = await (await send('POST', '/api/goals', { repoPath: repo, template: { id: 'docs-readme-update', values: { audience: 'new contributors', cover: 'setup' } }, budgetPreset: undefined })).json();
    expect(figure.budgetPreset).toBe('quick');
    const own = join(home, 'templates');
    mkdirSync(own, { recursive: true });
    writeFileSync(join(own, 'plain-note.md'), '---\nname: Plain note\nnature: docs\n---\n\nWrite a note about {{topic}}.\n');
    const plain = await (await send('POST', '/api/goals', { repoPath: repo, template: { id: 'plain-note', values: { topic: 'the cache' } } })).json();
    expect(plain.budgetPreset).toBe('auto');
    // what the request says wins
    const asked = await (await send('POST', '/api/goals', { repoPath: repo, template: { id: 'code-bug-fix', values: { symptom: 's', steps: 't', expected: 'e' } }, budgetPreset: 'thorough' })).json();
    expect(asked.budgetPreset).toBe('thorough');
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

