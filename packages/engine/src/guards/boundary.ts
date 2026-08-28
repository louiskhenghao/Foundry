import { join } from 'node:path';
import { boundaryHook, buildSettings, canaryHook } from '@foundry/runner';

/**
 * The mechanical enforcement of Escalation trigger 3. The patterns themselves live in
 * packages/runner/hooks/boundary-guard.sh so the hook has no runtime dependency on the engine.
 */
export function boundarySettings(hooksDir: string): object {
  return buildSettings([canaryHook(join(hooksDir, 'canary.sh')), boundaryHook(join(hooksDir, 'boundary-guard.sh'))]);
}

/** Tools a worker may use without asking. Bash is guarded by the boundary hook. */
export const WORKER_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'LS', 'TodoWrite', 'Task', 'Agent', 'Skill', 'WebFetch', 'WebSearch'];

/** Read-only tool set for clarifier / reviewers. */
export const READONLY_TOOLS = ['Bash', 'Read', 'Glob', 'Grep', 'LS', 'Task', 'Agent', 'Skill', 'WebFetch', 'WebSearch', 'TodoWrite'];
export const READONLY_DISALLOWED = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
