import { describe, expect, test } from 'bun:test';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveMeta, deriveMetaFromFile, parseLines, readSlice, tailLines, toLogItems } from './transcript.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'agents-transcript-'));
const line = (v: unknown) => `${JSON.stringify(v)}\n`;

const assistant = (model: string, usage?: Record<string, number>, content: unknown[] = [{ type: 'text', text: 'hi' }]) => ({
  type: 'assistant',
  timestamp: '2026-08-28T10:00:00.000Z',
  cwd: '/repo',
  gitBranch: 'main',
  entrypoint: 'claude-vscode',
  version: '2.1.247',
  message: { model, content, usage },
});

describe('tailLines', () => {
  test('parses complete lines and drops the partial first line of a bounded tail', () => {
    const p = join(dir(), 's.jsonl');
    const rows = Array.from({ length: 50 }, (_, i) => ({ type: 'user', i, message: { content: `msg ${i} ${'x'.repeat(100)}` } }));
    writeFileSync(p, rows.map(line).join(''));
    const all = tailLines(p);
    expect(all.length).toBe(50);
    const tail = tailLines(p, 500); // lands mid-line: first partial line must be dropped, rest parse fine
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.length).toBeLessThan(50);
    expect(tail.every((e) => typeof e.i === 'number')).toBe(true);
    expect(tailLines(join(dir(), 'missing.jsonl'))).toEqual([]);
  });

  test('skips corrupt lines instead of failing', () => {
    const p = join(dir(), 's.jsonl');
    writeFileSync(p, `not json\n${line({ type: 'user', ok: true })}{"unterminated": \n`);
    expect(tailLines(p)).toEqual([{ type: 'user', ok: true }]);
  });
});

describe('deriveMeta', () => {
  test('takes model/context from the last real assistant line, title from ai-title', () => {
    const meta = deriveMeta(
      parseLines(
        [
          line(assistant('claude-sonnet-5', { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 })),
          line({ type: 'ai-title', aiTitle: 'First title' }),
          line(assistant('<synthetic>')), // local error message — never wins
          line(assistant('claude-fable-5', { input_tokens: 2, cache_creation_input_tokens: 4711, cache_read_input_tokens: 50325 })),
          line({ type: 'ai-title', aiTitle: 'Final title' }),
          line({ type: 'last-prompt', lastPrompt: 'do the thing' }),
        ].join(''),
      ),
    );
    expect(meta.model).toBe('claude-fable-5');
    expect(meta.contextUsedTokens).toBe(2 + 4711 + 50325);
    expect(meta.title).toBe('Final title');
    expect(meta.lastPrompt).toBe('do the thing');
    expect(meta.cwd).toBe('/repo');
    expect(meta.gitBranch).toBe('main');
    expect(meta.entrypoint).toBe('claude-vscode');
  });

  test('deriveMetaFromFile widens the tail when 64KB holds no assistant line', () => {
    const p = join(dir(), 's.jsonl');
    writeFileSync(p, line(assistant('claude-fable-5', { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 })));
    // ~100KB of tool-result noise after the only assistant line
    for (let i = 0; i < 100; i++) appendFileSync(p, line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'y'.repeat(1000) }] } }));
    expect(deriveMetaFromFile(p).model).toBe('claude-fable-5');
  });
});

describe('readSlice', () => {
  test('offset math: consumes only complete lines, resumes where it stopped', () => {
    const p = join(dir(), 's.jsonl');
    const l1 = line({ type: 'user', message: { content: 'one' } });
    const l2 = line({ type: 'user', message: { content: 'two' } });
    writeFileSync(p, l1 + l2);
    const s1 = readSlice(p, 0);
    expect(s1.lines.length).toBe(2);
    expect(s1.nextOffset).toBe(Buffer.byteLength(l1 + l2));
    expect(s1.eof).toBe(true);

    // a partial trailing line is left for the next poll
    appendFileSync(p, '{"type":"user","message":{"content":"thr');
    const s2 = readSlice(p, s1.nextOffset);
    expect(s2.lines.length).toBe(0);
    expect(s2.nextOffset).toBe(s1.nextOffset);
    appendFileSync(p, 'ee"}}\n');
    const s3 = readSlice(p, s2.nextOffset);
    expect(s3.lines.length).toBe(1);
    expect(s3.eof).toBe(true);

    // offset beyond the file (rotation/truncation) resets to 0
    expect(readSlice(p, 10_000_000).lines.length).toBe(3);
  });

  test('caps a slice and reports eof=false so the client re-polls immediately', () => {
    const p = join(dir(), 's.jsonl');
    for (let i = 0; i < 30; i++) appendFileSync(p, line({ type: 'user', i, message: { content: 'z'.repeat(50) } }));
    const s = readSlice(p, 0, 1024);
    expect(s.eof).toBe(false);
    expect(s.lines.length).toBeGreaterThan(0);
    const rest = readSlice(p, s.nextOffset);
    expect(rest.eof).toBe(true);
    expect(s.lines.length + rest.lines.length).toBe(30);
  });
});

describe('toLogItems', () => {
  test('renders conversation items and skips meta/sidechain/synthetic/unknown lines', () => {
    const items = toLogItems(
      parseLines(
        [
          line({ type: 'user', timestamp: 't1', message: { content: 'hello' } }),
          line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: 'result body' }], is_error: true }] } }),
          line(assistant('claude-fable-5', undefined, [
            { type: 'thinking', thinking: 'hmm' },
            { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } },
            { type: 'text', text: 'done' },
          ])),
          line({ type: 'system', subtype: 'compact_boundary', compactMetadata: { preTokens: 788542, postTokens: 15726 } }),
          line({ type: 'ai-title', aiTitle: 'skip me' }),
          line({ type: 'user', isMeta: true, message: { content: 'skip meta' } }),
          line({ type: 'user', isSidechain: true, message: { content: 'skip sidechain' } }),
          line(assistant('<synthetic>')),
          line({ type: 'totally-new-kind', whatever: 1 }),
        ].join(''),
      ),
    );
    expect(items.map((i) => i.kind)).toEqual(['user', 'tool_result', 'thinking', 'tool_use', 'assistant', 'compact']);
    const tr = items[1] as Extract<(typeof items)[number], { kind: 'tool_result' }>;
    expect(tr.forId).toBe('tu1');
    expect(tr.isError).toBe(true);
    expect(tr.content).toBe('result body');
    const tu = items[3] as Extract<(typeof items)[number], { kind: 'tool_use' }>;
    expect(tu.name).toBe('Bash');
    expect(tu.input).toContain('"command":"ls"');
    const compact = items[5] as Extract<(typeof items)[number], { kind: 'compact' }>;
    expect(compact.preTokens).toBe(788542);
  });

  test('user lines carrying command/IDE machinery split into typed items', () => {
    const text = [
      '<command-name>/model</command-name>',
      '<command-message>model</command-message>',
      '<command-args>claude-fable-5[1m]</command-args>',
      '<local-command-stdout>Set model to claude-fable-5</local-command-stdout>',
      '<ide_opened_file>The user opened App.tsx</ide_opened_file>',
      '<system-reminder>injected context, not the user</system-reminder>',
      'do the actual thing',
      '[Request interrupted by user]',
    ].join('\n');
    const items = toLogItems([{ type: 'user', message: { content: text } }]);
    expect(items).toMatchObject([
      { kind: 'command', name: 'model', args: 'claude-fable-5[1m]' },
      { kind: 'notice', text: 'Set model to claude-fable-5' },
      { kind: 'notice', text: 'interrupted by user' },
      { kind: 'user', text: 'do the actual thing' },
    ]);
    // a line that is nothing but machinery yields no user bubble at all
    expect(toLogItems([{ type: 'user', message: { content: '<ide_opened_file>x</ide_opened_file>' } }])).toEqual([]);
  });

  test('sidechain mode renders subagent files, whose every line is marked isSidechain', () => {
    const lines = [{ type: 'user', isSidechain: true, agentId: 'a1', message: { content: 'sub work' } }];
    expect(toLogItems(lines)).toEqual([]); // main-transcript view: legacy inline sidechains stay hidden
    expect(toLogItems(lines, { sidechain: true })).toMatchObject([{ kind: 'user', text: 'sub work' }]);
  });

  test('truncates oversized tool payloads', () => {
    const items = toLogItems([{ type: 'assistant', message: { model: 'm', content: [{ type: 'tool_use', id: 'x', name: 'Write', input: { content: 'a'.repeat(10_000) } }] } }]);
    const tu = items[0] as Extract<(typeof items)[number], { kind: 'tool_use' }>;
    expect(tu.input.length).toBeLessThan(5_000);
    expect(tu.input.endsWith('… [truncated]')).toBe(true);
  });
});
