/**
 * Persisted, user-editable settings (`data/settings.json`) layered over the environment and the
 * built-in defaults: file > env > default. The file stores only the leaves the user changed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, RESTART_SETTINGS, Settings, SettingsPatch, type SettingMeta, type SettingsView } from '@foundry/core';
import type { EngineConfig } from './config.ts';

export const SETTINGS_FILE = 'settings.json';

const bool = (v: string) => !/^(0|false|off|no)$/i.test(v);
const str = (v: string) => v;
const num = (v: string) => Number(v);

/** env var that seeds a leaf when the file has no value for it */
const ENV: Record<string, { name: string; alt?: string; parse: (v: string) => unknown }> = {
  'engine.port': { name: 'FOUNDRY_PORT', parse: num },
  'engine.host': { name: 'FOUNDRY_HOST', parse: str },
  'engine.maxConcurrent': { name: 'FOUNDRY_MAX_CONCURRENT', parse: num },
  'engine.claudeHome': { name: 'FOUNDRY_CLAUDE_HOME', alt: 'CLAUDE_CONFIG_DIR', parse: str },
  'engine.workspacesRoot': { name: 'FOUNDRY_WORKSPACES_ROOT', parse: str },
  'preview.portFrom': { name: 'FOUNDRY_PREVIEW_PORT_FROM', parse: num },
  'preview.portTo': { name: 'FOUNDRY_PREVIEW_PORT_TO', parse: num },
  'preview.idleMinutes': { name: 'FOUNDRY_PREVIEW_IDLE_MIN', parse: num },
  'checks.selfCheck': { name: 'FOUNDRY_SELF_CHECK', parse: bool },
  'models.cheap': { name: 'FOUNDRY_MODEL_CHEAP', parse: str },
  'models.fallbacks': { name: 'FOUNDRY_MODEL_FALLBACKS', parse: (v) => v.split(',').map((s) => s.trim()).filter(Boolean) },
  'sessions.attemptMaxTurns': { name: 'FOUNDRY_ATTEMPT_MAX_TURNS', parse: num },
  'sessions.maxContinuations': { name: 'FOUNDRY_MAX_CONTINUATIONS', parse: num },
  'sessions.attemptMaxCostUsd': { name: 'FOUNDRY_ATTEMPT_MAX_COST', parse: num },
  'workflow.profile': { name: 'FOUNDRY_WORKFLOW', parse: str },
  'workflow.tdd': { name: 'FOUNDRY_TDD', parse: str },
  'workflow.defaultMode': { name: 'FOUNDRY_GOAL_MODE', parse: str },
  'workflow.designPack': { name: 'FOUNDRY_DESIGN_PACK', parse: str },
  'workflow.defaultPace': { name: 'FOUNDRY_PACE', parse: str },
  'workflow.interview': { name: 'FOUNDRY_INTERVIEW', parse: str },
  'workflow.effort': { name: 'FOUNDRY_EFFORT', parse: str },
  'reviews.smallGoalLines': { name: 'FOUNDRY_SMALL_GOAL_LINES', parse: num },
  'workflow.imagePack': { name: 'FOUNDRY_IMAGE_PACK', parse: str },
  'workflow.videoPack': { name: 'FOUNDRY_VIDEO_PACK', parse: str },
  'workflow.autoskills': { name: 'FOUNDRY_AUTOSKILLS', parse: bool },
  'delivery.defaultMode': { name: 'FOUNDRY_DELIVERY_MODE', parse: str },
  'sync.fetchBeforeGoal': { name: 'FOUNDRY_SYNC_FETCH', parse: bool },
  'sync.startFrom': { name: 'FOUNDRY_SYNC_START', parse: str },
  'sync.refreshBetweenTasks': { name: 'FOUNDRY_SYNC_REFRESH', parse: bool },
  'tools.markitdownBin': { name: 'FOUNDRY_MARKITDOWN', parse: str },
  'tools.openaiApiKey': { name: 'OPENAI_API_KEY', parse: str },
  'tools.openaiBaseUrl': { name: 'OPENAI_BASE_URL', parse: str },
  'tools.kimiApiKey': { name: 'KIMI_API_KEY', parse: str },
  'tools.geminiApiKey': { name: 'GEMINI_API_KEY', parse: str },
  'notifications.telegramBotToken': { name: 'FOUNDRY_TELEGRAM_BOT_TOKEN', parse: str },
  'notifications.telegramChatId': { name: 'FOUNDRY_TELEGRAM_CHAT_ID', parse: str },
  'notifications.discordWebhookUrl': { name: 'FOUNDRY_DISCORD_WEBHOOK', parse: str },
  'notifications.baseUrl': { name: 'FOUNDRY_NOTIFY_BASE_URL', parse: str },
};

export const SETTING_PATHS: string[] = Object.entries(DEFAULT_SETTINGS).flatMap(([section, v]) => Object.keys(v as object).map((k) => `${section}.${k}`));

const get = (o: any, path: string): unknown => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
const set = (o: any, path: string, v: unknown): void => {
  const parts = path.split('.');
  let cur = o;
  for (const k of parts.slice(0, -1)) cur = cur[k] ??= {};
  cur[parts.at(-1)!] = v;
};
const has = (o: any, path: string): boolean => get(o, path) !== undefined;

export interface Resolved {
  values: Settings;
  meta: Record<string, SettingMeta>;
}

/** Layer file over env over defaults; invalid env/file values fall back to the next layer and are logged. */
export function resolveSettings(file: SettingsPatch, env: NodeJS.ProcessEnv = process.env, log?: (m: string) => void): Resolved {
  const values: any = structuredClone(DEFAULT_SETTINGS);
  const meta: Record<string, SettingMeta> = {};
  const candidates: { path: string; source: 'file' | 'env'; value: unknown }[] = [];
  for (const path of SETTING_PATHS) {
    const e = ENV[path];
    const envName = e?.name ?? null;
    meta[path] = { source: 'default', restart: (RESTART_SETTINGS as readonly string[]).includes(path), env: envName, default: get(DEFAULT_SETTINGS, path) };
    if (e) {
      const raw = env[e.name] ?? (e.alt ? env[e.alt] : undefined);
      if (raw !== undefined && raw !== '') candidates.push({ path, source: 'env', value: e.parse(raw) });
    }
    if (has(file, path)) candidates.push({ path, source: 'file', value: get(file, path) });
  }
  // apply env first, then file (file wins); validate each leaf in isolation so one bad value cannot poison the rest
  for (const c of candidates) {
    const trial = structuredClone(values);
    set(trial, c.path, c.value);
    const parsed = Settings.safeParse(trial);
    if (parsed.success) {
      set(values, c.path, get(parsed.data, c.path));
      meta[c.path]!.source = c.source;
    } else log?.(`[settings] ignoring ${c.source} value for ${c.path}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  return { values: Settings.parse(values), meta };
}

export class SettingsStore {
  readonly path: string;
  private file: SettingsPatch = {};
  private boot: Settings;
  constructor(
    dataDir: string,
    private env: NodeJS.ProcessEnv = process.env,
    private log?: (m: string) => void,
  ) {
    this.path = join(dataDir, SETTINGS_FILE);
    this.file = this.load();
    this.boot = this.resolve().values;
  }
  private load(): SettingsPatch {
    if (!existsSync(this.path)) return {};
    try {
      const parsed = SettingsPatch.safeParse(JSON.parse(readFileSync(this.path, 'utf8')));
      if (parsed.success) return parsed.data;
      this.log?.(`[settings] ${this.path} has invalid entries, ignoring them: ${parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ')}`);
      return {};
    } catch (err) {
      this.log?.(`[settings] could not read ${this.path}: ${String(err)}`);
      return {};
    }
  }
  private save(): void {
    mkdirSync(join(this.path, '..'), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.file, null, 2) + '\n');
  }
  resolve(): Resolved {
    return resolveSettings(this.file, this.env, this.log);
  }
  values(): Settings {
    return this.resolve().values;
  }
  /** leaves whose value comes from the file (what overrides the env-built config at startup) */
  fileLeaves(): Set<string> {
    return new Set(SETTING_PATHS.filter((p) => has(this.file, p)));
  }
  restartNeeded(): string[] {
    const now = this.values();
    return (RESTART_SETTINGS as readonly string[]).filter((p) => JSON.stringify(get(now, p)) !== JSON.stringify(get(this.boot, p)));
  }
  view(): SettingsView {
    const { values, meta } = this.resolve();
    return { values, meta, restartNeeded: this.restartNeeded(), file: this.path, fileExists: existsSync(this.path) };
  }
  /** Merge a deep-partial patch into the file; returns the leaves whose effective value changed. */
  update(patch: SettingsPatch): { changed: string[]; view: SettingsView } {
    const before = this.values();
    const next: any = structuredClone(this.file);
    for (const path of SETTING_PATHS) if (has(patch, path)) set(next, path, get(patch, path));
    const check = Settings.safeParse({ ...DEFAULT_SETTINGS, ...mergeSections(next) });
    if (!check.success) throw new SettingsError(check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    this.file = SettingsPatch.parse(next);
    this.save();
    const after = this.values();
    const changed = SETTING_PATHS.filter((p) => JSON.stringify(get(before, p)) !== JSON.stringify(get(after, p)));
    return { changed, view: this.view() };
  }
  /** Drop one leaf (or everything) from the file so env/default apply again. */
  reset(path?: string): { changed: string[]; view: SettingsView } {
    const before = this.values();
    if (!path) this.file = {};
    else {
      if (!SETTING_PATHS.includes(path)) throw new SettingsError(`unknown setting ${path}`);
      const [section, key] = path.split('.') as [keyof SettingsPatch, string];
      const s = this.file[section] as Record<string, unknown> | undefined;
      if (s) {
        delete s[key];
        if (!Object.keys(s).length) delete this.file[section];
      }
    }
    this.save();
    const after = this.values();
    return { changed: SETTING_PATHS.filter((p) => JSON.stringify(get(before, p)) !== JSON.stringify(get(after, p))), view: this.view() };
  }
}

function mergeSections(patch: any): any {
  const out: any = {};
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) out[k] = { ...(v as object), ...(patch[k] ?? {}) };
  return out;
}

export class SettingsError extends Error {}

/**
 * Push settings into the live config. `only` limits the write to those leaves (startup: file-sourced
 * leaves so code overrides and env-built values survive; runtime: the leaves that just changed).
 */
export function applySettingsToConfig(config: EngineConfig, s: Settings, only?: Set<string>): void {
  const on = (p: string) => !only || only.has(p);
  if (on('engine.port')) config.port = s.engine.port;
  if (on('engine.host')) config.host = s.engine.host;
  if (on('engine.maxConcurrent')) config.maxConcurrent = s.engine.maxConcurrent;
  if (on('engine.claudeBin')) config.claudeBin = s.engine.claudeBin ?? undefined;
  if (on('engine.claudeHome') && s.engine.claudeHome) config.claudeHome = s.engine.claudeHome;
  if (on('engine.workspacesRoot')) config.workspacesRoot = s.engine.workspacesRoot;
  if (on('preview.portFrom')) config.preview.portFrom = s.preview.portFrom;
  if (on('preview.portTo')) config.preview.portTo = s.preview.portTo;
  if (on('preview.idleMinutes')) config.preview.idleMinutes = s.preview.idleMinutes;
  if (on('checks.selfCheck')) config.selfCheck = s.checks.selfCheck;
  if (on('workflow.interview')) config.interview = s.workflow.interview;
  if (on('workflow.effort')) config.effort = s.workflow.effort;
  if (on('reviews.smallGoalLines')) config.smallGoalLines = s.reviews.smallGoalLines;
  if (on('models.cheap')) config.models.cheap = s.models.cheap;
  if (on('models.fallbacks')) config.modelFallbacks = s.models.fallbacks;
  if (on('models.presets')) config.modelPresets = s.models.presets;
  if (on('models.presetCode')) config.naturePreset.code = s.models.presetCode;
  if (on('models.presetDocs')) config.naturePreset.docs = s.models.presetDocs;
  if (on('models.presetMedia')) config.naturePreset.media = s.models.presetMedia;
  if (on('models.escalateLastAttempt')) config.escalateLastAttempt = s.models.escalateLastAttempt;
  if (on('sessions.attemptMaxTurns')) config.attemptMaxTurns = s.sessions.attemptMaxTurns;
  if (on('sessions.maxContinuations')) config.maxContinuations = s.sessions.maxContinuations;
  if (on('sessions.attemptMaxCostUsd')) config.attemptMaxCostUsd = s.sessions.attemptMaxCostUsd;
  if (on('sessions.attemptTimeoutMin')) config.attemptTimeoutMs = s.sessions.attemptTimeoutMin * 60_000;
  if (on('workflow.profile')) config.workflowProfile = s.workflow.profile;
  if (on('workflow.tdd')) config.workflowTdd = s.workflow.tdd;
  if (on('workflow.defaultMode')) config.defaultGoalMode = s.workflow.defaultMode;
  if (on('workflow.designPack')) config.designPack = s.workflow.designPack;
  if (on('workflow.defaultPace')) config.workflowPace = s.workflow.defaultPace;
  if (on('workflow.imagePack')) config.imagePack = s.workflow.imagePack;
  if (on('workflow.videoPack')) config.videoPack = s.workflow.videoPack;
  if (on('workflow.autoskills')) config.autoskills = s.workflow.autoskills;
  if (on('workflow.settingSources')) config.settingSources = s.workflow.settingSources ?? undefined;
  if (on('reviews.alwaysReviewTasks')) config.alwaysReviewTasks = s.reviews.alwaysReviewTasks;
  if (on('reviews.maxFixCycles')) config.maxFixCycles = s.reviews.maxFixCycles;
  if (on('delivery.defaultMode') || on('delivery.defaultUnit') || on('delivery.defaultRemote')) {
    config.defaultDelivery = { ...(config.defaultDelivery ?? {}) };
    if (on('delivery.defaultMode')) config.defaultDelivery.mode = s.delivery.defaultMode;
    if (on('delivery.defaultUnit')) config.defaultDelivery.unit = s.delivery.defaultUnit;
    if (on('delivery.defaultRemote')) config.defaultDelivery.remote = s.delivery.defaultRemote;
  }
  if (on('delivery.pollSec')) config.delivery.pollMs = s.delivery.pollSec * 1000;
  if (on('delivery.noChecksGraceSec')) config.delivery.noChecksGraceMs = s.delivery.noChecksGraceSec * 1000;
  if (on('delivery.checksTimeoutMin')) config.delivery.checksTimeoutMs = s.delivery.checksTimeoutMin * 60_000;
  if (on('delivery.automergeWaitMin')) config.delivery.automergeWaitMs = s.delivery.automergeWaitMin * 60_000;
  if (on('sync.fetchBeforeGoal')) config.sync.fetchBeforeGoal = s.sync.fetchBeforeGoal;
  if (on('sync.startFrom')) config.sync.startFrom = s.sync.startFrom;
  if (on('sync.refreshBetweenTasks')) config.sync.refreshBetweenTasks = s.sync.refreshBetweenTasks;
  if (on('tools.useGraphify')) config.useGraphify = s.tools.useGraphify;
  if (on('tools.markitdownBin')) config.markitdownBin = s.tools.markitdownBin ?? undefined;
  if (on('tools.openaiApiKey')) config.openaiApiKey = s.tools.openaiApiKey ?? undefined;
  if (on('tools.openaiBaseUrl')) config.openaiBaseUrl = s.tools.openaiBaseUrl ?? undefined;
  if (on('tools.kimiApiKey')) config.kimiApiKey = s.tools.kimiApiKey ?? undefined;
  if (on('tools.geminiApiKey')) config.geminiApiKey = s.tools.geminiApiKey ?? undefined;
  if (on('safety.extraBoundaryPatterns')) config.extraBoundaryPatterns = s.safety.extraBoundaryPatterns ?? undefined;
  if (on('safety.allowedRoots')) config.allowedRoots = s.safety.allowedRoots ?? undefined;
}
