import { DEFAULT_NATURE_PRESETS, ModelPreset } from './model-presets.ts';
import { z } from 'zod';
import { Discipline, GoalMode } from './goal.ts';
import { DeliveryMode, DeliveryUnit } from './delivery.ts';

/**
 * User-editable engine settings (Settings page, `data/settings.json`). Every field has a default so a
 * missing/partial file is fine. Precedence at runtime: settings file > environment variable > default.
 */
export const DesignPack = z.enum(['ui-ux-pro-max', 'frontend-design', 'impeccable', 'bencium', 'garden', 'taste', 'none']);
export type DesignPack = z.infer<typeof DesignPack>;

export const ImagePack = z.enum(['gpt-image-2', 'claude-image-gen', 'taste-imagegen', 'none']);
export type ImagePack = z.infer<typeof ImagePack>;

export const VideoPack = z.enum(['web-video-presentation', 'mmx-cli', 'hyperframes', 'none']);
export type VideoPack = z.infer<typeof VideoPack>;

export const EngineSettings = z.object({
  port: z.number().int().min(1).max(65535).default(4111),
  host: z.string().min(1).default('127.0.0.1'),
  maxConcurrent: z.number().int().min(1).max(16).default(3),
  /** path to the claude binary; null = first on PATH */
  claudeBin: z.string().nullable().default(null),
  /** Claude Code home; null = ~/.claude (or CLAUDE_CONFIG_DIR) */
  claudeHome: z.string().nullable().default(null),
  /** where progress folders (goal worktrees) are created: `<root>/<repo-name>/<goal>`; null = next to each repository as `<repo-name>-foundry/` */
  workspacesRoot: z.string().nullable().default(null),
});
export const ModelSettings = z.object({
  /** the housekeeping model: one-turn engine chores (classifying a goal, summarising logs, the rate-limit probe) */
  cheap: z.string().min(1).default('haiku'),
  /** tried in order when a tier's model is unavailable (deprecated, unknown alias …) */
  fallbacks: z.array(z.string().min(1)).default(['opus', 'sonnet', 'haiku']),
  /** presets you edited or created (built-ins you never touched are not stored) */
  presets: z.record(z.string(), ModelPreset).default({}),
  /** which preset each goal nature uses */
  presetCode: z.string().min(1).default(DEFAULT_NATURE_PRESETS.code),
  presetDocs: z.string().min(1).default(DEFAULT_NATURE_PRESETS.docs),
  presetMedia: z.string().min(1).default(DEFAULT_NATURE_PRESETS.media),
  /** the last attempt of a budget ≥ 2, and every attempt you grant beyond the budget, run on the Complex-task model */
  escalateLastAttempt: z.boolean().default(true),
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
  /** pace new goals start with: fast skips the engine's own AI reviews (approved checks always run) */
  defaultPace: z.enum(['thorough', 'fast']).default('thorough'),
  /** whether Clarify interviews the human in rounds before writing the Brief: auto = when something is worth asking; always = at least one round; never = the one-shot Brief */
  interview: z.enum(['auto', 'always', 'never']).default('auto'),
  /** effort level new goals hand to every session (`claude --effort`); null = the CLI default */
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullable().default(null),
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
  /** a goal whose diff is this many lines or fewer is reviewed by the cheap tier without review skills (sub-agents) */
  smallGoalLines: z.number().int().min(0).max(5000).default(400),
});
export const DeliverySettings = z.object({
  defaultMode: DeliveryMode.default('local'),
  /** one PR per goal by default; per-task stacked PRs are opt-in (each PR is a full push / wait / merge cycle) */
  defaultUnit: DeliveryUnit.default('goal'),
  defaultRemote: z.string().min(1).default('origin'),
  pollSec: z.number().int().min(5).max(600).default(30),
  noChecksGraceSec: z.number().int().min(0).max(3600).default(90),
  checksTimeoutMin: z.number().int().min(1).max(720).default(30),
  automergeWaitMin: z.number().int().min(1).max(720).default(10),
  /** after a merge: fast-forward the user's local base branch when it is safe, then tidy the goal's folders and branches */
  updateLocalBase: z.boolean().default(true),
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
  /** OpenAI-compatible API key handed to sessions as OPENAI_API_KEY (image generation via the image pack); null = whatever the engine's own environment has */
  openaiApiKey: z.string().nullable().default(null),
  /** endpoint override handed to sessions as OPENAI_BASE_URL (proxies, compatible providers); null = provider default */
  openaiBaseUrl: z.string().nullable().default(null),
  /** Kimi (Moonshot) key handed to sessions as MOONSHOT_API_KEY and KIMI_API_KEY (taste-skill's sponsored Kimi K3); null = whatever the engine's own environment has */
  kimiApiKey: z.string().nullable().default(null),
  /** Gemini key handed to sessions as GEMINI_API_KEY (claude-image-gen's default provider); null = whatever the engine's own environment has */
  geminiApiKey: z.string().nullable().default(null),
});
export const NotificationSettings = z.object({
  /** Telegram bot token from @BotFather; null = Telegram channel off */
  telegramBotToken: z.string().min(1).nullable().default(null),
  /** chat the bot posts to; the Settings page fills it via getUpdates after the user messages the bot */
  telegramChatId: z.string().min(1).nullable().default(null),
  /** Discord webhook URL; null = Discord channel off */
  discordWebhookUrl: z.string().url().nullable().default(null),
  /** where this UI is reachable from outside (Tailscale, LAN…); null = messages carry no links */
  baseUrl: z.string().url().nullable().default(null),
  /** an Escalation was raised — a task or goal is blocked and needs the human */
  onEscalation: z.boolean().default(true),
  /** the Clarify interview asked a round of questions */
  onInterview: z.boolean().default(true),
  /** a goal ended done / over-delivered / failed (cancelling is the human's own act and never notifies) */
  onGoalFinished: z.boolean().default(true),
  /** a PR opened, merged, or the delivery failed */
  onDelivery: z.boolean().default(true),
  /** a Claude usage limit paused the engine / the pause lifted */
  onRateLimit: z.boolean().default(true),
  /** a Foundry release newer than this instance exists (once per version) */
  onUpdateAvailable: z.boolean().default(true),
});
export type NotificationSettings = z.infer<typeof NotificationSettings>;
export const SafetySettings = z.object({
  /** extra ERE patterns for the boundary guard, '|'-separated */
  extraBoundaryPatterns: z.string().nullable().default(null),
  /** roots the folder browser may enter; null = home + /Volumes */
  allowedRoots: z.array(z.string()).nullable().default(null),
});

export const PreviewSettings = z.object({
  /** ports handed to goal previews (the run command in a progress folder), inclusive range */
  portFrom: z.number().int().min(1024).max(65535).default(4200),
  portTo: z.number().int().min(1024).max(65535).default(4299),
  /** a preview nobody has opened for this long is stopped */
  idleMinutes: z.number().int().min(5).max(1440).default(60),
});
export const ChecksSettings = z.object({
  /** default for new goals: after each integration, open the preview headless, screenshot it, fail on console/network errors */
  selfCheck: z.boolean().default(false),
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
  notifications: NotificationSettings.default({}),
  safety: SafetySettings.default({}),
  preview: PreviewSettings.default({}),
  checks: ChecksSettings.default({}),
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
  notifications: NotificationSettings.partial().optional(),
  safety: SafetySettings.partial().optional(),
  preview: PreviewSettings.partial().optional(),
  checks: ChecksSettings.partial().optional(),
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
