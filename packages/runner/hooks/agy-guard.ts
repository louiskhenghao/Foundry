/** Antigravity PreToolUse adapter: keep Foundry's boundary, its read-only roles and the tool-call allowance. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const deny = (reason: string): never => {
  console.log(JSON.stringify({ decision: 'deny', reason }));
  process.exit(0);
};
async function main() {
  const payload = JSON.parse((await Bun.stdin.text()) || '{}');
  const policy = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
  if (!existsSync(policy.canary)) deny('Foundry session guard did not initialize. Stop this session.');
  // agy 1.4 hands the call as toolCall { name, args }; the other spellings keep this working should it change
  const name = String(payload.toolCall?.name ?? payload.toolName ?? payload.tool_name ?? payload.name ?? '');
  const input = payload.toolCall?.args ?? payload.toolInput ?? payload.tool_input ?? payload.input ?? {};
  // `finish` is how the CLI hands over an answer under --json-schema: never blocked, never counted
  if (name === 'finish') process.exit(0);
  if (policy.noTools) deny('This Foundry session does not permit tools.');
  // Foundry orchestrates the roles: a session does its own work, as Codex sessions do with native delegation off
  if (/^(invoke_subagent|define_subagent|manage_subagents|browser_subagent|schedule)$/.test(name)) deny('Foundry runs the roles itself: do this work in this session.');
  if (policy.readOnly && (/^(write_to_file|replace_file_content|multi_replace_file_content|sed_file|notebook_edit|delete_file|apply_patch)$/.test(name) || (/(write|replace|delete|patch)/i.test(name) && !/^(read|view|list|search|grep|find)/i.test(name)))) deny('This Foundry role is read-only.');
  // the allowance stands in for a turn cap the CLI does not have
  if (policy.maxToolCalls) {
    let count = 0;
    try {
      count = Number(readFileSync(policy.counter, 'utf8'));
    } catch {}
    if (count >= policy.maxToolCalls) {
      // the runner reports the session as cut (like a --max-turns stop), so Foundry continues it
      if (policy.capped) writeFileSync(policy.capped, '1');
      deny('Foundry tool-call allowance reached. Finish with a summary of the remaining work.');
    }
    writeFileSync(policy.counter, String(count + 1));
  }
  if (/^(run_command|send_command_input|run_terminal_cmd|execute_command|shell|bash)$/i.test(name)) {
    const command = input.CommandLine ?? input.Input ?? input.command_line ?? input.command ?? input.cmd ?? '';
    const proc = Bun.spawn(['sh', policy.boundary], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    proc.stdin.write(JSON.stringify({ ...payload, tool_name: 'Bash', tool_input: { ...input, command: Array.isArray(command) ? command.join(' ') : String(command) } }));
    proc.stdin.end();
    const error = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) deny(error.trim() || 'Foundry boundary check failed.');
  }
}
main().catch(() => deny('Foundry could not verify this tool call; stop the session.'));
