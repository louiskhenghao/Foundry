import { describe, expect, test } from 'bun:test';
import { LineSplitter, decodeLine } from './stream-codec.ts';
import { classifyFailure } from './types.ts';

describe('failure classification', () => {
  test('model errors, rate limits, auth, other, success', () => {
    expect(classifyFailure('API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-opus-3 not found"}}')).toBe('model_unavailable');
    expect(classifyFailure('The model claude-sonnet-4 is deprecated and no longer available')).toBe('model_unavailable');
    expect(classifyFailure('Unknown model alias: fable2')).toBe('model_unavailable');
    expect(classifyFailure('Error: invalid model "claude-x"')).toBe('model_unavailable');
    expect(classifyFailure('rate_limit_error: too many requests')).toBe('rate_limit');
    expect(classifyFailure('Not logged in · please run claude login')).toBe('auth');
    expect(classifyFailure('Tool execution failed: ENOENT')).toBe('other');
    expect(classifyFailure(null, 'success')).toBeNull();
    expect(classifyFailure(null, 'error_max_turns')).toBe('other');
    expect(classifyFailure('The file model.ts could not be parsed')).toBe('other');
  });
  test('result events carry failureClass', () => {
    const [ev] = decodeLine(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['model: nope-9 not found'], session_id: 's' }));
    expect(ev!.kind).toBe('result');
    expect((ev as any).result.failureClass).toBe('model_unavailable');
    const [ok] = decodeLine(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: 's' }));
    expect((ok as any).result.failureClass).toBeNull();
  });
});

describe('stream-codec', () => {
  test('init', () => {
    const ev = decodeLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-haiku-4-5', tools: ['Bash'] }));
    expect(ev[0]).toMatchObject({ kind: 'init', sessionId: 's1', tools: ['Bash'] });
  });
  test('assistant blocks', () => {
    const ev = decodeLine(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'hi' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] },
      }),
    );
    expect(ev.map((e) => e.kind)).toEqual(['thinking', 'text', 'tool_use']);
  });
  test('tool_result error', () => {
    const ev = decodeLine(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'BLOCKED' }] } }));
    expect(ev[0]).toMatchObject({ kind: 'tool_result', isError: true, content: 'BLOCKED' });
  });
  test('result', () => {
    const ev = decodeLine(
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 's1', total_cost_usd: 0.01, num_turns: 2, result: 'OK', permission_denials: [] }),
    );
    const first = ev[0]!;
    expect(first.kind).toBe('result');
    if (first.kind === 'result') {
      expect(first.result.costUsd).toBe(0.01);
      expect(first.result.finalText).toBe('OK');
    }
  });
  test('rate limit', () => {
    const ev = decodeLine(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 123, rateLimitType: 'five_hour' } }));
    expect(ev[0]).toMatchObject({ kind: 'rate_limit', info: { status: 'allowed', resetsAt: 123 } });
  });
  test('non-json is stderr-ish', () => {
    expect(decodeLine('garbage')[0]?.kind).toBe('stderr');
  });
  test('line splitter handles partial chunks', () => {
    const s = new LineSplitter();
    const enc = new TextEncoder();
    expect(s.push(enc.encode('{"a":1}\n{"b"'))).toEqual(['{"a":1}']);
    expect(s.push(enc.encode(':2}\n'))).toEqual(['{"b":2}']);
    expect(s.flush()).toEqual([]);
  });
});

test('skillNameFromToolUse reads the Skill tool input in every shape we have seen', async () => {
  const { skillNameFromToolUse } = await import('./stream-codec.ts');
  expect(skillNameFromToolUse({ kind: 'tool_use', name: 'Skill', input: { skill: 'artifact-design' } })).toBe('artifact-design');
  expect(skillNameFromToolUse({ kind: 'tool_use', name: 'Skill', input: { skill: 'mattpocock-skills:tdd', args: 'x' } })).toBe('mattpocock-skills:tdd');
  expect(skillNameFromToolUse({ kind: 'tool_use', name: 'Skill', input: { command: '/tdd write tests' } })).toBe('tdd');
  expect(skillNameFromToolUse({ kind: 'tool_use', name: 'Bash', input: { command: 'ls' } })).toBeNull();
  expect(skillNameFromToolUse({ kind: 'text' })).toBeNull();
});

import { describe as describe2, expect as expect2, test as test2 } from 'bun:test';
import { decodeMessage } from './stream-codec.ts';

describe2('tool_progress heartbeats', () => {
  test2('become progress events keyed by the tool call, without the heartbeat suffix', () => {
    const ev = decodeMessage({ type: 'tool_progress', tool_use_id: 'toolu_01ABC-heartbeat-4', tool_name: 'Agent', parent_tool_use_id: 'toolu_01ABC', elapsed_time_seconds: 120, heartbeat: true, session_id: 's' });
    expect2(ev).toEqual([{ kind: 'progress', toolUseId: 'toolu_01ABC', tool: 'Agent', elapsedSeconds: 120 }]);
  });
});
