import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const main = resolve(import.meta.dir, 'main.ts');

/** a server that answers the Templates API as the CLI expects, and remembers what it was sent */
function serve() {
  const sent: { path: string; method: string; body: unknown }[] = [];
  const entry = { id: 'video-product-reel', builtIn: true, nature: 'video', settings: {}, en: { lang: 'en', name: 'Product reel', summary: 'A short film.', inputs: [] }, zh: { lang: 'zh', name: '产品 reel', summary: '', inputs: [] } };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
      sent.push({ path: url.pathname + url.search, method: request.method, body });
      if (url.pathname === '/api/goals' && request.method === 'POST') return Response.json({ id: 'g_1', title: 'Product reel', state: 'draft' });
      if (url.pathname === '/api/templates') return Response.json({ templates: [entry, { ...entry, id: 'weekly-digest', builtIn: false, nature: 'docs', zh: null }], problems: [{ file: 'broken.md', error: 'no frontmatter' }] });
      if (url.pathname === '/api/templates/weekly-digest/file') return new Response('---\nname: Weekly digest\nnature: docs\n---\n\nWrite the {{week}} digest.\n', { headers: { 'content-type': 'text/markdown' } });
      if (url.pathname === '/api/templates/import') return Response.json({ id: 'weekly-digest-2', lang: 'en', builtIn: false, nature: 'docs', en: { name: 'Weekly digest' }, zh: null });
      return new Response('Unexpected request', { status: 404 });
    },
  });
  return { server, sent, url: `http://127.0.0.1:${server.port}` };
}

async function run(args: string[], url: string, cwd?: string) {
  const child = Bun.spawn([process.execPath, main, ...args], { env: { FOUNDRY_URL: url, PATH: process.env.PATH }, stdout: 'pipe', stderr: 'pipe', cwd });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { exitCode, stdout, stderr };
}

describe('CLI templates (ADR-0079)', () => {
  test('goal new --template sends the template and its --set values, with no prompt of its own', async () => {
    const { server, sent, url } = serve();
    try {
      const r = await run(['goal', 'new', '--template', 'video-product-reel', '--lang', 'zh', '--set', 'product=Foundry', '--set', 'message=a goal in, a pull request out', '--repo', '/tmp/foundry-cli-fixture'], url);
      expect(r.stderr).toBe('');
      expect(r.exitCode).toBe(0);
      const body = sent.find((s) => s.path === '/api/goals')!.body as Record<string, unknown>;
      expect(body.prompt).toBeUndefined();
      expect(body.template).toEqual({ id: 'video-product-reel', lang: 'zh', values: { product: 'Foundry', message: 'a goal in, a pull request out' } });
      expect(r.stdout).toContain('created goal g_1');
      // no budget or workflow flag spoke: the template's own settings decide them on the server
      expect(body.budgetPreset).toBeUndefined();
      expect(body.budgets).toBeUndefined();
      expect(body.workflow).toBeUndefined();
      // a flag still wins over the template
      await run(['goal', 'new', '--template', 'video-product-reel', '--set', 'product=Foundry', '--preset', 'thorough', '--max-cost', '7', '--repo', '/tmp/foundry-cli-fixture'], url);
      const flagged = sent.filter((s) => s.path === '/api/goals').at(-1)!.body as Record<string, unknown>;
      expect(flagged.budgetPreset).toBe('thorough');
      expect(flagged.budgets).toEqual({ maxCostUsd: 7 });
      // without a template the CLI's default stays Auto
      await run(['goal', 'new', 'Fix the footer', '--repo', '/tmp/foundry-cli-fixture'], url);
      expect((sent.filter((s) => s.path === '/api/goals').at(-1)!.body as Record<string, unknown>).budgetPreset).toBe('auto');
      // a --set without an equals sign is refused before anything is sent
      const bad = await run(['goal', 'new', '--template', 'video-product-reel', '--set', 'product', '--repo', '/tmp/x'], url);
      expect(bad.exitCode).not.toBe(0);
      expect(bad.stderr).toContain('--set takes key=value');
    } finally {
      server.stop(true);
    }
  });

  test('templates lists them, exports a file and imports one', async () => {
    const { server, sent, url } = serve();
    const dir = mkdtempSync(join(tmpdir(), 'foundry-cli-templates-'));
    try {
      const list = await run(['templates'], url);
      expect(list.exitCode).toBe(0);
      expect(list.stdout).toContain('video-product-reel');
      expect(list.stdout).toContain('built in');
      expect(list.stdout).toContain('EN · 中文');
      expect(list.stdout).toContain('weekly-digest');
      expect(list.stdout).toContain('yours');
      expect(list.stdout).toContain('cannot use broken.md: no frontmatter');
      const asJson = await run(['templates', 'list', '--json'], url);
      expect(JSON.parse(asJson.stdout).templates).toHaveLength(2);

      const exported = await run(['templates', 'export', 'weekly-digest', '--out', join(dir, 'digest.md')], url);
      expect(exported.exitCode).toBe(0);
      expect(readFileSync(join(dir, 'digest.md'), 'utf8')).toContain('name: Weekly digest');

      writeFileSync(join(dir, 'weekly-digest.md'), '---\nname: Weekly digest\nnature: docs\n---\n\nbody\n');
      const imported = await run(['templates', 'import', join(dir, 'weekly-digest.md')], url);
      expect(imported.exitCode).toBe(0);
      expect(imported.stdout).toContain('imported weekly-digest-2 (English): Weekly digest');
      expect(sent.find((s) => s.path === '/api/templates/import')!.body).toEqual({ file: 'weekly-digest.md', text: '---\nname: Weekly digest\nnature: docs\n---\n\nbody\n' });
      expect((await run(['templates', 'nope'], url)).exitCode).not.toBe(0);
    } finally {
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
