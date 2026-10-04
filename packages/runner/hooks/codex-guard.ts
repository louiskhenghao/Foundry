/** Codex PreToolUse adapter: keep Foundry's boundary and MCP allowlist. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const deny = (reason: string): never => {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
};
async function main() {
const input = await Bun.stdin.text();
const payload = JSON.parse(input);
const policy = JSON.parse(readFileSync(process.env.FOUNDRY_CODEX_POLICY!, 'utf8'));
if (!existsSync(policy.canary)) deny('Foundry session guard did not initialize. Stop this session.');
const name = String(payload.tool_name ?? '');
if (policy.noTools) deny('This Foundry session does not permit tools.');
if (policy.readOnly && /^(apply_patch|Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) deny('This Foundry role is read-only.');
if (name.startsWith('mcp__') && !policy.mcpAllowed.some((prefix: string) => name === prefix || name.startsWith(prefix + '__'))) deny('This MCP server is not enabled for Foundry sessions.');
// Bound tool calls because codex exec has no Claude-style --max-turns switch.
if (policy.maxToolCalls) {
  let count = 0;
  try { count = Number(readFileSync(policy.counter, 'utf8')); } catch {}
  if (count >= policy.maxToolCalls) deny('Foundry tool-call allowance reached. Finish with a summary of the remaining work.');
  writeFileSync(policy.counter, String(count + 1));
}
if (/^(Bash|exec_command|shell|shell_command)$/.test(name)) {
  const toolInput = payload.tool_input ?? {};
  const command = toolInput.command ?? toolInput.cmd ?? '';
  const proc = Bun.spawn(['sh', policy.boundary], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  proc.stdin.write(JSON.stringify({ ...payload, tool_name: 'Bash', tool_input: { ...toolInput, command: Array.isArray(command) ? command.join(' ') : command } }));
  proc.stdin.end();
  const error = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) deny(error.trim() || 'Foundry boundary check failed.');
}

}
main().catch(() => deny("Foundry could not verify this tool call; stop the session."));
