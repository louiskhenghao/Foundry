import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const main = resolve(import.meta.dir, 'main.ts');

/** a Foundry that keeps one question and answers it over the live feed, the words as they are written, then the record */
function fakeFoundry(opts: { stream: boolean }) {
  let asked: Record<string, unknown> | undefined;
  let token: string | null = null;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname === '/ws') {
        token = url.searchParams.get('token');
        if (server.upgrade(request)) return undefined as unknown as Response;
        return new Response('upgrade failed', { status: 400 });
      }
      if (url.pathname === '/api/goals/g1/conversations/ask' && request.method === 'POST') {
        asked = await request.json();
        return Response.json({ conversationId: 'c1', messageId: 'm1', channel: 'conversation-c1' }, { status: 202 });
      }
      if (url.pathname === '/api/goals/g1') return Response.json({ goal: { id: 'g1', provider: 'claude' } });
      if (url.pathname === '/api/goals/g1/conversations') return Response.json({ enabled: true, conversations: [{ id: 'c1', messages: [{ id: 'm2', role: 'explainer', askedId: 'm1', text: 'It reads the table.', status: 'done', costUsd: 0.5, costAvailable: true, model: 'sonnet' }] }], live: {} });
      return new Response('Unexpected request', { status: 404 });
    },
    websocket: {
      open(ws) {
        const send = (m: unknown) => ws.send(JSON.stringify(m));
        if (opts.stream) {
          send({ kind: 'stream', stream: { goalId: 'g1', taskId: null, attemptId: 'conversation-c1', ts: 't', event: { kind: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x/src/app.ts' } } } });
          send({ kind: 'stream', stream: { goalId: 'g1', taskId: null, attemptId: 'conversation-c1', ts: 't', event: { kind: 'text_delta', text: 'It reads ' } } });
          send({ kind: 'stream', stream: { goalId: 'g1', taskId: null, attemptId: 'conversation-c1', ts: 't', event: { kind: 'text_delta', text: 'the table.' } } });
          send({ kind: 'stream', stream: { goalId: 'g1', taskId: null, attemptId: 'conversation-c1', ts: 't', event: { kind: 'text', text: 'It reads the table.' } } });
          send({ kind: 'event', event: { type: 'conversation.answered', goalId: 'g1', payload: { conversationId: 'c1', messageId: 'm2', askedId: 'm1', text: 'It reads the table.', status: 'done', reason: null, costUsd: 0.5, costAvailable: true, model: 'sonnet' } } });
        } else ws.close();
      },
      message() {},
    },
  });
  return { server, asked: () => asked, token: () => token };
}

async function run(args: string[], port: number, env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, main, ...args], { env: { FOUNDRY_URL: `http://127.0.0.1:${port}`, PATH: process.env.PATH!, ...env }, stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { exitCode, stdout, stderr };
}

describe('foundry ask (ADR-0073)', () => {
  test('sends the question, streams the answer as it is written with what the Explainer reads beside it, then says how it ended and what it cost', async () => {
    const f = fakeFoundry({ stream: true });
    try {
      const r = await run(['ask', 'g1', 'What does T1 read?', '--new'], f.server.port!, { FOUNDRY_TOKEN: 'tok-1' });
      expect(r.exitCode).toBe(0);
      expect(f.asked()).toEqual({ text: 'What does T1 read?', fresh: true });
      expect(r.stdout).toContain('It reads the table.');
      expect(r.stdout.split('It reads the table.').length).toBe(2);
      expect(r.stdout).toContain('— done · $0.500 · sonnet');
      expect(r.stderr).toContain('⚙ reading src/app.ts');
      // the live feed carries the person's token on its address
      expect(f.token()).toBe('tok-1');
    } finally {
      f.server.stop(true);
    }
  }, 20_000);

  test('without the live feed, the answer is fetched once it is there', async () => {
    const f = fakeFoundry({ stream: false });
    try {
      const r = await run(['ask', 'g1', 'What does T1 read?'], f.server.port!);
      expect(r.exitCode).toBe(0);
      expect(f.asked()).toEqual({ text: 'What does T1 read?', fresh: false });
      expect(r.stdout).toContain('It reads the table.');
      expect(r.stdout).toContain('— done · $0.500 · sonnet');
    } finally {
      f.server.stop(true);
    }
  }, 20_000);
});
