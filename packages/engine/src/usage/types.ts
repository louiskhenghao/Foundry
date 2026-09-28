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

export interface UsageSummary {
  now: string;
  fiveHour: WindowSummary;
  sevenDay: WindowSummary;
  /** cost per hour across the 5-hour window and per day across the 7-day window (empty buckets included) */
  series: { hourly: UsageBucket[]; daily: UsageBucket[] };
  byModel: { model: string; sessions: number; costUsd: number; outputTokens: number }[];
  byGoal: { goalId: string | null; title: string | null; state: string | null; sessions: number; costUsd: number }[];
  byKind: { kind: string; sessions: number; costUsd: number; avgDurationMs: number }[];
  totals: {
    /** cacheRead / (input + cacheRead) over the 7-day window; null when no input */
    cacheHitRate: number | null;
    avgCostPerSession: number | null;
    avgDurationMs: number | null;
    /** sessions whose subtype was not `success` */
    errorSessions: number;
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
