import { join } from 'node:path';
import { boundaryHook, buildSettings, canaryHook, rmGuardHook } from '@foundry/runner';

/**
 * The mechanical enforcement of Escalation trigger 3. The patterns themselves live in
 * packages/runner/hooks/boundary-guard.sh so the hook has no runtime dependency on the engine.
 */
export function boundarySettings(hooksDir: string): object {
  return buildSettings([canaryHook(join(hooksDir, 'canary.sh')), boundaryHook(join(hooksDir, 'boundary-guard.sh')), rmGuardHook(join(hooksDir, 'rm-guard.ts'))]);
}

/**
 * Tools a worker may use without asking. Bash is guarded by the boundary hook. The media-pipeline
 * MCP server (host plugin behind the image packs) must be listed explicitly: in `dontAsk` mode an
 * unlisted MCP tool is silently denied, which killed every image generation.
 */
export const WORKER_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'LS', 'TodoWrite', 'Task', 'Agent', 'Skill', 'WebFetch', 'WebSearch', 'mcp__plugin_media-pipeline_media-pipeline'];

/** Read-only tool set for clarifier / reviewers. */
export const READONLY_TOOLS = ['Bash', 'Read', 'Glob', 'Grep', 'LS', 'Task', 'Agent', 'Skill', 'WebFetch', 'WebSearch', 'TodoWrite'];
export const READONLY_DISALLOWED = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
