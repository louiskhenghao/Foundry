import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
async function guard(tool: string, input: object, overrides: object = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-guard-')); dirs.push(dir);
  const canary = join(dir, 'canary'); writeFileSync(canary, '{}');
  const path = join(dir, 'policy');
  writeFileSync(path, JSON.stringify({ canary, counter: join(dir, 'count'), boundary: join(import.meta.dir, '../hooks/boundary-guard.sh'), readOnly: false, noTools: false, mcpAllowed: ['mcp__approved'], ...overrides }));
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, '../hooks/codex-guard.ts')], { env: { ...process.env, FOUNDRY_CALLBACK: '', FOUNDRY_CODEX_POLICY: path }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  proc.stdin.write(JSON.stringify({ tool_name: tool, tool_input: input })); proc.stdin.end();
  const text = await new Response(proc.stdout).text(); const code = await proc.exited;
  expect(code).toBe(0);
  return text ? JSON.parse(text).hookSpecificOutput : null;
}
test('Codex hook blocks publishing, respects read-only roles and checks exact MCP prefixes', async () => {
  expect(await guard('Bash', { command: 'git push origin main' })).toMatchObject({ permissionDecision: 'deny' });
  expect(await guard('exec_command', { cmd: 'npm publish' })).toMatchObject({ permissionDecision: 'deny' });
  expect(await guard('Bash', { command: 'bun test' })).toBeNull();
  expect(await guard('apply_patch', {}, { readOnly: true })).toMatchObject({ permissionDecision: 'deny' });
  expect(await guard('mcp__approved__tool', {})).toBeNull();
  expect(await guard('mcp__approved_evil__tool', {})).toMatchObject({ permissionDecision: 'deny' });
  expect(await guard('Read', {}, { noTools: true })).toMatchObject({ permissionDecision: 'deny' });
  expect(await guard('Read', {}, { canary: '/nonexistent/foundry-canary' })).toMatchObject({ permissionDecision: 'deny' });
});
