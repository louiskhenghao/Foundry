/**
 * Builds the `--settings` JSON for a run. Hooks are the mechanical enforcement of the
 * boundary (Escalation trigger 3). Keep this tiny and obviously correct: a malformed
 * settings object is silently ignored by claude in -p mode (fail-open), so the runner
 * additionally verifies that the hook fired (see ClaudeCliRunner.verifyHooks).
 */
export interface HookSpec {
  event: 'PreToolUse' | 'PostToolUse' | 'Stop' | 'SessionStart' | 'SubagentStop';
  matcher?: string;
  command: string;
  timeout?: number;
}

export function buildSettings(hooks: HookSpec[], extra: Record<string, unknown> = {}): object {
  const grouped: Record<string, { matcher?: string; hooks: { type: 'command'; command: string; timeout?: number }[] }[]> = {};
  for (const h of hooks) {
    const entry = { ...(h.matcher ? { matcher: h.matcher } : {}), hooks: [{ type: 'command' as const, command: h.command, ...(h.timeout ? { timeout: h.timeout } : {}) }] };
    (grouped[h.event] ??= []).push(entry);
  }
  return { ...extra, hooks: grouped };
}

export function boundaryHook(scriptPath: string): HookSpec {
  return { event: 'PreToolUse', matcher: 'Bash', command: scriptPath, timeout: 10 };
}

/** the boundary script on the Skill tool too: a skill behind a closed Settings switch (FOUNDRY_DENIED_SKILLS) is refused */
export function skillGuardHook(scriptPath: string): HookSpec {
  return { event: 'PreToolUse', matcher: 'Skill', command: scriptPath, timeout: 10 };
}

export function canaryHook(scriptPath: string): HookSpec {
  return { event: 'SessionStart', command: scriptPath, timeout: 5 };
}

/**
 * Auto-approves rm commands confined to the workspace/temp dirs, which `dontAsk` would
 * otherwise deny (built-in destructive-command ask). Runs under bun; a deny from the
 * boundary hook always wins over this hook's allow.
 */
export function rmGuardHook(scriptPath: string): HookSpec {
  return { event: 'PreToolUse', matcher: 'Bash', command: `bun ${JSON.stringify(scriptPath)}`, timeout: 10 };
}

/**
 * The read-only shell guard (ADR-0073): the Explainer's Bash may only read — git's read-only subcommands, rg, grep, cat
 * and the like, no redirection into a file, no substitution. Runs under bun; its deny (exit 2) stands whatever the
 * other hooks say.
 */
export function readOnlyShellHook(scriptPath: string): HookSpec {
  return { event: 'PreToolUse', matcher: 'Bash', command: `bun ${JSON.stringify(scriptPath)}`, timeout: 10 };
}
