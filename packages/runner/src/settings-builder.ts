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

export function canaryHook(scriptPath: string): HookSpec {
  return { event: 'SessionStart', command: scriptPath, timeout: 5 };
}
