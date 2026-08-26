import { z } from 'zod';
import { Discipline, GoalMode } from './goal.ts';
import { DeliveryMode, DeliveryUnit } from './delivery.ts';

/**
 * User-editable engine settings (Settings page, `data/settings.json`). Every field has a default so a
 * missing/partial file is fine. Precedence at runtime: settings file > environment variable > default.
 */
export const DesignPack = z.enum(['ui-ux-pro-max', 'frontend-design', 'impeccable', 'bencium', 'garden', 'none']);
export type DesignPack = z.infer<typeof DesignPack>;

export const ImagePack = z.enum(['gpt-image-2', 'none']);
export type ImagePack = z.infer<typeof ImagePack>;

export const VideoPack = z.enum(['web-video-presentation', 'mmx-cli', 'none']);
export type VideoPack = z.infer<typeof VideoPack>;

export const EngineSettings = z.object({
  port: z.number().int().min(1).max(65535).default(4111),
  host: z.string().min(1).default('127.0.0.1'),
  maxConcurrent: z.number().int().min(1).max(16).default(3),
  /** path to the claude binary; null = first on PATH */
  claudeBin: z.string().nullable().default(null),
  /** Claude Code home; null = ~/.claude (or CLAUDE_CONFIG_DIR) */
  claudeHome: z.string().nullable().default(null),
});
export const ModelSettings = z.object({
  strong: z.string().min(1).default('opus'),
  cheap: z.string().min(1).default('haiku'),
  worker: z.string().min(1).default('opus'),
  /** tried in order when a tier's model is unavailable (deprecated, unknown alias …) */
  fallbacks: z.array(z.string().min(1)).default(['opus', 'sonnet', 'haiku']),
});
export const SessionSettings = z.object({
  /** how many times one attempt may resume its session (interrupted, capped, or checks still failing with progress) before a fresh attempt; 0 = never */
  maxContinuations: z.number().int().min(0).max(5).default(2),
  attemptMaxTurns: z.number().int().min(10).max(2000).default(150),
  attemptMaxCostUsd: z.number().min(0.5).max(500).default(10),
  attemptTimeoutMin: z.number().int().min(5).max(240).default(20),
});
export const WorkflowSettings = z.object({
  profile: z.enum(['mattpocock', 'plain']).default('mattpocock'),
  /** TDD discipline new goals start with (Expert mode); Simple mode starts with `preferred` */
  tdd: Discipline.default('required'),
  /** which view new goals open in */
  defaultMode: GoalMode.default('expert'),
  designPack: DesignPack.default('ui-ux-pro-max'),
  /** which image-generation skill set media workers follow (scenario `image`) */
  imagePack: ImagePack.default('gpt-image-2'),
  /** which video skill set media workers follow (scenario `video`) */
  videoPack: VideoPack.default('web-video-presentation'),
  /** run `npx autoskills` in each goal's workspace to install skills matching the repository's stack */
  autoskills: z.boolean().default(true),
  /** `--setting-sources` for sessions; null = inherit everything */
  settingSources: z.array(z.string()).nullable().default(null),
});
export const ReviewSettings = z.object({
  alwaysReviewTasks: z.boolean().default(true),
  maxFixCycles: z.number().int().min(0).max(5).default(1),
});
export const DeliverySettings = z.object({
  defaultMode: DeliveryMode.default('local'),
  defaultUnit: DeliveryUnit.default('task'),
  defaultRemote: z.string().min(1).default('origin'),
  pollSec: z.number().int().min(5).max(600).default(30),
  noChecksGraceSec: z.number().int().min(0).max(3600).default(90),
  checksTimeoutMin: z.number().int().min(1).max(720).default(30),
  automergeWaitMin: z.number().int().min(1).max(720).default(10),
});
export const SyncSettings = z.object({
  /** fetch the base branch from its remote before a goal starts exploring / before the goal branch is created */
  fetchBeforeGoal: z.boolean().default(true),
  /** auto: start the goal branch from <remote>/<base> when the local base is behind; local: always from the local base */
  startFrom: z.enum(['auto', 'local']).default('auto'),
  /** between tasks (when nothing is running), fetch again and merge a moved base into the goal branch */
  refreshBetweenTasks: z.boolean().default(false),
});
export const ToolSettings = z.object({
  useGraphify: z.boolean().default(true),
  markitdownBin: z.string().nullable().default(null),
});
export const SafetySettings = z.object({
  /** extra ERE patterns for the boundary guard, '|'-separated */
  extraBoundaryPatterns: z.string().nullable().default(null),
  /** roots the folder browser may enter; null = home + /Volumes */
  allowedRoots: z.array(z.string()).nullable().default(null),
});

export const Settings = z.object({
  engine: EngineSettings.default({}),
  models: ModelSettings.default({}),
  sessions: SessionSettings.default({}),
  workflow: WorkflowSettings.default({}),
  reviews: ReviewSettings.default({}),
  delivery: DeliverySettings.default({}),
  sync: SyncSettings.default({}),
  tools: ToolSettings.default({}),
  safety: SafetySettings.default({}),
});
export type Settings = z.infer<typeof Settings>;
export const DEFAULT_SETTINGS: Settings = Settings.parse({});

/** A deep-partial patch (what the Settings page sends and what the file stores). */
export const SettingsPatch = z.object({
  engine: EngineSettings.partial().optional(),
  models: ModelSettings.partial().optional(),
  sessions: SessionSettings.partial().optional(),
  workflow: WorkflowSettings.partial().optional(),
  reviews: ReviewSettings.partial().optional(),
  delivery: DeliverySettings.partial().optional(),
  sync: SyncSettings.partial().optional(),
  tools: ToolSettings.partial().optional(),
  safety: SafetySettings.partial().optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatch>;

/** dotted leaf paths whose change only takes effect after the engine restarts */
export const RESTART_SETTINGS = ['engine.port', 'engine.host', 'engine.claudeBin', 'engine.claudeHome'] as const;

export type SettingSource = 'file' | 'env' | 'default';
export interface SettingMeta {
  source: SettingSource;
  restart: boolean;
  /** environment variable that seeds this value when the file has none */
  env: string | null;
  default: unknown;
}
export interface SettingsView {
  values: Settings;
  meta: Record<string, SettingMeta>;
  /** restart-only settings whose file value differs from what this process booted with */
  restartNeeded: string[];
  file: string;
  fileExists: boolean;
}
