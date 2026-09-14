import { Effort } from '@foundry/core';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface EngineConfig {
  /** The Foundry checkout/install itself (root package.json = the product version; local self-update runs git here). */
  rootDir: string;
  /** Where engine.db, transcripts, worktrees, check outputs live. */
  dataDir: string;
  /** Claude Code home (~/.claude). Tests point this at a temp dir. */
  claudeHome: string;
  /** Path to catalog/skills.json */
  catalogPath: string;
  /** Directory with roles/*.md */
  rolesDir: string;
  /** Directory with boundary-guard.sh / canary.sh */
  hooksDir: string;
  port: number;
  host: string;
  claudeBin?: string;
  /** Global cap on concurrent claude processes. */
  maxConcurrent: number;
  /** `--setting-sources`; undefined = inherit everything (user skills included). */
  settingSources?: string[];
  /** progress-folder root (Settings → engine.workspacesRoot); null = next to each repository */
  workspacesRoot: string | null;
  /** ports handed to goal previews (inclusive) and how long an unvisited preview lives */
  preview: { portFrom: number; portTo: number; idleMinutes: number };
  /** default for new goals: run the headless self-check on the preview after each integration */
  selfCheck: boolean;
  /** how Clarify starts for new goals: interview in rounds when useful / always at least one round / never (one-shot Brief) */
  interview: 'auto' | 'always' | 'never';
  /** effort handed to every session of new goals; null = CLI default */
  effort: Effort | null;
  /** model tier for the goal review, and the diff size under which the cheap tier reviews without skills */
  goalReviewer: 'strong' | 'worker' | 'cheap';
  smallGoalLines: number;
  models: { strong: string; cheap: string; worker: string };
  /** tried in order when a session's model turns out to be unavailable (deprecated alias, retired id) */
  modelFallbacks: string[];
  attemptTimeoutMs: number;
  attemptMaxTurns: number;
  /** continuations (session resumes) allowed per attempt before a fresh attempt; 0 = off */
  maxContinuations: number;
  /** Per-attempt cost cap passed as --max-budget-usd (also bounded by goal remaining budget). */
  attemptMaxCostUsd: number;
  /** Extra ERE patterns for the boundary guard, '|'-separated. */
  extraBoundaryPatterns?: string;
  /** Use graphify for relevant-file discovery when available. */
  useGraphify: boolean;
  /** Run the lightweight task reviewer even when the task has no explicit reviewer check. */
  alwaysReviewTasks: boolean;
  /** Max goal-level review → fix-task cycles before escalating. */
  maxFixCycles: number;
  /** Default delivery policy for new goals (env FOUNDRY_DELIVERY_MODE). */
  defaultDelivery?: { mode?: 'local' | 'push' | 'pr' | 'pr-automerge'; remote?: string; unit?: 'goal' | 'task' };
  /** which design skill set UI tasks use (catalog entries with pack "design"); 'none' = no design skill is mandated */
  designPack: string;
  workflowPace: 'thorough' | 'fast';
  imagePack: string;
  videoPack: string;
  /** run `npx autoskills` in each goal's workspace so the repository's stack gets matching project skills */
  autoskills: boolean;
  /** fetch the base branch before a goal starts; start the goal branch from the remote tip when local is behind; re-fetch between tasks */
  sync: { fetchBeforeGoal: boolean; startFrom: 'auto' | 'local'; refreshBetweenTasks: boolean };
  /** Delivery pipeline timings (tests shrink these). */
  delivery: { pollMs: number; noChecksGraceMs: number; checksTimeoutMs: number; automergeWaitMs: number };
  /** Roots the folder browser may enter (default: home, /Volumes). */
  allowedRoots?: string[];
  /**
   * `mattpocock` (default): roles are told which workflow skills they MUST / should invoke (catalog `workflow` rules)
   * and the engine records which skills each session used. `plain`: only the one-line "installed skills" hint.
   */
  workflowProfile: 'mattpocock' | 'plain';
  /** TDD discipline new Expert-mode goals start with */
  workflowTdd: 'required' | 'preferred' | 'off';
  /** view new goals open in */
  defaultGoalMode: 'simple' | 'expert';
  /** markitdown binary override (env FOUNDRY_MARKITDOWN); auto-detected on PATH and ~/.local/bin otherwise */
  markitdownBin?: string;
  /** OpenAI-compatible key handed to every session as OPENAI_API_KEY (image generation); env OPENAI_API_KEY reaches sessions anyway */
  openaiApiKey?: string;
  /** endpoint override handed to sessions as OPENAI_BASE_URL */
  openaiBaseUrl?: string;
  /** Kimi (Moonshot) key handed to sessions as MOONSHOT_API_KEY + KIMI_API_KEY */
  kimiApiKey?: string;
  /** Gemini key handed to sessions as GEMINI_API_KEY */
  geminiApiKey?: string;
  log: (msg: string) => void;
}

export function defaultConfig(root: string, overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    rootDir: resolve(root),
    dataDir: resolve(root, 'data'),
    claudeHome: process.env.FOUNDRY_CLAUDE_HOME ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
    catalogPath: resolve(root, 'catalog/skills.json'),
    rolesDir: resolve(root, 'roles'),
    hooksDir: resolve(root, 'packages/runner/hooks'),
    port: Number(process.env.FOUNDRY_PORT ?? 4111),
    host: process.env.FOUNDRY_HOST ?? '127.0.0.1',
    maxConcurrent: Number(process.env.FOUNDRY_MAX_CONCURRENT ?? 3),
    workspacesRoot: process.env.FOUNDRY_WORKSPACES_ROOT ?? null,
    preview: { portFrom: Number(process.env.FOUNDRY_PREVIEW_PORT_FROM ?? 4200), portTo: Number(process.env.FOUNDRY_PREVIEW_PORT_TO ?? 4299), idleMinutes: Number(process.env.FOUNDRY_PREVIEW_IDLE_MIN ?? 60) },
    selfCheck: process.env.FOUNDRY_SELF_CHECK === '1' || process.env.FOUNDRY_SELF_CHECK === 'true',
    interview: (['auto', 'always', 'never'] as const).find((m) => m === process.env.FOUNDRY_INTERVIEW) ?? 'auto',
    effort: Effort.options.find((e) => e === process.env.FOUNDRY_EFFORT) ?? null,
    goalReviewer: (['strong', 'worker', 'cheap'] as const).find((t) => t === process.env.FOUNDRY_GOAL_REVIEWER) ?? 'strong',
    smallGoalLines: Number(process.env.FOUNDRY_SMALL_GOAL_LINES ?? 400),
    models: { strong: process.env.FOUNDRY_MODEL_STRONG ?? 'opus', cheap: process.env.FOUNDRY_MODEL_CHEAP ?? 'haiku', worker: process.env.FOUNDRY_MODEL_WORKER ?? 'opus' },
    modelFallbacks: (process.env.FOUNDRY_MODEL_FALLBACKS ?? 'opus,sonnet,haiku').split(',').map((s) => s.trim()).filter(Boolean),
    attemptTimeoutMs: 20 * 60_000,
    maxContinuations: process.env.FOUNDRY_MAX_CONTINUATIONS ? Number(process.env.FOUNDRY_MAX_CONTINUATIONS) : 2,
    // the cost cap is the real guard; turns only stop runaway loops
    attemptMaxTurns: Number(process.env.FOUNDRY_ATTEMPT_MAX_TURNS ?? 150),
    // per-session cap; a strong model on a real task often needs $3–8, and a session killed mid-work wastes what it spent
    attemptMaxCostUsd: Number(process.env.FOUNDRY_ATTEMPT_MAX_COST ?? 10),
    useGraphify: true,
    alwaysReviewTasks: true,
    maxFixCycles: 1,
    defaultDelivery: { unit: 'task', ...(process.env.FOUNDRY_DELIVERY_MODE ? { mode: process.env.FOUNDRY_DELIVERY_MODE as any } : {}) },
    designPack: process.env.FOUNDRY_DESIGN_PACK ?? 'ui-ux-pro-max',
    workflowPace: process.env.FOUNDRY_PACE === 'fast' ? 'fast' : 'thorough',
    imagePack: process.env.FOUNDRY_IMAGE_PACK ?? 'gpt-image-2',
    videoPack: process.env.FOUNDRY_VIDEO_PACK ?? 'web-video-presentation',
    autoskills: process.env.FOUNDRY_AUTOSKILLS ? !/^(0|false|off|no)$/i.test(process.env.FOUNDRY_AUTOSKILLS) : true,
    sync: { fetchBeforeGoal: process.env.FOUNDRY_SYNC_FETCH ? !/^(0|false|off|no)$/i.test(process.env.FOUNDRY_SYNC_FETCH) : true, startFrom: process.env.FOUNDRY_SYNC_START === 'local' ? 'local' : 'auto', refreshBetweenTasks: /^(1|true|on|yes)$/i.test(process.env.FOUNDRY_SYNC_REFRESH ?? '') },
    delivery: { pollMs: 30_000, noChecksGraceMs: 90_000, checksTimeoutMs: 30 * 60_000, automergeWaitMs: 10 * 60_000 },
    workflowProfile: process.env.FOUNDRY_WORKFLOW === 'plain' ? 'plain' : 'mattpocock',
    workflowTdd: (['required', 'preferred', 'off'].includes(process.env.FOUNDRY_TDD ?? '') ? process.env.FOUNDRY_TDD : 'required') as 'required' | 'preferred' | 'off',
    defaultGoalMode: process.env.FOUNDRY_GOAL_MODE === 'simple' ? 'simple' : 'expert',
    markitdownBin: process.env.FOUNDRY_MARKITDOWN,
    log: (m) => console.log(m),
    ...overrides,
  };
}
