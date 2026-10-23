import { afterAll, beforeAll, expect, test } from 'bun:test';
import { HindsightBackend } from './client.ts';

/** a Hindsight server in miniature: the routes Foundry calls, answering in the shapes the real one does, and keeping every request */
const hits: { method: string; path: string; auth: string | null; body: any }[] = [];
let server: ReturnType<typeof Bun.serve>;
const disposition = { skepticism: 3, literalism: 3, empathy: 3 };
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === 'GET' ? null : await req.json().catch(() => null);
      hits.push({ method: req.method, path: decodeURIComponent(url.pathname) + url.search, auth: req.headers.get('authorization'), body });
      const json = (o: unknown, status = 200) => Response.json(o, { status });
      if (url.pathname === '/version') return json({ api_version: '1.1.0-fake', features: {} });
      if (url.pathname === '/v1/default/banks' && req.method === 'GET') {
        const all = ['coding-agent::app', 'other'];
        const offset = Number(url.searchParams.get('offset') ?? 0);
        return json({ banks: all.slice(offset).map((bank_id) => ({ bank_id, name: bank_id, disposition })), total: all.length, limit: Number(url.searchParams.get('limit') ?? 200), offset });
      }
      const bank = decodeURIComponent(url.pathname.split('/')[4] ?? '');
      if (/^\/v1\/default\/banks\/[^/]+$/.test(url.pathname) && req.method === 'PUT') return json({ bank_id: bank, name: body?.name ?? null, mission: body?.mission ?? null, background: null, disposition });
      if (url.pathname.endsWith('/documents') && req.method === 'GET') return json(bank.includes('empty') ? { items: [], total: 0, limit: 1, offset: 0 } : { items: [{ id: 'd1', bank_id: bank }], total: 7, limit: 1, offset: 0 });
      if (url.pathname.endsWith('/memories') && req.method === 'POST') return json({ success: true, bank_id: bank, items_count: body?.items?.length ?? 0, async: !!body?.async });
      if (url.pathname.endsWith('/reflect') && req.method === 'POST') return json({ text: `answer to: ${body?.query}`, based_on: null });
      if (url.pathname.endsWith('/memories/recall') && req.method === 'POST') return json({ results: [{ id: 'm1', text: 'fact one', type: 'world' }, { id: 'm2', text: 'fact two', type: 'experience' }, { id: 'm3', text: '  ' }] });
      if (url.pathname.endsWith('/knowledge-base/tree') && req.method === 'GET') return json({ roots: [{ id: 'f1', kind: 'folder', name: 'Initiatives' }, { id: 'kp-1', kind: 'page', name: 'Component map' }] });
      if (url.pathname.endsWith('/knowledge-base/pages') && req.method === 'POST') return json({ page_id: 'kp-2', mental_model_id: 'mm-2' });
      return json({ detail: `no route ${req.method} ${url.pathname}` }, 404);
    },
  });
});
afterAll(() => server.stop(true));

test("the client speaks Hindsight's REST — version, banks, documents, retain, reflect — with the token as a bearer header on every call", async () => {
  hits.length = 0;
  const b = new HindsightBackend({ url: `http://127.0.0.1:${server.port}/`, token: 'tok-1' });
  expect(await b.version()).toBe('1.1.0-fake');
  expect(await b.listBanks()).toEqual(['coding-agent::app', 'other']);
  await b.createBank('coding-agent::new', { name: 'new', mission: 'remember this repository' });
  expect(await b.hasDocuments('coding-agent::app')).toBe(true);
  expect(await b.hasDocuments('empty-bank')).toBe(false);
  await b.retain('coding-agent::app', { content: 'hello', context: 'a test', documentId: 'doc:1', tags: ['source:foundry'], metadata: { k: 'v' }, updateMode: 'replace' });
  expect(await b.reflect('coding-agent::app', 'what?', { budget: 'low', context: 'before an attempt' })).toBe('answer to: what?');
  expect(await b.recall('coding-agent::app', 'what?', { maxTokens: 500 })).toEqual(['fact one', 'fact two']);
  expect(await b.listKnowledgePages('coding-agent::app')).toEqual(['Component map']);
  await b.createKnowledgePage('coding-agent::app', { name: 'Core concepts', sourceQuery: 'What are the core concepts?', tags: ['knowledge:concept'], maxTokens: 4096, trigger: { refreshCron: '17 * * * *', factTypes: ['world', 'experience', 'observation'], tagsMatch: 'all' } });

  expect(hits.every((h) => h.auth === 'Bearer tok-1')).toBe(true);
  expect(hits.map((h) => `${h.method} ${h.path.split('?')[0]}`)).toEqual([
    'GET /version',
    'GET /v1/default/banks',
    'PUT /v1/default/banks/coding-agent::new',
    'GET /v1/default/banks/coding-agent::app/documents',
    'GET /v1/default/banks/empty-bank/documents',
    'POST /v1/default/banks/coding-agent::app/memories',
    'POST /v1/default/banks/coding-agent::app/reflect',
    'POST /v1/default/banks/coding-agent::app/memories/recall',
    'GET /v1/default/banks/coding-agent::app/knowledge-base/tree',
    'POST /v1/default/banks/coding-agent::app/knowledge-base/pages',
  ]);
  expect(hits.find((h) => h.path.endsWith('/knowledge-base/pages'))!.body).toMatchObject({ name: 'Core concepts', source_query: 'What are the core concepts?', tags: ['knowledge:concept'], max_tokens: 4096, trigger: { refresh_cron: '17 * * * *', fact_types: ['world', 'experience', 'observation'], tags_match: 'all' } });
  expect(hits.find((h) => h.method === 'PUT')!.body).toMatchObject({ name: 'new', mission: 'remember this repository' });
  expect(hits.find((h) => h.path.endsWith('/documents?limit=1') || h.path.includes('/documents?'))!.path).toContain('limit=1');
  // one item per document, taken asynchronously: a stage never waits for the server's extraction
  expect(hits.find((h) => h.path.endsWith('/memories'))!.body).toMatchObject({ async: true, items: [{ content: 'hello', context: 'a test', document_id: 'doc:1', tags: ['source:foundry'], update_mode: 'replace', metadata: { k: 'v' } }] });
  expect(hits.find((h) => h.path.endsWith('/reflect'))!.body).toMatchObject({ query: 'what?', budget: 'low', context: 'before an attempt' });
  expect(hits.find((h) => h.path.endsWith('/memories/recall'))!.body).toMatchObject({ query: 'what?', max_tokens: 500 });
});

test('without a token no Authorization header goes; a server that is not there throws', async () => {
  hits.length = 0;
  const b = new HindsightBackend({ url: `http://127.0.0.1:${server.port}`, token: null });
  await b.version();
  expect(hits[0]!.auth).toBeNull();
  const down = new HindsightBackend({ url: 'http://127.0.0.1:1', token: null });
  await expect(down.version(AbortSignal.timeout(2_000))).rejects.toThrow();
});
