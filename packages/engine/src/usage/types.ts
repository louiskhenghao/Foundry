/** Browser-safe usage types (no runtime imports). Exported as `@foundry/engine/usage-types`. */
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

export interface UsageSummary {
  provider?: 'claude' | 'codex';
  costAvailable?: boolean;
  codexQuota?: CodexQuota;
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
