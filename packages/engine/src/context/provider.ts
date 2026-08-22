import type { Goal, Task } from '@ai-engine/core';

/**
 * The only other abstraction seam besides ClaudeRunner. A ContextProvider decides what
 * parts of a repository a session needs to see. v1 ships grep + graphify; RTK / gitnexus /
 * claude-mem would plug in here.
 */
export interface ContextProvider {
  readonly name: string;
  /** One-off preparation for a repo (e.g. build a graph). Must be idempotent and safe to skip. */
  prepare(repoPath: string): Promise<void>;
  /** Short, token-budgeted context block for a task, or null if nothing useful. */
  locate(goal: Goal, task: Task): Promise<string | null>;
  /** Free-form question against the repo, used by the clarifier prompt. */
  overview(repoPath: string): Promise<string | null>;
}

export class NullContextProvider implements ContextProvider {
  readonly name = 'null';
  async prepare() {}
  async locate() {
    return null;
  }
  async overview() {
    return null;
  }
}
