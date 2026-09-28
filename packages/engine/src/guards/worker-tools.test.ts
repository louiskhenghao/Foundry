import { describe, expect, test } from 'bun:test';
import { DEFAULT_MCP_ALLOWED } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { workerTools } from './boundary.ts';

describe('workerTools', () => {
  test('by default a worker gets exactly the tools it had before MCP servers could be allowed', () => {
    expect(workerTools(DEFAULT_MCP_ALLOWED)).toEqual(['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'LS', 'TodoWrite', 'Task', 'Agent', 'Skill', 'WebFetch', 'WebSearch', 'mcp__plugin_media-pipeline_media-pipeline']);
    expect(defaultConfig('/tmp').mcpAllowed).toEqual([...DEFAULT_MCP_ALLOWED]);
  });
  test('allowed servers are added; anything that is not an MCP prefix is ignored', () => {
    const t = workerTools(['mcp__context7', 'mcp__claude_ai_Gmail', 'Bash(rm -rf /)']);
    expect(t.slice(-2)).toEqual(['mcp__context7', 'mcp__claude_ai_Gmail']);
    expect(t).not.toContain('Bash(rm -rf /)');
    expect(workerTools([])).not.toContain('mcp__plugin_media-pipeline_media-pipeline');
  });
});
