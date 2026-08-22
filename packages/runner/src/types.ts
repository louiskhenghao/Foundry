export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk' | 'plan' | 'auto';

export interface AgentDef {
  description: string;
  prompt: string;
  model?: string;
  tools?: string[];
}

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
  addDirs?: string[];
  resumeSessionId?: string;
  /** Wall clock, default 20 min. */
  timeoutMs?: number;
  /** No stdout activity, default 5 min. */
  idleTimeoutMs?: number;
  /** Every raw NDJSON line is appended here before parsing. */
  transcriptPath?: string;
  env?: Record<string, string>;
  /** Optional label for logs. */
  label?: string;
}

export type RunnerEvent =
  | { kind: 'init'; sessionId: string; model: string | null; tools: string[]; raw: unknown }
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; toolUseId: string; isError: boolean; content: string }
  | { kind: 'rate_limit'; info: RateLimitInfo }
  | { kind: 'hook'; name: string; outcome: string | null }
  | { kind: 'result'; result: RunResult }
  | { kind: 'stderr'; text: string }
  | { kind: 'unknown'; raw: unknown };

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

const MODEL_UNAVAILABLE = /(model|alias)[^.\n]{0,80}?(not found|does not exist|not supported|unsupported|deprecated|retired|invalid|unknown|no longer (available|supported)|not available)|(not found|does not exist|unknown|invalid|deprecated|unsupported)[^.\n]{0,40}?\bmodel\b|not_found_error[^.\n]{0,80}model/i;

export function classifyFailure(errorMessage: string | null | undefined, subtype?: string): FailureClass | null {
  const text = (errorMessage ?? '').trim();
  if (!text && (!subtype || subtype === 'success')) return null;
  if (MODEL_UNAVAILABLE.test(text)) return 'model_unavailable';
  if (/rate[ _-]?limit|overloaded|429/i.test(text)) return 'rate_limit';
  if (/authentication|unauthori[sz]ed|not logged in|invalid api key|401|403/i.test(text)) return 'auth';
  return text || (subtype && subtype !== 'success') ? 'other' : null;
}

export interface RunResult {
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
}

export interface RunHandle {
  pid: number | null;
  events: AsyncIterable<RunnerEvent>;
  kill(reason: string): void;
  /** Always resolves; never rejects. */
  result: Promise<RunResult>;
}

export interface ClaudeRunner {
  run(spec: RunSpec): Promise<RunHandle>;
  /** Number of runs currently executing (not queued). */
  active(): number;
  /** Change the concurrency cap at runtime (Settings page); optional for fakes. */
  setMaxConcurrent?(n: number): void;
}
