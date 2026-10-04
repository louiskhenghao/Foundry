import type { RunnerEvent } from './types.ts';

/** Stateless decoding also used when reopening a persisted Codex JSONL transcript. */
export function decodeCodexMessage(msg: any): RunnerEvent[] {
  if (msg.type === 'thread.started') return [{ kind: 'init', sessionId: msg.thread_id, model: null, tools: [], raw: msg }];
  if (msg.type === 'error' || msg.type === 'turn.failed') return [{ kind: 'stderr', text: msg.message ?? msg.error?.message ?? 'Codex turn failed' }];
  const item = msg.item;
  if (!item || !['item.started', 'item.completed', 'item.updated'].includes(msg.type)) return [{ kind: 'unknown', raw: msg }];
  const completed = msg.type === 'item.completed';
  if (item.type === 'error') return [{ kind: 'stderr', text: item.message ?? 'Codex item failed' }];
  if (item.type === 'agent_message') return completed ? [{ kind: 'text', text: item.text ?? '' }] : [];
  if (item.type === 'reasoning') return completed ? [{ kind: 'thinking', text: item.text ?? '' }] : [];
  if (item.type === 'command_execution') return completed
    ? [{ kind: 'tool_result', toolUseId: item.id, isError: item.status === 'failed' || (item.exit_code != null && item.exit_code !== 0), content: item.aggregated_output ?? '' }]
    : msg.type === 'item.started' ? [{ kind: 'tool_use', id: item.id, name: 'Bash', input: { command: item.command } }] : [];
  if (item.type === 'mcp_tool_call') return completed
    ? [{ kind: 'tool_result', toolUseId: item.id, isError: item.status === 'failed' || !!item.error, content: JSON.stringify(item.error ?? item.result ?? null) }]
    : msg.type === 'item.started' ? [{ kind: 'tool_use', id: item.id, name: `mcp__${item.server}__${item.tool}`, input: item.arguments }] : [];
  if (item.type === 'file_change') return completed ? [{ kind: 'tool_use', id: item.id, name: 'apply_patch', input: { changes: item.changes } }, { kind: 'tool_result', toolUseId: item.id, isError: item.status === 'failed', content: JSON.stringify(item.changes ?? []) }] : [];
  if (item.type === 'web_search') return completed ? [{ kind: 'tool_use', id: item.id, name: 'WebSearch', input: { query: item.query } }] : [];
  if (item.type === 'todo_list') return completed ? [{ kind: 'tool_use', id: item.id, name: 'TodoWrite', input: { todos: item.items } }] : [];
  return [{ kind: 'unknown', raw: msg }];
}
