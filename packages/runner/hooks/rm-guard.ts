#!/usr/bin/env bun
/**
 * foundry rm guard — PreToolUse hook (matcher: Bash), run with bun.
 *
 * Claude Code's built-in protection makes destructive commands (`rm` …) ask for confirmation
 * even when Bash is allowlisted; in `dontAsk` mode that ask becomes a denial, so unattended
 * workers cannot clean up their own workspace. This hook auto-approves exactly that case:
 * an `rm` whose every path provably stays inside the session's workspace (cwd) or a temp dir.
 *
 * Anything uncertain — `..`, `~`, an unresolved `$VAR`, command substitution, `cd`, `sudo` —
 * falls through silently (exit 0) to the normal permission flow, i.e. stays denied. The
 * boundary guard's deny (exit 2) always beats an allow from this hook, so the egress
 * protection is unaffected.
 */

const SAFE_ROOTS = ['/tmp/', '/private/tmp/', '/var/folders/'];

export interface Verdict {
  allow: boolean;
  reason: string;
}

/** Pure decision so the tests can drive it directly; the hook body below wires stdin/stdout. */
export function judge(command: string, cwd: string): Verdict {
  if (!command || !cwd) return { allow: false, reason: 'no command or cwd' };
  if (!/(^|[;&|(\s])rm\s/.test(command)) return { allow: false, reason: 'not an rm command' };
  if (/\bsudo\b|`|\$\(|<\(|\bcd\b|\bpushd\b|~|\.\./.test(command)) return { allow: false, reason: 'shell construct that could escape the workspace' };
  // resolve simple VAR=path assignments so `ROOT=/x; rm "$ROOT/y"` is judged on real paths
  const vars: Record<string, string> = {};
  for (const m of command.matchAll(/(?:^|[;\n&|]\s*)(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s;]+)/g)) {
    vars[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  const subst = command.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (s, n: string) => vars[n] ?? s);
  if (subst.includes('$')) return { allow: false, reason: 'unresolved variable could point anywhere' };
  const root = cwd.replace(/\/+$/, '');
  const paths = [...subst.matchAll(/(?:^|[\s"'=])(\/[^\s"';|&)]+)/g)].map((m) => m[1]!);
  // no absolute paths = everything is relative to cwd (and `..` was rejected above)
  const safe = (p: string) => p === root || p.startsWith(`${root}/`) || SAFE_ROOTS.some((r) => p.startsWith(r));
  if (!paths.every(safe)) return { allow: false, reason: 'a path leaves the workspace' };
  return { allow: true, reason: 'destructive file op confined to the workspace / temp dirs' };
}

if (import.meta.main) {
  const input = await new Response(Bun.stdin.stream()).text();
  let j: { tool_input?: { command?: string }; cwd?: string } = {};
  try {
    j = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  const v = judge(j.tool_input?.command ?? '', j.cwd ?? '');
  if (v.allow) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: `foundry rm-guard: ${v.reason}` } }));
  }
  process.exit(0);
}
