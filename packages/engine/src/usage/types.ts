/** Browser-safe usage types (no runtime imports). Exported as `@foundry/engine/usage-types`. */
import type { AgentProvider } from '@foundry/core/browser';
export interface WindowSummary {
  label: string;
  windowStart: string;
  windowEnd: string;
  resetsAt: string | null;
  status: string | null;
  isUsingOverage: boolean;
  lastSignalAt: string | null;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number;
}

export interface UsageBucket {
  /** bucket start (ISO) */
  t: string;
  /** short label for the axis: "14:00" or "Mon 18" */
  label: string;
  sessions: number;
  costUsd: number;
  outputTokens: number;
}

/** Native ChatGPT account quotas, separate from Foundry's local session totals. */
export interface CodexQuotaWindow {
  usedPercent: number | null;
  windowDurationMins: number | null;
  resetsAt: number | null;
}
export type CodexQuota =
  | { state: 'available'; checkedAt: string; ordinaryUsageAllowed: boolean | null; buckets: { id: string; label: string; primary: CodexQuotaWindow | null; secondary: CodexQuotaWindow | null }[] }
  | { state: 'unavailable' | 'error'; checkedAt: string; message: string };

/** totals both coding agents report for a breakdown row (optional: summaries recorded before they were added lack them) */
export interface GroupMeasures {
  durationMs: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  outputTokens: number;
}

/** one quota bucket of the Antigravity account, as `agy -p /usage` reports it (agy 1.4.4) */
export interface AgyQuotaBucket {
  id: string;
  name: string;
  window: string | null;
  /** 0–1 of the window's limit still left */
  remainingFraction: number | null;
  resetTime: string | null;
}
/** a group of models sharing a limit ("Gemini Models", the third-party ones) */
export interface AgyQuotaGroup {
  name: string;
  description: string | null;
  buckets: AgyQuotaBucket[];
}
export interface AgyQuota {
  state: 'available' | 'unavailable';
  groups: AgyQuotaGroup[];
  checkedAt: string;
  error: string | null;
}

export interface UsageSummary {
  provider?: AgentProvider;
  costAvailable?: boolean;
  codexQuota?: CodexQuota;
  agyQuota?: AgyQuota | null;
  now: string;
  fiveHour: WindowSummary;
  sevenDay: WindowSummary;
  /** cost per hour across the 5-hour window and per day across the 7-day window (empty buckets included) */
  series: { hourly: UsageBucket[]; daily: UsageBucket[] };
  /** rows also say how many of their Claude Code sessions are unmeasured (`unmeasured`): cut before a cost was reported, so the row's cost leaves them out */
  byModel: ({ model: string; sessions: number; costUsd: number; outputTokens: number; unmeasured?: number } & Partial<GroupMeasures>)[];
  byGoal: ({ goalId: string | null; title: string | null; state: string | null; sessions: number; costUsd: number; unmeasured?: number } & Partial<GroupMeasures>)[];
  byKind: ({ kind: string; sessions: number; costUsd: number; avgDurationMs: number; unmeasured?: number } & Partial<GroupMeasures>)[];
  totals: {
    /** cacheRead / (input + cacheRead) over the 7-day window; null when no input */
    cacheHitRate: number | null;
    avgCostPerSession: number | null;
    avgDurationMs: number | null;
    /** sessions whose subtype was not `success` */
    errorSessions: number;
    /** Claude Code sessions in the 7-day window that ended before a cost was reported: their dollars are unknown and missing from every cost here (absent on summaries recorded before this was tracked) */
    unmeasuredSessions?: number;
  };
  limited: { rateLimitType: string; until: string } | null;
  note: string;
}

/** One MiniMax Token Plan model: what is left of its current and weekly window. */
export interface MinimaxModelQuota {
  name: string;
  /** percent left in the current window; null = unknown */
  remainingPercent: number | null;
  /** percent left this week; null = no weekly limit or unknown */
  weeklyRemainingPercent: number | null;
  /** when the current window resets (ISO); null = unknown */
  resetsAt: string | null;
}

/** MiniMax quota as `mmx quota show` reports it. `low` = under 10% left on any model, or under 1 of balance. */
export type MinimaxQuota =
  | { state: 'unavailable'; reason: 'no-cli' | 'no-key'; checkedAt: string }
  | { state: 'error'; message: string; checkedAt: string }
  | { state: 'plan'; models: MinimaxModelQuota[]; low: boolean; checkedAt: string }
  | { state: 'balance'; available: number; low: boolean; checkedAt: string };

// ---- Reports (ADR-0060): what Foundry cost and did over a window, by project and by session kind ----
/** actual ÷ estimate over a set of goals: the median, how many goals it rests on, whether they agree (a Calibration's factor) */
export interface ReportFactor {
  factor: number;
  samples: number;
  spread: 'tight' | 'loose';
}
export interface ReportSpend {
  sessions: number;
  /** Claude Code dollars; Codex sessions and unmeasured ones are left out */
  costUsd: number;
  /** Claude Code sessions cut before a cost was reported: unknown, not $0 */
  unmeasured: number;
  /** sessions that report no dollar cost at all */
  codexSessions: number;
  durationMs: number;
}
export interface ReportGoals {
  total: number;
  finished: number;
  failed: number;
  cancelled: number;
  open: number;
}
export interface ReportRetries {
  /** tasks attempted at least once */
  tasks: number;
  /** tasks that needed more than one attempt */
  retried: number;
  attempts: number;
  /** tasks that mend something after the fact: a review's, an audit's, CI's, the browser QA's, a review comment's */
  fixTasks: number;
  /** retried ÷ tasks; null without tasks */
  rate: number | null;
}
export interface ReportEstimate {
  cost: ReportFactor | null;
  time: ReportFactor | null;
  /** finished goals with an approved, estimated Brief in the window */
  samples: number;
}
export interface ReportRepo extends ReportSpend {
  repoPath: string;
  name: string;
  goals: ReportGoals;
  /** Foundry's working time on the goals, in minutes (waits for the person left out) */
  activeMin: number;
  /** the average cost of a finished Claude Code goal; null without one */
  costPerFinishedGoal: number | null;
  retries: ReportRetries;
  estimate: ReportEstimate;
}
export interface ReportKind extends ReportSpend {
  kind: string;
  /** of the window's Claude Code dollars; null when there are none */
  costShare: number | null;
  /** of the window's session time */
  timeShare: number;
}
export interface ReportBucket {
  /** bucket start (ISO, UTC) */
  t: string;
  label: string;
  sessions: number;
  costUsd: number;
  /** goals that finished in the bucket */
  finished: number;
}
export interface ReportMiss {
  goalId: string;
  title: string;
  repo: string;
  at: string;
  estimateUsd: number;
  actualUsd: number | null;
  estimateMin: number;
  actualMin: number | null;
  costFactor: number | null;
  timeFactor: number | null;
}
export interface Report {
  now: string;
  /** `days` null = all time, from the earliest record */
  window: { days: number | null; from: string; to: string };
  step: 'day' | 'week' | 'month';
  totals: ReportSpend & { goals: ReportGoals; activeMin: number; retries: ReportRetries; estimate: ReportEstimate; /** sessions of no goal (probes, setup) or of a goal since deleted */ noGoal: ReportSpend };
  series: ReportBucket[];
  /** by spend, then time */
  repos: ReportRepo[];
  kinds: ReportKind[];
  /** the goals whose estimates missed most, furthest first */
  misses: ReportMiss[];
  note: string;
}
