import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handoffSection, transcriptTail } from './handoff.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'foundry-handoff-'));
  dirs.push(d);
  return d;
};

describe('handoff to a new session', () => {
  test('the tail keeps the session\'s own words of every coding agent, not its tool output', () => {
    const dir = temp();
    const claude = join(dir, 'claude.jsonl');
    writeFileSync(claude, [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'First I read the router.' }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'SECRET TOOL OUTPUT' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Now adding the route.' }] } },
    ].map((l) => JSON.stringify(l)).join('\n') + '\n');
    expect(transcriptTail(claude, 'claude')).toBe('First I read the router.\n\nNow adding the route.');
    const codex = join(dir, 'codex.jsonl');
    writeFileSync(codex, [{ type: 'thread.started', thread_id: 'th' }, { type: 'item.completed', item: { type: 'agent_message', text: 'Patched the parser.' } }].map((l) => JSON.stringify(l)).join('\n'));
    expect(transcriptTail(codex, 'codex')).toBe('Patched the parser.');
    expect(transcriptTail(claude, 'claude', 10)).toBe('…the route.');
    expect(transcriptTail(join(dir, 'missing.jsonl'), 'claude')).toBe('');
  });

  test('the section names the reason, the attempt\'s commits and what the task changed', async () => {
    const repo = temp();
    await Bun.$`git -C ${repo} init -q -b main && git -C ${repo} -c user.name=t -c user.email=t@t commit -q --allow-empty -m base`.quiet();
    const base = (await Bun.$`git -C ${repo} rev-parse HEAD`.text()).trim();
    writeFileSync(join(repo, 'route.ts'), 'export {};\n');
    await Bun.$`git -C ${repo} add -A && git -C ${repo} -c user.name=t -c user.email=t@t commit -q -m "feat: add the route (attempt 1)"`.quiet();
    const s = await handoffSection({ cwd: repo, attemptBaseRef: base, taskBaseRef: base, transcriptPath: null, provider: 'claude', why: 'stopped by a usage limit' });
    expect(s).toStartWith('# Handoff');
    expect(s).toContain('stopped by a usage limit');
    expect(s).toContain('feat: add the route (attempt 1)');
    expect(s).toContain('route.ts');
    expect(s).not.toContain('What it said last');
  });
});
