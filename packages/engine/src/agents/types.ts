// Browser-safe: imported by the web app via `@foundry/engine/agents-types` — no node imports here.

export type AgentSource = 'foundry' | 'external';
/** busy = output within the last minute (or a Foundry in-flight session); idle = process alive but waiting */
export type AgentStatus = 'busy' | 'idle' | 'finished';

export interface AgentSubagentRow {
  agentId: string;
  agentType: string;
  description: string;
  status: 'running' | 'done';
  lastActivityAt: string | null;
}

export interface AgentSessionRow {
  sessionId: string;
  source: AgentSource;
  /** 'cli' | 'claude-vscode' | … from the session registry/transcript; 'foundry' for engine-spawned rows */
  entrypoint: string | null;
  status: AgentStatus;
  pid: number | null;
  model: string | null;
  title: string | null;
  /** from inside the transcript/registry — the projects/ dir-name mangling is lossy */
  cwd: string | null;
  gitBranch: string | null;
  startedAt: string | null;
  endedAt: string | null;
  lastActivityAt: string | null;
  contextUsedTokens: number | null;
  contextWindowTokens: number | null;
  version: string | null;
  subagents: AgentSubagentRow[];
  foundry: { goalId: string; goalTitle: string | null; taskId: string | null; attemptId: string | null; killable: boolean } | null;
}

export interface AgentsSummary {
  busy: number;
  idle: number;
  finished: number;
  total: number;
}

export interface AgentsList {
  sessions: AgentSessionRow[];
  summary: AgentsSummary;
  generatedAt: string;
}

export type AgentLogItem =
  | { kind: 'user'; text: string; ts: string | null }
  /** a slash command the user ran (parsed out of the command XML markers) */
  | { kind: 'command'; name: string; args: string; ts: string | null }
  /** dim one-liner: local command output, "interrupted by user", … */
  | { kind: 'notice'; text: string; ts: string | null }
  | { kind: 'assistant'; text: string; ts: string | null; model: string | null }
  | { kind: 'thinking'; text: string; ts: string | null }
  | { kind: 'tool_use'; id: string; name: string; input: string; ts: string | null }
  | { kind: 'tool_result'; forId: string; content: string; isError: boolean; ts: string | null }
  | { kind: 'compact'; preTokens: number; postTokens: number; ts: string | null };

export interface AgentLogChunk {
  items: AgentLogItem[];
  /** byte offset to pass on the next poll (end of the last complete line consumed) */
  offset: number;
  /** file size at read time */
  size: number;
  /** false when the response was capped — re-poll immediately instead of waiting */
  eof: boolean;
  status: AgentStatus;
}
