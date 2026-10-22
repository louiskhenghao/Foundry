export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk' | 'plan' | 'auto';

export interface AgentDef {
  description: string;
  prompt: string;
  model?: string;
  tools?: string[];
}

/**
 * `interactive`: a session a person is waiting for (Clarify and its planner, a Revise, a Draft). It may use one slot
 * beyond the concurrency limit and goes before queued work. `work` (the default) runs within the limit.
 */
export type RunLane = 'interactive' | 'work';

export interface RunSpec {
  /** First (and in v1 only) user message. */
  prompt: string;
  cwd: string;
  model?: string;
  fallbackModel?: string;
  /** free-form bookkeeping the engine attaches (goalId, tier …); runners ignore it */
  meta?: Record<string, string>;
  maxTurns?: number;
  maxBudgetUsd?: number;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  appendSystemPrompt?: string;
  appendSystemPromptFile?: string;
  agents?: Record<string, AgentDef>;
  /** JSON schema object; when set the result carries `structuredOutput`. */
  jsonSchema?: object;
  /** Serialized to `--settings '<json>'`. */
  settings?: object;
  settingSources?: string[];
  /** load no MCP servers at all (Claude Code's --strict-mcp-config without --mcp-config): a session that only reads the repository */
  strictMcp?: boolean;
  addDirs?: string[];
  /** Claude Code plugin directories loaded for this session (`--plugin-dir`): a workflow suite's hook-less copy (ADR-0049) */
  pluginDirs?: string[];
  /** MCP servers handed to Claude Code for this session (`--mcp-config`), beside the ones it configures itself */
  mcpConfig?: { mcpServers: Record<string, unknown> };
  /** the coding agent's config dir for this session (CLAUDE_CONFIG_DIR, CODEX_HOME): an added account's home (ADR-0065); omitted = the runner's own */
  configHome?: string;
  resumeSessionId?: string;
  /** Claude Code effort level (`--effort`); omitted = the CLI default */
  effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
  /** Wall clock, default 20 min. */
  timeoutMs?: number;
  /** No stdout activity, default 5 min. */
  idleTimeoutMs?: number;
  /** Every raw NDJSON line is appended here before parsing. */
  transcriptPath?: string;
  env?: Record<string, string>;
  /** Optional label for logs. */
  label?: string;
  /** which lane the run takes a slot in; omitted = `work` */
  lane?: RunLane;
}

/**
 * Where a decoded event came from: the transcript file (its name inside the transcripts folder), the 0-based line
 * in that file and the block within the line (one assistant message can carry several). The live feed shortens long
 * events; this is how the full one is read back.
 */
export interface TranscriptRef {
  file: string;
  line: number;
  block: number;
}

export type RunnerEvent = (
  | { kind: 'init'; sessionId: string; model: string | null; tools: string[]; raw: unknown }
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; toolUseId: string; isError: boolean; content: string }
  | { kind: 'rate_limit'; info: RateLimitInfo }
  | { kind: 'hook'; name: string; outcome: string | null }
  /** a long tool call (a sub-agent, mostly) is still running: Claude Code's heartbeat every ~30 s */
  | { kind: 'progress'; toolUseId: string; tool: string; elapsedSeconds: number }
  | { kind: 'result'; result: RunResult }
  | { kind: 'stderr'; text: string }
  | { kind: 'unknown'; raw: unknown }
) & { ref?: TranscriptRef };

export interface RateLimitInfo {
  status: string;
  resetsAt: number | null;
  rateLimitType: string | null;
  isUsingOverage: boolean;
  raw: unknown;
}

export type RunSubtype =
  | 'success'
  | 'error_max_turns'
  | 'error_max_budget_usd'
  | 'error_during_execution'
  | 'killed_timeout'
  | 'killed_idle'
  | 'killed_manual'
  | 'spawn_error'
  | 'no_result'
  | 'orphaned'
  | (string & {});

export interface PermissionDenial {
  tool_name: string;
  tool_input: unknown;
}

/** Why a session failed, as far as the CLI's error text tells: drives model fallback and doctor hints. */
export type FailureClass = 'model_unavailable' | 'auth' | 'rate_limit' | 'other';

/**
 * The error text of a session a limit stopped: an account's usage limit (Claude Code's "You've hit your session limit",
 * Codex's "You’ve hit your usage limit", "out of credits" and "spend cap", Antigravity's "RESOURCE_EXHAUSTED … Individual
 * quota reached" and "credits balance is too low") or the provider's rate limiting (429, overloaded).
 */
export const LIMIT_TEXT = /rate[ _-]?limit|usage[ _-]?limit|hit your [\w ]{0,20}limit|overloaded|too many requests|\b429\b|resource[ _-]?exhausted|quota (?:reached|exceeded|exhausted)|out of credits|spend cap|credits balance is too low/i;

/**
 * A resumed session its coding agent could not pick up: the conversation is not where it looks (another account's home,
 * a cleaned record) or the API refused its earlier turns (another account's thinking signatures or encrypted reasoning).
 */
export const RESUME_REFUSED = /no conversation found|\b(session|thread|conversation)\b.{0,40}not found|could not resume|no saved session|invalid\W{0,3}signature|signature\W{0,3}in\W{0,3}thinking|encrypted content.{0,80}(could not|cannot) be (verified|decrypted)/i;
export function resumeRefused(r: Pick<RunResult, 'isError' | 'errorMessage'>): boolean {
  return r.isError && RESUME_REFUSED.test(r.errorMessage ?? '');
}

const MODEL_UNAVAILABLE = /(model|alias)[^.\n]{0,80}?(not found|does not exist|not supported|unsupported|deprecated|retired|invalid|unknown|no longer (available|supported)|not available)|(not found|does not exist|unknown|invalid|deprecated|unsupported)[^.\n]{0,40}?\bmodel\b|not_found_error[^.\n]{0,80}model/i;

export function classifyFailure(errorMessage: string | null | undefined, subtype?: string): FailureClass | null {
  const text = (errorMessage ?? '').trim();
  if (!text && (!subtype || subtype === 'success')) return null;
  if (MODEL_UNAVAILABLE.test(text)) return 'model_unavailable';
  if (LIMIT_TEXT.test(text)) return 'rate_limit';
  if (/authentication|unauthori[sz]ed|not logged in|invalid api key|401|403/i.test(text)) return 'auth';
  return text || (subtype && subtype !== 'success') ? 'other' : null;
}

export interface RunResult {
  /**
   * `unavailable`: the CLI reported no dollar cost. Codex never does; Claude Code does so on its final `result` line
   * only, which a session cut short (killed at a limit or by hand, crashed) never writes. `usage`, `modelUsage` and
   * `numTurns` are then counted from the stream and the session's own record, and `costUsd` 0 means unknown, not free.
   */
  costStatus?: 'reported' | 'unavailable';
  sessionId: string | null;
  subtype: RunSubtype;
  isError: boolean;
  costUsd: number;
  numTurns: number;
  durationMs: number;
  usage: unknown;
  modelUsage: unknown;
  permissionDenials: PermissionDenial[];
  finalText: string | null;
  structuredOutput: unknown | null;
  exitCode: number | null;
  pid: number | null;
  rateLimit: RateLimitInfo | null;
  errorMessage: string | null;
  /** classification of `errorMessage` (see classifyFailure); absent on older producers */
  failureClass?: FailureClass | null;
  /** skills invoked through the Skill tool, in order of first use (leading "/" stripped) */
  skillsUsed: string[];
  /** tool name → number of calls */
  toolsUsed: Record<string, number>;
  /** which of the coding agent's accounts ran the session (ADR-0065); set by the engine, never by a runner */
  accountId?: string;
}

export interface RunHandle {
  pid: number | null;
  events: AsyncIterable<RunnerEvent>;
  kill(reason: string): void;
  /** Always resolves; never rejects. */
  result: Promise<RunResult>;
}

export interface AgentRunner {
  run(spec: RunSpec): Promise<RunHandle>;
  /** Number of runs currently executing (not queued). */
  active(): number;
  /** Change the concurrency cap at runtime (Settings page); optional for fakes. */
  setMaxConcurrent?(n: number): void;
  /** true when a run in this lane would wait for a slot now (the engine says so before starting one); optional for fakes */
  wouldQueue?(lane?: RunLane): boolean;
}

/** Backwards-compatible name for integrations written before multiple backends. */
export type ClaudeRunner = AgentRunner;
