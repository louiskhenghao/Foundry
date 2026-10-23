import { describe, expect, test } from 'bun:test';
import { actionLine, compactEvents, compactTranscript, type CompactTurn } from './compact.ts';

const turns = (jsonl: string): CompactTurn[] => jsonl.split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('a transcript in compact form', () => {
  test("keeps the agent's words, one line per tool call and what failed calls said, nothing else", () => {
    const lines = [
      { type: 'system', subtype: 'init', session_id: 's1', model: 'm', tools: [] },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'plan: edit the file' }, { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'x', new_string: 'y' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'a very long successful output that teaches nothing' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'bun test packages/x\n# second line' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: '1 fail\n  expected 2' }] } },
      { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.1, num_turns: 3, duration_ms: 10, result: 'done' },
    ];
    const out = turns(compactTranscript(lines.map((l) => JSON.stringify(l)).join('\n'), 'claude', { prompt: '# Your task\nmake it so' }));
    expect(out).toEqual([
      { role: 'user', content: '# Your task\nmake it so' },
      { role: 'assistant', content: 'plan: edit the file' },
      { role: 'action', content: 'Edit src/a.ts' },
      { role: 'action', content: 'Bash bun test packages/x' },
      { role: 'tool_error', content: '1 fail\n  expected 2' },
      { role: 'result', content: 'success' },
    ]);
    expect(JSON.stringify(out)).not.toContain('teaches nothing');
    expect(JSON.stringify(out)).not.toContain('hmm');
  });

  test('reads an Antigravity transcript through its own decoder', () => {
    const lines = [
      { event: 'init', conversation_id: 'c1', init: { model: 'm', tools: [] } },
      { event: 'step_update', step_update: { step_index: 0, step_type: 'agent_response', text_delta: 'Hello ', state: 'RUNNING' } },
      { event: 'step_update', step_update: { step_index: 0, step_type: 'agent_response', text_delta: 'world', state: 'DONE' } },
      { event: 'step_update', step_update: { step_index: 1, step_type: 'tool', state: 'DONE', tool_name: 'read_file', tool_info: { parameters: { path: 'README.md' }, output: 'fixture' } } },
      { event: 'result', result: { status: 'SUCCESS' } },
    ];
    expect(turns(compactTranscript(lines.map((l) => JSON.stringify(l)).join('\n'), 'agy'))).toEqual([
      { role: 'assistant', content: 'Hello world' },
      { role: 'action', content: 'read_file README.md' },
    ]);
  });

  test('names a tool call by the input that says what it was about', () => {
    expect(actionLine('Read', { file_path: '/repo/src/x.ts' })).toBe('Read /repo/src/x.ts');
    expect(actionLine('Grep', { pattern: 'TODO', path: 'src' })).toBe('Grep src');
    expect(actionLine('Skill', { skill: 'tdd' })).toBe('Skill tdd');
    expect(actionLine('Agent', { prompt: 'look around\nmore' })).toBe('Agent look around');
    expect(actionLine('Mystery', { count: 3 })).toBe('Mystery');
    expect(actionLine('Mystery', null)).toBe('Mystery');
  });

  test('over the cap, the start and the end stay and the middle is left out, said so', () => {
    const events = Array.from({ length: 60 }, (_, i) => ({ kind: 'text' as const, text: `turn ${i} ${'x'.repeat(80)}` }));
    const out = turns(compactEvents(events, { maxChars: 2_500 }));
    expect(out[0]!.content.startsWith('turn 0 ')).toBe(true);
    expect(out.at(-1)!.content.startsWith('turn 59 ')).toBe(true);
    expect(out.some((t) => /\[\d+ turns left out/.test(t.content))).toBe(true);
    expect(out.length).toBeLessThan(40);
    // never over the cap by more than the note itself
    expect(compactEvents(events, { maxChars: 2_500 }).length).toBeLessThan(2_700);
  });
});
