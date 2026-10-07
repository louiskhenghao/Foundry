import { describe, expect, test } from 'bun:test';
import { ClaudeCliRunner } from './claude-cli-runner.ts';

describe('ClaudeCliRunner arguments', () => {
  test('strictMcp loads no MCP servers; without it the CLI keeps its own', () => {
    const runner = new ClaudeCliRunner({ claudeBin: '/bin/true' });
    expect(runner.buildArgs({ prompt: 'x', cwd: '/tmp', strictMcp: true })).toContain('--strict-mcp-config');
    expect(runner.buildArgs({ prompt: 'x', cwd: '/tmp' })).not.toContain('--strict-mcp-config');
  });
});
