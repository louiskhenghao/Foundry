import { join } from 'node:path';
import { boundaryHook, buildSettings, canaryHook, rmGuardHook } from '@foundry/runner';

/**
 * The mechanical enforcement of Escalation trigger 3. The patterns themselves live in
 * packages/runner/hooks/boundary-guard.sh so the hook has no runtime dependency on the engine.
 */
export function boundarySettings(hooksDir: string): object {
  return buildSettings([canaryHook(join(hooksDir, 'canary.sh')), boundaryHook(join(hooksDir, 'boundary-guard.sh')), rmGuardHook(join(hooksDir, 'rm-guard.ts'))]);
}

/** Tools a worker may use without asking. Bash is guarded by the boundary hook. */
export const WORKER_BASE_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'LS', 'TodoWrite', 'Task', 'Agent', 'Skill', 'WebFetch', 'WebSearch'];

/**
 * A worker's tools plus the MCP servers allowed in goals (ADR-0016). They must be listed: in `dontAsk` mode an
 * unlisted MCP tool is silently denied (which once killed every image generation through media-pipeline).
 */
export const workerTools = (mcpAllowed: readonly string[]): string[] => [...WORKER_BASE_TOOLS, ...mcpAllowed.filter((p) => p.startsWith('mcp__'))];

/** Read-only tool set for clarifier / reviewers. */
export const READONLY_TOOLS = ['Bash', 'Read', 'Glob', 'Grep', 'LS', 'Task', 'Agent', 'Skill', 'WebFetch', 'WebSearch', 'TodoWrite'];
export const READONLY_DISALLOWED = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
