export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '0001-events',
    sql: `
      CREATE TABLE IF NOT EXISTS events (
        seq      INTEGER PRIMARY KEY AUTOINCREMENT,
        id       TEXT NOT NULL UNIQUE,
        ts       TEXT NOT NULL,
        goal_id  TEXT,
        type     TEXT NOT NULL,
        payload  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_goal ON events(goal_id, seq);
    `,
  },
  {
    id: '0002-read-models',
    sql: `
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, task_id TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attempts_task ON attempts(task_id);
      CREATE TABLE IF NOT EXISTS checks (
        id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, task_id TEXT, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checks_goal ON checks(goal_id);
      CREATE TABLE IF NOT EXISTS check_results (
        id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, check_id TEXT NOT NULL, attempt_id TEXT, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_check_results_attempt ON check_results(attempt_id);
      CREATE TABLE IF NOT EXISTS briefs (
        goal_id TEXT PRIMARY KEY, approved INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS observations (
        attempt_id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, task_id TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS escalations (
        id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, task_id TEXT, state TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_escalations_goal ON escalations(goal_id);
    `,
  },
  {
    id: '0004-usage',
    sql: `
      CREATE TABLE IF NOT EXISTS usage_ledger (
        event_id TEXT PRIMARY KEY, ts TEXT NOT NULL, goal_id TEXT, kind TEXT NOT NULL, model TEXT,
        input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL, cache_create_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL, duration_ms INTEGER NOT NULL, subtype TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_ledger(ts);
      CREATE TABLE IF NOT EXISTS rate_limit_state (
        rate_limit_type TEXT PRIMARY KEY, status TEXT NOT NULL, resets_at INTEGER, is_using_overage INTEGER NOT NULL, seen_at TEXT NOT NULL
      );
    `,
  },
  {
    id: '0003-stats',
    sql: `
      CREATE TABLE IF NOT EXISTS stats (
        key TEXT PRIMARY KEY, count INTEGER NOT NULL, total REAL NOT NULL
      );
    `,
  },
];
