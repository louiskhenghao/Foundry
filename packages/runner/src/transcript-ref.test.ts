import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCliRunner } from './claude-cli-runner.ts';
import type { RunnerEvent } from './types.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** a stand-in CLI that prints a fixed stream-json session */
function fakeCli(dir: string): string {
  const lines = [
    { type: 'system', subtype: 'init', session_id: 's1', model: 'm', tools: [] },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'plan' }, { type: 'text', text: 'hello' }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: 's1' },
  ];
  const out = join(dir, 'session.jsonl');
  writeFileSync(out, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const bin = join(dir, 'fake-cli');
  writeFileSync(bin, `#!/bin/sh\ncat '${out}'\n`);
  chmodSync(bin, 0o755);
  return bin;
}

async function collect(runner: ClaudeCliRunner, transcriptPath: string, cwd: string): Promise<RunnerEvent[]> {
  const handle = await runner.run({ prompt: 'x', cwd, transcriptPath });
  const events: RunnerEvent[] = [];
  for await (const ev of handle.events) if (ev.kind !== 'stderr') events.push(ev);
  await handle.result;
  return events;
}

describe('events point back at their transcript line', () => {
  test('each event names its file, line and block; a continuation counts on from the end of the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-ref-'));
    dirs.push(dir);
    const runner = new ClaudeCliRunner({ claudeBin: fakeCli(dir) });
    const path = join(dir, 'transcripts', 'a_1.jsonl');
    const first = await collect(runner, path, dir);
    expect(first.map((e) => [e.kind, e.ref?.line, e.ref?.block])).toEqual([
      ['init', 0, 0],
      ['thinking', 1, 0],
      ['text', 1, 1],
      ['result', 2, 0],
    ]);
    expect(first.every((e) => e.ref?.file === 'a_1.jsonl')).toBe(true);
    const second = await collect(runner, path, dir);
    expect(second.map((e) => e.ref?.line)).toEqual([3, 4, 4, 5]);
    // the line a ref names holds that event
    const lines = readFileSync(path, 'utf8').split('\n');
    expect(JSON.parse(lines[second[2]!.ref!.line]!).message.content[1].text).toBe('hello');
  });
});
