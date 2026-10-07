import { CODEX_MODEL_ACTIONS, CodexEffort, Effort, effectiveCodexPresets, natureKey, type CodexModelPreset } from '@foundry/core';
import { CodexPlugins } from './plugins/codex-plugins.ts';
import { CodexQuotaReader } from './usage/codex-quota.ts';
import { discoverCodexModels } from './models/codex-discover.ts';
import { dirname, join } from 'node:path';
import type { Attachment, Brief, BudgetPreset, DocType, Escalation, EscalationAnswer, EscalationSuggestion, Goal, GoalMode, GoalNature, GoalWorkflow, ModelConfig, Task, Check } from '@foundry/core';
import {
  BUDGET_PRESETS,
  Budgets,
  DeliveryPolicy,
  IDLE_DELIVERY,
  proposeBudgetFromEstimate,
  renderDecisions,
  IDLE_COMPLETION,
  MEDIA_NATURES,
  EventStore,
  IdPrefix,
  getAttempt,
  getBrief,
  getGoal,
  getTask,
  listAttempts,
  listAttemptsEndedSince,
  listEscalations,
  listGoals,
  listRunningAttempts,
  listTasks,
  newId,
  openDatabase,
  topoSort,
  Brief as BriefSchema,
} from '@foundry/core';
import { ProviderRunner } from './provider-runner.ts';
import { CodexCliRunner, ClaudeCliRunner, type ClaudeRunner, type RunHandle } from '@foundry/runner';
import { McpManager } from './mcp/manager.ts';
import { CodexMcpManager } from './mcp/codex-manager.ts';
import { mmxConfigDir, mmxSignedIn, writeMmxConfig } from './mmx.ts';
import { fetchMinimaxQuota } from './usage/minimax.ts';
import type { MinimaxQuota } from './usage/types.ts';
import { answerInterview, continueInterview, runClarify } from './clarify.ts';
import { type DraftProposal, type DraftRequest, runDraft } from './brief-draft.ts';
import { runSuggest } from './escalation-suggest.ts';
import { claudeConfigEnv, type EngineConfig } from './config.ts';
import { GrepContextProvider } from './context/grep-provider.ts';
import { GraphifyContextProvider } from './context/graphify-provider.ts';
import { summarizeOutput } from './distill/summarize.ts';
import type { ContextProvider } from './context/provider.ts';
import { answerEscalation as answerEsc, raiseEscalation } from './escalation.ts';
import { branchExists, currentBranch, git, isGitRepo, exec } from './git/git.ts';
import { fetchBase, startRef } from './git/sync.ts';
import { mergeBranchInto } from './merge.ts';
import { runGoalReview } from './goal-review.ts';
import { Roles } from './roles.ts';
import { schedule } from './scheduler.ts';
import { SkillsManager } from './skills/manager.ts';
import { UpdateManager } from './update/updater.ts';
import { AgentsMonitor, type FoundryLiveSession } from './agents/monitor.ts';
import { ClaudeAuth } from './auth/claude-auth.ts';
import { CliGh, type GhClient } from './delivery/gh.ts';
import { probeForPlan, runDelivery } from './delivery/pipeline.ts';
import { planDelivery } from './delivery/policy.ts';
import { usageSummary, type UsageSummary } from './usage/ledger.ts';
import type { RunResult } from '@foundry/runner';
import type { StreamEvent, StreamListener } from './types.ts';
import { defaultWorkspaceDir, deliveryWorkspacePath, dropTaskWorkspace, ensureGoalWorkspace, goalWorkspacePath, internalWorkspaceDir, listStackBranches, previewWorkspacePath } from './workspace.ts';
import { relocateLegacyWorkspaces } from './workspace-migrate.ts';
import { PreviewManager } from './preview/manager.ts';
import { ensureSelfCheck, playwrightInstallCommand, playwrightStatus, runSelfCheck } from './checks/selfcheck.ts';
import { afterMerge, type AfterMergeOptions } from './delivery/after-merge.ts';
import { startOver, structuralChanges } from './delivery/start-over.ts';
import { runDocsGeneration } from './docs-generate.ts';
import { checkGoalPrs, checkOpenPrs, markDelivered, recheckPr } from './delivery/pr-watch.ts';
import { attachmentDir, claimStaged, conversionTmpPath, markdownFileName, sweepStaging, trashAttachment } from './attachments.ts';
import { Markitdown } from './convert/markitdown.ts';
import { SettingsError, SettingsStore, applySettingsToConfig } from './settings.ts';
import { NotificationDispatcher } from './notify/dispatcher.ts';
import { ModelFallbackRunner } from './models/fallback-runner.ts';
import { modelsInBinary } from './models/discover.ts';
import { EffortRunner } from './effort-runner.ts';
import { ModelRegistry, SEED_MODELS, isPinnedId, type ModelRecord } from './models/registry.ts';
import { copyProjectSkills, hasStackManifest, runAutoskills, type AutoskillsDeps } from './skills/autoskills.ts';
import { deliverArtifacts, inferCompletion, runGraphRefresh, shouldRunGraphRefresh, type GraphRefreshDeps } from './completion.ts';
import type { SettingsPatch, SettingsView } from '@foundry/core';
import { ACTION_INFO, BUILTIN_PRESETS, DEFAULT_NATURE_PRESETS, MODEL_ACTIONS, MODEL_NATURES, NATURE_LABEL, effectivePresets } from '@foundry/core';
import { spawnStreaming } from './skills/updaters.ts';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { removeWorktree } from './git/git.ts';
import { BaselineChecks } from './checks/baseline.ts';
import { relative, resolve } from 'node:path';
import { adoptLocalBin, AGENT_CLI_IDS, agentCliInstall, type AgentCliId } from './agent-cli.ts';
import { type FollowUpDraft, type FollowUpInput, followUpDraft, linkFollowUp, prepareFollowUp } from './follow-up.ts';

export interface CreateGoalInput {
  provider?: 'claude' | 'codex';
  codexModel?: string;
  title?: string;
  prompt: string;
  repoPath: string;
  baseBranch?: string;
  budgets?: Partial<Budgets>;
  /** Preset the budgets were derived from (default custom). `auto` = Brief proposes the budget. */
  budgetPreset?: BudgetPreset;
  models?: Partial<ModelConfig>;
  /** run the headless self-check on the preview after each integration; default = Settings → checks.selfCheck */
  selfCheck?: boolean;
  /** interview the human in rounds before the Brief; default = Settings → workflow.interview */
  interview?: 'auto' | 'always' | 'never';
  /** effort level for every session of this goal; default = Settings → workflow.effort */
  effort?: CodexEffort | null;
  /** model preset for this goal; default = the preset Settings picks for its nature */
  modelPreset?: string | null;
  /** Skip Clarify: one task = the prompt, with these command checks. */
  autoBrief?: { mustChecks: string[]; stretchChecks?: string[] };
  /** Skip Clarify with a fully specified brief (tasks + checks). Approved immediately. */
  brief?: Omit<Brief, 'goalId'>;
  /** What the engine may do with the goal branch once done (default: nothing leaves the machine). */
  delivery?: Partial<DeliveryPolicy>;
  /** Staged uploads (from POST /api/uploads) and links; files are moved under the goal on creation. */
  attachments?: Attachment[];
  /** simple = plain-language Brief and progress; default from Settings */
  mode?: GoalMode;
  /** engineering discipline; Simple mode defaults tdd to `preferred`, Expert to the Settings default */
  workflow?: Partial<GoalWorkflow>;
  /** what the goal produces; auto (default) = the Clarifier decides. Non-code goals open in Simple mode unless mode says otherwise. */
  nature?: GoalNature;
  /** where media artifacts are copied at done; null = they stay in the goal workspace */
  outputDir?: string | null;
  /** create the goal as a Follow-up of an earlier finished goal of the same repository (see follow-up.ts) */
  follows?: FollowUpInput;
}

interface InFlight {
  goalId: string;
  attemptId: string | null;
  handle: RunHandle | null;
}

export class Engine {
  readonly store: EventStore;
  readonly runner: ClaudeRunner;
  readonly roles: Roles;
  readonly skills: SkillsManager;
  readonly mcp: McpManager;
  readonly codexMcp: CodexMcpManager;
  readonly codexQuota: CodexQuotaReader;
  readonly codexPlugins: CodexPlugins;
  readonly agents: AgentsMonitor;
  readonly auth: ClaudeAuth;
  readonly accounts: Record<'claude' | 'codex', ClaudeAuth>;
  private providerSkills: Record<'claude' | 'codex', SkillsManager>;
  readonly gh: GhClient;
  context: ContextProvider;
  private delivering = new Map<string, AbortController>();
  /** escalation id → the analysis running for it */
  private suggesting = new Map<string, Promise<EscalationSuggestion>>();
  /** post-completion graph refreshes in progress, per goal */
  private completing = new Set<string>();
  /** artifact deliveries in progress, per goal */
  private deliveringArtifacts = new Set<string>();

  private streamListeners = new Set<StreamListener>();
  private escalationListeners = new Set<(e: Escalation) => void>();
  private inFlight = new Map<string, InFlight>();
  private chains = new Map<string, Promise<void>>();
  private pendingTick = new Set<string>();
  readonly clarifying = new Set<string>();
  /** tasks already noted as waiting for an overlapping task (one note each, not one per tick) */
  readonly overlapNoted = new Set<string>();
  /** consecutive engine-side crashes per task (reset when an attempt runs) */
  readonly engineCrashes = new Map<string, number>();
  /** must checks already failing on a goal-branch commit (merges are judged on regressions only) */
  readonly baseline = new BaselineChecks(this);
  private reviewing = new Set<string>();
  private ownedSessionIds = new Set<string>();
  private rateLimitedUntil = new Map<'claude' | 'codex', number>();
  private resumeTimers = new Map<'claude' | 'codex', ReturnType<typeof setTimeout>>();

  readonly settings: SettingsStore;
  /** pushes escalations / goal endings / delivery results / usage pauses to Telegram & Discord (Settings → Notifications) */
  readonly notifications: NotificationDispatcher;
  /** version self-knowledge, the daily update check, and the self-update pipeline (ADR-0010) */
  readonly updater: UpdateManager;
  /** dev servers started in progress folders (Goal page, milestones, integrations) */
  readonly preview: PreviewManager;
  /** self-update drain: no new sessions start; in-flight work finishes (mirror of the rate-limit gate) */
  private updateDraining = false;
  private minimax: { quota: MinimaxQuota; at: number } | null = null;
  private minimaxRun: Promise<MinimaxQuota> | null = null;
  /** Foundry's mmx config holds the current key: only then are sessions pointed at it */
  private mmxReady = false;
  /** what this machine has learned about model names (requested → resolved id, last ok/fail) */
  readonly models: ModelRegistry;
  readonly providerModels: Record<'claude' | 'codex', ModelRegistry>;
  /** autoskills runs in progress, per goal (tasks wait for them before their first attempt) */
  private autoskillsRuns = new Map<string, Promise<void>>();
  /** test seam: deps handed to runAutoskills (fake npx / node version) */
  autoskillsDeps: AutoskillsDeps = {};
  /** test seam: deps handed to runGraphRefresh (fake which/exec) */
  graphRefreshDeps: GraphRefreshDeps = {};

  constructor(
    public readonly config: EngineConfig,
    runner?: ClaudeRunner | Record<'claude' | 'codex', ClaudeRunner>,
    gh?: GhClient,
  ) {
    // settings file > env > defaults: only file-sourced leaves override the env-built config (code overrides stay)
    this.settings = new SettingsStore(config.dataDir, process.env, config.log);
    applySettingsToConfig(config, this.settings.values(), this.settings.fileLeaves());
    const providerFile = join(config.dataDir, 'provider');
    const previousProvider = existsSync(providerFile) ? readFileSync(providerFile, 'utf8').trim() : existsSync(join(config.dataDir, 'engine.db')) ? 'claude' : config.provider;
    if (previousProvider !== config.provider) throw new Error(`This data directory belongs to ${previousProvider}. Set FOUNDRY_DATA_DIR to a separate directory for ${config.provider}; session IDs cannot be migrated between backends.`);
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(providerFile, config.provider);
    this.mmxReady = writeMmxConfig(config.dataDir, this.minimaxKey(), config.log);
    this.gh = gh ?? new CliGh({ onCommand: (cmd, cwd, r, ms) => config.log(`[gh] ${cmd.slice(0, 4).join(' ')} → ${r.code} (${ms}ms) ${cwd}`) });
    this.store = new EventStore(openDatabase(join(config.dataDir, 'engine.db')));
    for (const row of this.store.db.query("SELECT DISTINCT json_extract(payload, '$.sessionId') AS id FROM events WHERE type = 'session.usage'").all() as { id: string | null }[]) {
      if (row.id) this.ownedSessionIds.add(row.id);
    }
    // Freeze the owner of old goals before either backend may create new work in this store.
    for (const goal of listGoals(this.store.db)) if (!goal.provider) this.store.append({ type: 'goal.provider_assigned', goalId: goal.id, payload: { provider: config.provider } });
    this.providerModels = {
      claude: new ModelRegistry(config.provider === 'claude' ? config.dataDir : join(config.dataDir, 'providers', 'claude'), 'claude'),
      codex: new ModelRegistry(config.provider === 'codex' ? config.dataDir : join(config.dataDir, 'providers', 'codex'), 'codex'),
    };
    this.models = this.providerModels[config.provider];
    const env = () => ({ ...claudeConfigEnv(config.claudeHome), FOUNDRY_CALLBACK: `http://${config.host}:${config.port}`, ...this.sessionEnvExtra() });
    const supplied = (provider: 'claude' | 'codex') => runner && ('run' in runner ? runner : runner[provider]);
    const wrap = (inner: ClaudeRunner, provider: 'claude' | 'codex') => {
      const checked: ClaudeRunner & { killAll: () => number } = {
        active: () => inner.active(),
        setMaxConcurrent: (n) => inner.setMaxConcurrent?.(n),
        killAll: () => (inner as { killAll?: () => number }).killAll?.() ?? 0,
        run: async (spec) => {
          if (provider === 'codex') this.validateCodexChoice(spec.model, spec.effort);
          return inner.run(spec);
        },
      };
      const fallback = new ModelFallbackRunner(checked, {
        fallbacks: (spec) => provider === 'codex' ? (spec.meta?.goalId ? this.mustGoal(spec.meta.goalId).codexFallbacks ?? [] : config.codexFallbacks) : config.modelFallbacks,
        registry: this.providerModels[provider],
        log: config.log,
        onFallback: ({ spec, from, to, reason }) => {
          const goalId = spec.meta?.goalId ?? null;
          this.store.append({ type: 'goal.models_changed', goalId, payload: { tier: null, from, to, reason } });
        },
      });
      return new EffortRunner(fallback, () => this.store.db, () => provider === 'codex' ? null : this.config.effort);
    };
    this.runner = new ProviderRunner({
      claude: wrap(supplied('claude') ?? new ClaudeCliRunner({ claudeBin: config.claudeBin, maxConcurrent: config.maxConcurrent, env, log: config.log }), 'claude'),
      codex: wrap(supplied('codex') ?? new CodexCliRunner({ codexBin: config.codexBin, codexHome: config.codexHome, maxConcurrent: config.maxConcurrent, env, log: config.log }), 'codex'),
    }, (spec) => {
      if (spec.meta?.goalId) return this.mustGoal(spec.meta.goalId).provider ?? config.provider;
      return spec.meta?.provider === 'claude' || spec.meta?.provider === 'codex' ? spec.meta.provider : config.provider;
    }, config.maxConcurrent);
    this.roles = new Roles(config.rolesDir);
    const makeSkills = (provider: 'claude' | 'codex') => new SkillsManager({
      provider, codexBin: config.codexBin, codexHome: config.codexHome,
      claudeHome: provider === 'codex' ? config.codexHome : config.claudeHome,
      claudeSkillsDir: provider === 'codex' ? join(config.claudeHome, 'skills') : undefined,
      dataDir: provider === config.provider ? config.dataDir : join(config.dataDir, 'providers', provider),
      catalogPath: config.catalogPath,
      claudeBin: config.claudeBin,
      log: config.log,
      // user skills only load when user settings are in scope
      hintsEnabled: () => provider === 'codex' || !config.settingSources || config.settingSources.includes('user'),
      workflowProfile: () => config.workflowProfile ?? 'mattpocock',
      packs: () => ({ design: config.designPack, image: config.imagePack, video: config.videoPack }),
      // mmx signed in with `mmx auth login` needs no key from Foundry
      // `||`, not `??`: an empty variable in the engine's environment must not hide a key from Settings
      envProbe: (name) => !!(process.env[name] || this.sessionEnvExtra()[name]) || (name === 'MINIMAX_API_KEY' && mmxSignedIn()),
      // every updater run is an audit event (goalId null, informational)
      onRun: (run) => this.store.append({ type: 'skills.update_run', goalId: null, payload: { provider, sourceId: run.sourceId, updater: run.updater, command: run.command, cwd: run.cwd, exitCode: run.exitCode, durationMs: run.durationMs, outputTail: run.outputTail, changed: run.changed, error: run.error } }),
    });
    this.providerSkills = { claude: makeSkills('claude'), codex: makeSkills('codex') };
    this.skills = this.providerSkills[config.provider];
    this.mcp = new McpManager({
      claudeHome: config.claudeHome,
      catalogPath: join(dirname(config.catalogPath), 'mcp.json'),
      claudeBin: config.claudeBin,
      allowed: () => this.config.mcpAllowed,
      setAllowed: (mcpAllowed) => void this.updateSettings({ workflow: { mcpAllowed } }),
      log: config.log,
    });
    this.codexMcp = new CodexMcpManager({
      codexHome: config.codexHome, codexBin: config.codexBin,
      catalogPath: join(dirname(config.catalogPath), 'mcp.json'),
      allowed: () => this.config.codexMcpAllowed,
      setAllowed: (codexMcpAllowed) => void this.updateSettings({ workflow: { codexMcpAllowed } }),
      log: config.log,
    });
    this.codexPlugins = new CodexPlugins({ codexHome: config.codexHome, codexBin: config.codexBin });
    this.codexQuota = new CodexQuotaReader({ bin: () => config.codexBin ?? Bun.which('codex'), home: config.codexHome });
    this.accounts = {
      claude: new ClaudeAuth({ provider: 'claude', claudeHome: config.claudeHome, claudeBin: () => config.claudeBin ?? Bun.which('claude'), log: config.log }),
      codex: new ClaudeAuth({ provider: 'codex', claudeBin: () => config.codexBin ?? Bun.which('codex'), codexHome: config.codexHome, log: config.log }),
    };
    this.accounts.codex.onLoginUpdate(() => { this.codexQuota.invalidate(); this.codexPlugins.invalidate(); });
    this.auth = this.accounts[config.provider];
    this.agents = new AgentsMonitor(
      { claudeHome: config.claudeHome, codexHome: config.codexHome, codexBin: config.codexBin, includeExternal: true, dataDir: config.dataDir, workspaceRoots: () => [...new Set(listGoals(this.store.db).flatMap((g) => (g.workspaceDir ? [dirname(g.workspaceDir)] : [])))] },
      {
        foundryLive: () => this.foundryLiveSessions(),
        foundryRecent: (sinceIso) => listAttemptsEndedSince(this.store.db, sinceIso),
        goalTitle: (goalId) => getGoal(this.store.db, goalId)?.title ?? null,
        taskTitle: (taskId) => getTask(this.store.db, taskId)?.title ?? null,
        goalProvider: (goalId) => getGoal(this.store.db, goalId)?.provider ?? config.provider,
        foundrySessionIds: () => this.ownedSessionIds,
      },
    );
    this.markitdown = new Markitdown({ bin: config.markitdownBin, log: config.log });
    this.context = this.buildContext();
    config.log(`[engine] context provider: ${this.context.name}`);
    this.store.subscribe((e) => {
      if (e.type === 'session.usage' && e.payload.sessionId) this.ownedSessionIds.add(e.payload.sessionId);
      if (e.goalId) this.tick(e.goalId);
    });
    this.notifications = new NotificationDispatcher(this);
    this.notifications.attach();
    this.updater = new UpdateManager(this);
    this.preview = new PreviewManager(this);
  }

  // ---------- self-update drain ----------

  beginUpdateDrain(): void {
    this.updateDraining = true;
  }
  endUpdateDrain(): void {
    if (!this.updateDraining) return;
    this.updateDraining = false;
    for (const g of listGoals(this.store.db)) this.tick(g.id);
  }
  isUpdateDraining(): boolean {
    return this.updateDraining;
  }

  /** env vars the engine adds to every session on top of its own process.env (settings-sourced secrets) */
  sessionEnvExtra(): Record<string, string> {
    return {
      ...(this.config.openaiApiKey ? { OPENAI_API_KEY: this.config.openaiApiKey } : {}),
      ...(this.config.openaiBaseUrl ? { OPENAI_BASE_URL: this.config.openaiBaseUrl } : {}),
      ...(this.config.kimiApiKey ? { MOONSHOT_API_KEY: this.config.kimiApiKey, KIMI_API_KEY: this.config.kimiApiKey } : {}),
      ...(this.config.geminiApiKey ? { GEMINI_API_KEY: this.config.geminiApiKey } : {}),
      // mmx only reads a config file when a session runs it: point it at the one writeMmxConfig keeps
      ...(this.minimaxKey() ? { MINIMAX_API_KEY: this.minimaxKey()!, ...(this.mmxReady ? { MMX_CONFIG_DIR: mmxConfigDir(this.config.dataDir) } : {}) } : {}),
      ...(this.config.elevenlabsApiKey ? { ELEVENLABS_API_KEY: this.config.elevenlabsApiKey } : {}),
      ...(this.config.groqApiKey ? { GROQ_API_KEY: this.config.groqApiKey } : {}),
    };
  }

  /** the MiniMax key sessions get: Settings first, else the engine's own environment; undefined = mmx uses the user's ~/.mmx login */
  private minimaxKey(): string | undefined {
    return this.config.minimaxApiKey || process.env.MINIMAX_API_KEY || undefined;
  }

  /** can media sessions actually generate images here (key present in the env sessions inherit)? */
  imageGenAvailable(): boolean {
    return !!(process.env.OPENAI_API_KEY || this.config.openaiApiKey || process.env.GEMINI_API_KEY || this.config.geminiApiKey);
  }

  private buildContext(): ContextProvider {
    const grep = new GrepContextProvider();
    return this.config.useGraphify && Bun.which('graphify') ? new GraphifyContextProvider(grep, { log: this.config.log }) : grep;
  }

  // ---------- settings ----------

  settingsView(): SettingsView {
    return this.settings.view();
  }
  /** Validate, persist and hot-apply a settings patch; restart-only keys are persisted and reported. */
  updateSettings(patch: SettingsPatch): SettingsView {
    if (patch.engine?.provider && patch.engine.provider !== this.config.provider) throw new Error('The installation default is fixed at launch. Choose Claude or Codex when creating a goal; existing goals keep their backend.');
    if (patch.models) {
      const models = { ...this.settings.values().models, ...patch.models };
      const presets = effectiveCodexPresets(models.codexPresets);
      for (const id of [models.codexPresetCode, models.codexPresetDocs, models.codexPresetMedia]) {
        if (!presets[id]) throw new SettingsError(`Unknown Codex preset: ${id}`);
      }
    }
    const { changed, view } = this.settings.update(patch);
    this.applySettingsChange(changed);
    return view;
  }
  resetSettings(path?: string): SettingsView {
    const { changed } = this.settings.reset(path);
    const models = this.settings.values().models;
    const presets = effectiveCodexPresets(models.codexPresets);
    const repair: NonNullable<SettingsPatch['models']> = {};
    if (!presets[models.codexPresetCode]) repair.codexPresetCode = DEFAULT_NATURE_PRESETS.code;
    if (!presets[models.codexPresetDocs]) repair.codexPresetDocs = DEFAULT_NATURE_PRESETS.docs;
    if (!presets[models.codexPresetMedia]) repair.codexPresetMedia = DEFAULT_NATURE_PRESETS.media;
    if (Object.keys(repair).length) changed.push(...this.settings.update({ models: repair }).changed);
    this.applySettingsChange([...new Set(changed)]);
    return this.settings.view();
  }
  private applySettingsChange(changed: string[]): void {
    if (!changed.length) return;
    const modelsBefore = { ...this.config.models };
    applySettingsToConfig(this.config, this.settings.values(), new Set(changed.filter((key) => !['engine.provider', 'engine.codexBin', 'engine.codexHome'].includes(key))));
    if (changed.some((k) => k.startsWith('models.'))) this.propagateModels(modelsBefore);
    if (changed.includes('engine.maxConcurrent')) this.runner.setMaxConcurrent?.(this.config.maxConcurrent);
    if (changed.includes('tools.useGraphify')) {
      this.context = this.buildContext();
      this.config.log(`[engine] context provider: ${this.context.name}`);
    }
    if (changed.includes('tools.markitdownBin')) this.markitdown = new Markitdown({ bin: this.config.markitdownBin, log: this.config.log });
    if (changed.some((k) => k.startsWith('workflow.'))) Object.values(this.providerSkills).forEach((skills) => skills.hints.invalidate());
    if (changed.includes('tools.minimaxApiKey')) {
      this.mmxReady = writeMmxConfig(this.config.dataDir, this.minimaxKey(), this.config.log);
      // the quota belongs to the old key
      this.minimax = null;
    }
    // keys feed the skills env probe ("key missing" warnings) — refresh the cached statuses right away
    if (changed.some((k) => /^tools\.\w+(ApiKey|BaseUrl)$/.test(k))) Object.values(this.providerSkills).forEach((skills) => skills.hints.invalidate());
    const restartNeeded = this.settings.restartNeeded();
    this.store.append({ type: 'settings.changed', goalId: null, payload: { keys: changed, restartNeeded } });
    this.config.log(`[settings] changed ${changed.join(', ')}${restartNeeded.length ? ` (restart needed for ${restartNeeded.join(', ')})` : ''}`);
  }

  /**
   * A model change in Settings reaches the goals still in flight: every tier that still carried the old default moves to the
   * new one (a per-goal override — a value that never matched the default — stays). Goals snapshot models at creation, so
   * without this a goal started minutes before the change would run on the old model until it finished.
   */
  private propagateModels(before: ModelConfig): void {
    for (const goal of listGoals(this.store.db)) {
      if (goal.provider === 'codex') continue;
      if (['done', 'over_delivered', 'failed', 'cancelled'].includes(goal.state)) continue;
      for (const tier of ['strong', 'worker', 'cheap'] as const) {
        const to = this.config.models[tier];
        if (goal.models[tier] === to || goal.models[tier] !== before[tier]) continue;
        this.store.append({ type: 'goal.models_changed', goalId: goal.id, payload: { tier, from: before[tier], to, reason: 'settings changed' } });
      }
    }
  }

  /** the human answered the open interview round (finish = write the Brief with what there is); the session continues in the background */
  answerInterview(goalId: string, answers: Record<string, string>, finish = false): void {
    answerInterview(this, this.mustGoal(goalId), answers, finish);
  }

  /** switch a goal's headless self-check; turning it on creates its goal-level must check right away */
  setSelfCheck(goalId: string, on: boolean): void {
    const goal = this.mustGoal(goalId);
    if (goal.selfCheck === on) return;
    this.store.append({ type: 'goal.selfcheck_set', goalId, payload: { on } });
    // before approval only the choice is recorded: approving the Brief creates the check with the others
    if (on && !['draft', 'clarifying', 'awaiting_brief_approval'].includes(goal.state)) ensureSelfCheck(this, getGoal(this.store.db, goalId)!);
  }

  /** after a task landed on the goal branch: the self-check looks at the preview when the goal asked for one */
  async afterIntegration(goal: Goal, task: Task): Promise<void> {
    if (!goal.selfCheck) return;
    await runSelfCheck(this, goal, { taskId: task.id }).catch((err) => this.config.log(`[selfcheck] ${goal.id}: ${String((err as Error).message ?? err)}`));
  }

  // ---------- base branch sync ----------

  /**
   * The goal worktree, created from the right tip: the base branch is fetched first (remote-tracking refs only,
   * the user's checkout is untouched) and, when the local base is behind, the goal branch starts from
   * `<remote>/<base>`. Records `goal.base_synced` once; later calls just return the existing worktree.
   */
  async ensureSyncedWorkspace(goal: Goal): Promise<string> {
    const path = goalWorkspacePath(this.config.dataDir, goal);
    if (goal.baseSync || existsSync(path) || (await branchExists(goal.branch, goal.repoPath).catch(() => false))) return ensureGoalWorkspace(this.config.dataDir, goal);
    const s = await fetchBase(goal.repoPath, goal.baseBranch, { fetch: this.config.sync.fetchBeforeGoal });
    let start: { ref: string; from: 'local' | 'remote' | 'previous'; reason: string } = startRef(s, this.config.sync.startFrom);
    // a Follow-up whose previous goal's work is not on the base yet starts from that goal's branch
    const f = goal.follows;
    if (f?.via === 'created' && f.startFrom === 'previous' && f.branch) {
      if (await branchExists(f.branch, goal.repoPath).catch(() => false)) start = { ref: f.branch, from: 'previous', reason: `follows "${f.title}": starts from its goal branch ${f.branch}, whose work is not on ${goal.baseBranch} yet` };
      else start = { ...start, reason: `follows "${f.title}", but its goal branch ${f.branch} no longer exists; ${start.reason}` };
    }
    const ws = await ensureGoalWorkspace(this.config.dataDir, goal, { startRef: start.ref });
    const detail = `${start.reason}${s.error ? ` (${s.error})` : ''}`;
    this.store.append({ type: 'goal.base_synced', goalId: goal.id, payload: { remote: s.remote, base: s.base, localRef: s.localRef, remoteRef: s.remoteRef, ahead: s.ahead, behind: s.behind, fetched: s.fetched, startedFrom: start.from, detail } });
    if (start.from !== 'local' || s.error) this.config.log(`[sync] ${goal.id}: goal branch starts from ${start.ref} — ${detail}`);
    return ws;
  }

  /**
   * Run Clarify again while the Brief is still waiting for approval: the goal worktree and branch are thrown away
   * (nothing has been committed to them yet), the base is fetched again and the Clarifier explores the fresh tip.
   * The new Brief replaces the old one; attachments, budget and delivery policy stay.
   */
  async reclarify(goalId: string, reason = 'requested by user'): Promise<void> {
    const goal = this.mustGoal(goalId);
    if (goal.state !== 'awaiting_brief_approval') throw new Error(`goal is ${goal.state}; Clarify can only be re-run while the Brief awaits approval`);
    if (listTasks(this.store.db, goalId).length) throw new Error('tasks already exist for this goal; restart the goal instead');
    const ws = goalWorkspacePath(this.config.dataDir, goal);
    let rebuilt = false;
    if (await isGitRepo(goal.repoPath).catch(() => false)) {
      // safe to discard: no task has run, so the branch holds nothing of the goal's own
      if (existsSync(ws)) await removeWorktree(goal.repoPath, ws, { deleteBranch: goal.branch }).catch(() => {});
      else if (await branchExists(goal.branch, goal.repoPath).catch(() => false)) await git(['branch', '-D', goal.branch], goal.repoPath);
      rebuilt = true;
    }
    // the Brief is discarded, the human's Decisions are not: the new Clarify receives them and must not ask again
    const prior = getBrief(this.store.db, goalId)?.brief;
    const decisions = prior ? renderDecisions(prior, '# Decisions already made by the human') : '';
    this.store.append({ type: 'goal.reclarified', goalId, payload: { reason, workspaceRebuilt: rebuilt, decisions } });
    this.store.append({ type: 'goal.state_changed', goalId, payload: { from: 'awaiting_brief_approval', to: 'clarifying', reason: `re-run clarify: ${reason}` } });
  }

  /** Between tasks (nothing running): fetch again and merge a moved base into the goal branch. Off unless `sync.refreshBetweenTasks`. */
  async refreshBase(goal: Goal): Promise<void> {
    if (!this.config.sync.refreshBetweenTasks) return;
    const s = await fetchBase(goal.repoPath, goal.baseBranch);
    if (!s.remote || !s.remoteRef) return;
    const ws = goalWorkspacePath(this.config.dataDir, goal);
    const ref = `${s.remote}/${s.base}`;
    if ((await git(['merge-base', '--is-ancestor', ref, 'HEAD'], ws)).code === 0) return;
    const now = new Date().toISOString();
    const task: Task = { id: newId(IdPrefix.task), goalId: goal.id, title: `sync ${goal.branch} with ${ref}`, spec: `${ref} moved while this goal was running. Merge it into ${goal.branch} so the remaining tasks build on the current base.`, kind: 'chore', scope: 'sync', scenario: 'general', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: false, retryBudget: 2, origin: 'merge', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard' as const, state: 'merging', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, createdAt: now, updatedAt: now };
    this.store.append({ type: 'task.created', goalId: goal.id, payload: { task } });
    const ok = await mergeBranchInto(this, goal, task, { ref, label: ref, intent: `The base branch ${ref} received new commits while this goal was running. Keep their changes AND this goal's changes.` });
    const fresh = getTask(this.store.db, task.id)!;
    if (ok && fresh.state === 'merging') this.store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'merging', to: 'done', reason: 'base merged between tasks' } });
  }

  // ---------- autoskills ----------

  /**
   * Kick off the per-goal autoskills run (idempotent per goal); the scheduler awaits it before the first attempt.
   * A run recorded as skipped for lack of a stack manifest (empty repository) may run again once a task created
   * one — `retryAutoskillsAfterTask` calls back in after every task lands.
   */
  startAutoskills(goal: Goal, ws: string): void {
    if (!this.config.autoskills || this.autoskillsRuns.has(goal.id)) return;
    if (goal.autoskills && !(goal.autoskills.status === 'skipped' && goal.autoskills.detail.startsWith('no stack manifest') && hasStackManifest(ws))) return;
    const channel = `autoskills-${goal.id}`;
    const record = (payload: { status: 'installed' | 'skipped' | 'failed'; skills: string[]; detail: string }) => {
      try {
        this.store.append({ type: 'goal.autoskills', goalId: goal.id, payload });
      } catch (err) {
        this.config.log(`[autoskills] ${goal.id}: could not record result: ${String(err)}`);
      }
    };
    const run = (async () => {
      const onLine = (text: string) => this.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: { kind: 'text', text }, ts: new Date().toISOString() });
      const r = await runAutoskills(ws, { log: this.config.log, ...this.autoskillsDeps, provider: goal.provider ?? this.config.provider }, onLine);
      record(r);
      this.config.log(`[autoskills] ${goal.id}: ${r.status} — ${r.detail}`);
    })().catch((err) => record({ status: 'failed', skills: [], detail: String((err as Error).message ?? err) }));
    this.autoskillsRuns.set(goal.id, run);
    void run.finally(() => this.autoskillsRuns.delete(goal.id));
  }
  /** Resolve once the goal's autoskills run is over (or after `timeoutMs`), immediately when none is running. */
  async awaitAutoskills(goalId: string, timeoutMs = 3 * 60_000): Promise<void> {
    const run = this.autoskillsRuns.get(goalId);
    if (!run) return;
    await Promise.race([run, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
  }
  /**
   * Empty-repository goals: autoskills was skipped for lack of a stack manifest. After every task lands,
   * check whether one exists now and run autoskills then, copying the skills into live task worktrees.
   */
  retryAutoskillsAfterTask(goalId: string): void {
    const goal = getGoal(this.store.db, goalId);
    if (!goal || !goal.autoskills || goal.autoskills.status !== 'skipped' || !goal.autoskills.detail.startsWith('no stack manifest')) return;
    const ws = goalWorkspacePath(this.config.dataDir, goal);
    if (!hasStackManifest(ws)) return;
    this.startAutoskills(goal, ws);
    void this.awaitAutoskills(goalId).then(() => {
      const fresh = getGoal(this.store.db, goalId);
      if (fresh?.autoskills?.status !== 'installed') return;
      for (const t of listTasks(this.store.db, goalId)) {
        if (t.worktreePath && existsSync(t.worktreePath)) {
          try {
            copyProjectSkills(ws, t.worktreePath, goal.provider ?? this.config.provider);
          } catch {}
        }
      }
    });
  }

  // ---------- lifecycle ----------

  async start(): Promise<void> {
    try {
      const swept = sweepStaging(this.config.dataDir);
      if (swept) this.config.log(`[attachments] removed ${swept} expired staged upload(s)`);
    } catch {}
    await this.reconcile();
    await relocateLegacyWorkspaces(this);
    this.migrateModelTiersToPresets();
    void this.syncModelsIfCliChanged();
    this.preview.startSweeper();
    // pull requests merged or closed on GitHub after their delivery finished (ADR-0015)
    this.prWatchTimer = setInterval(() => {
      if (!this.stopped) void checkOpenPrs(this);
    }, this.config.delivery.prWatchMs);
    this.prWatchTimer.unref?.();
    void checkOpenPrs(this);
    for (const g of listGoals(this.store.db)) this.tick(g.id);
  }

  private prWatchTimer: ReturnType<typeof setInterval> | null = null;
  private deliveryRefreshAt = new Map<string, number>();

  /**
   * The goal page asks for fresh delivery facts: a PR merged or closed on GitHub since, or a base branch the human
   * pulled by hand (then the after-merge steps can finish). At most once a minute per goal for the local part.
   */
  async refreshDelivery(goalId: string): Promise<void> {
    this.mustGoal(goalId);
    if (await checkGoalPrs(this, goalId)) return;
    const d = getGoal(this.store.db, goalId)!.delivery;
    if (d.outcome !== 'merged' || d.cleanup?.done) return;
    const last = this.deliveryRefreshAt.get(goalId) ?? 0;
    if (Date.now() - last < 60_000) return;
    this.deliveryRefreshAt.set(goalId, Date.now());
    await afterMerge(this, goalId);
  }

  /** "Retry delivery": run the delivery again from the first unmerged PR (merged ones are skipped, open ones reused) with a fresh fix-CI budget */
  async retryDelivery(goalId: string): Promise<Goal> {
    const g = this.mustGoal(goalId);
    if (g.delivery.policy.mode === 'local') throw new Error('this goal is delivered Local only — pick a delivery on the Delivery tab first');
    return this.deliver(goalId, {}, 'retry');
  }

  /** "Re-check" on one PR: read it on GitHub now; a passing PR of a stopped delivery carries on with the delivery */
  async recheckDeliveryPr(goalId: string, prNumber: number): Promise<void> {
    this.mustGoal(goalId);
    const state = await recheckPr(this, goalId, prNumber);
    const d = getGoal(this.store.db, goalId)!.delivery;
    if (d.status === 'failed' && (state === 'passing' || state === 'none')) await this.retryDelivery(goalId);
  }

  private rerunning = new Set<string>();

  /**
   * "Re-run" on the Completion card: the graph refresh again, or docs generation after a run that failed or wrote
   * nothing. Runs in the background; the card shows the new result. A new docs commit lands on the goal branch, so a
   * delivered goal ships it with Resume delivery.
   */
  rerunCompletion(goalId: string, what: 'docs' | 'graph'): void {
    const g = this.mustGoal(goalId);
    if (g.state !== 'done' && g.state !== 'over_delivered') throw new Error('completion actions run once the goal is done');
    const key = `${goalId}:${what}`;
    if (this.rerunning.has(key) || (what === 'graph' && this.completing.has(goalId))) throw new Error(`the ${what === 'docs' ? 'docs generation' : 'graph refresh'} is already running`);
    let job: Promise<void>;
    if (what === 'graph') {
      if (!g.completion.graphRefresh) throw new Error('this goal has no graph refresh');
      job = runGraphRefresh(this, g, this.graphRefreshDeps);
    } else {
      if (!g.completion.docs.length) throw new Error('this goal generates no docs');
      if (g.completion.docsRun?.status === 'ok') throw new Error('the docs were written and committed; edit them in the goal branch instead');
      if (g.delivery.status === 'running') throw new Error('a delivery is running — wait for it, or cancel it first');
      if (!existsSync(goalWorkspacePath(this.config.dataDir, g))) throw new Error('the goal folder was cleaned up after the merge, so there is nowhere to write the docs');
      job = runDocsGeneration(this, g, { rerun: true });
    }
    this.rerunning.add(key);
    void job
      .catch((err) => this.store.append({ type: 'engine.note', goalId, payload: { level: 'warn', message: `${what} re-run crashed: ${String(err)}` } }))
      .finally(() => this.rerunning.delete(key));
  }

  /** "Mark as delivered": the human handled the delivery; merged on GitHub → finished as merged, otherwise recorded as delivered by them */
  async markDelivered(goalId: string): Promise<void> {
    const g = this.mustGoal(goalId);
    if (g.delivery.status === 'running') throw new Error('delivery is running — cancel it first');
    await markDelivered(this, goalId);
  }

  /** "Pull into my checkout" / "Clean up anyway" on a merged goal */
  async finishAfterMerge(goalId: string, opts: AfterMergeOptions): Promise<void> {
    const g = this.mustGoal(goalId);
    if (g.delivery.outcome !== 'merged') throw new Error('this goal has not been merged');
    await afterMerge(this, goalId, opts);
  }

  /** set by stop(): no new ticks run, so nothing writes to the store after shutdown (tests delete it right after) */
  private stopped = false;
  private modelDiscoveryAbort = new AbortController();
  private modelDiscoveries = new Set<Promise<unknown>>();

  async stop(): Promise<void> {
    this.stopped = true;
    this.modelDiscoveryAbort.abort();
    this.updater.stopSchedule();
    if (this.prWatchTimer) clearInterval(this.prWatchTimer);
    for (const timer of this.resumeTimers.values()) clearTimeout(timer);
    this.resumeTimers.clear();
    for (const account of Object.values(this.accounts)) account.cancelLogin();
    this.mcp.login.cancel();
    this.codexQuota.invalidate();
    await Promise.all([this.codexMcp.stop(), this.codexPlugins.stop(), Promise.allSettled([...this.modelDiscoveries])]);
    this.agents.stop();
    this.preview.stopSweeper();
    await this.preview.stopAll('engine shutdown');
    for (const [, f] of this.inFlight) f.handle?.kill('killed_manual');
    // reviews, clarify, merges and probes are not in `inFlight`: kill every child the runner still owns
    const n = (this.runner as { killAll?: () => number }).killAll?.() ?? 0;
    if (n) this.config.log(`[engine] stopped ${n} agent session(s) on shutdown`);
    // drain what is already in flight (bounded): a tick writing to a database the caller is about to delete
    // was the source of cross-file test flakes
    const t0 = Date.now();
    while (this.busy().total > 0 && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 25));
    await Promise.allSettled([...this.chains.values()]);
  }

  private async reconcile(): Promise<void> {
    this.restoreRateLimitPause();
    for (const a of listRunningAttempts(this.store.db)) {
      if (a.pid && isAlive(a.pid)) {
        try {
          process.kill(a.pid, 'SIGTERM');
        } catch {}
      }
      // a work attempt whose session already started is resumed later (Continuation); anything else is just over
      const resumable = a.kind === 'work' && !!a.sessionId && a.continuations < this.config.maxContinuations;
      this.store.append({ type: 'attempt.finished', goalId: a.goalId, payload: { attemptId: a.id, state: resumable ? 'interrupted' : 'error', resultSubtype: 'orphaned', costUsd: a.costUsd, numTurns: a.numTurns, endRef: a.endRef, permissionDenials: [], skillsUsed: [], toolsUsed: {} } });
      this.store.append({ type: 'attempt.concluded', goalId: a.goalId, payload: { attemptId: a.id, state: resumable ? 'interrupted' : 'error', reason: resumable ? 'interrupted by engine restart — resumes next' : 'orphaned by engine restart' } });
      const t = getTask(this.store.db, a.taskId);
      if (t && (t.state === 'running' || t.state === 'observing' || t.state === 'merging')) {
        if (t.state === 'merging') this.store.append({ type: 'task.state_changed', goalId: a.goalId, payload: { taskId: t.id, from: 'merging', to: 'observing', reason: 'orphaned merge' } });
        const from = t.state === 'merging' ? 'observing' : t.state;
        this.store.append({ type: 'task.state_changed', goalId: a.goalId, payload: { taskId: t.id, from, to: 'ready', reason: resumable ? 'engine restarted; attempt will resume' : 'engine restarted; attempt orphaned' } });
        // an orphaned attempt that cannot be resumed is not a failed one either: give the budget back
        if (a.kind === 'work' && !resumable) this.store.append({ type: 'task.hint_set', goalId: a.goalId, payload: { taskId: t.id, hint: t.hint, extraAttempts: 1 } });
      }
      this.store.append({ type: 'engine.note', goalId: a.goalId, payload: { level: resumable ? 'info' : 'warn', message: resumable ? `attempt ${a.id} was interrupted by an engine restart; its session will be resumed` : `attempt ${a.id} was orphaned by an engine restart` } });
    }
    for (const g of listGoals(this.store.db)) {
      if (g.delivery.status === 'running') {
        this.store.append({ type: 'delivery.failed', goalId: g.id, payload: { step: g.delivery.step ?? 'preflight', reason: 'engine restarted during delivery — run Deliver again (every step is idempotent)' } });
      }
      if (['done', 'over_delivered', 'failed', 'cancelled'].includes(g.state)) continue;
      await git(['worktree', 'prune'], g.repoPath).catch(() => {});
      for (const t of listTasks(this.store.db, g.id)) {
        if (t.state === 'merging') this.store.append({ type: 'task.state_changed', goalId: g.id, payload: { taskId: t.id, from: 'merging', to: 'observing', reason: 'engine restart' } });
      }
    }
  }

  // ---------- listeners ----------

  onStream(l: StreamListener): () => void {
    this.streamListeners.add(l);
    return () => this.streamListeners.delete(l);
  }
  broadcast(s: StreamEvent): void {
    if (s.event.kind === 'init') this.skills.recordSessionView(s.event.raw);
    for (const l of this.streamListeners) {
      try {
        l(s);
      } catch {}
    }
  }
  onEscalation(l: (e: Escalation) => void): () => void {
    this.escalationListeners.add(l);
    return () => this.escalationListeners.delete(l);
  }
  notify(e: Escalation): void {
    this.config.log(`[escalation] ${e.trigger} goal=${e.goalId} task=${e.taskId ?? '-'}: ${e.message.split('\n')[0]}`);
    for (const l of this.escalationListeners) {
      try {
        l(e);
      } catch {}
    }
  }

  /** Cheap-model distiller for oversized check outputs; cost is booked to the goal. */
  summarizer(goal: Goal, cwd: string): (raw: string) => Promise<string> {
    return (raw) =>
      summarizeOutput(this.runner, raw, {
        model: goal.models.cheap,
        goalId: goal.id,
        cwd,
        onCost: (usd) => usd > 0 && this.store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: usd, source: 'distill' } }),
        onResult: (r) => this.recordSessionUsage(r, { goalId: goal.id, kind: 'distill', model: goal.models.cheap }),
      });
  }

  // ---------- usage & rate limits ----------

  /** Single funnel for every finished session: ledger event + rate-limit observation. */
  recordSessionUsage(result: RunResult, meta: { goalId: string | null; kind: string; model?: string | null; provider?: 'claude' | 'codex' }): void {
    const provider = (meta.goalId ? this.mustGoal(meta.goalId).provider : meta.provider) ?? this.config.provider;
    const u: any = result.usage ?? {};
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    // the session's model = the one that did the work: Claude Code also bills a few hundred haiku tokens per session for its own
    // housekeeping, and object key order would otherwise label a Fable session "haiku"
    const usageByModel = result.modelUsage && typeof result.modelUsage === 'object' ? Object.entries(result.modelUsage as Record<string, { costUSD?: number; outputTokens?: number }>) : [];
    const modelFromUsage = usageByModel.sort((a, b) => (n(b[1]?.costUSD) || n(b[1]?.outputTokens)) - (n(a[1]?.costUSD) || n(a[1]?.outputTokens)))[0]?.[0] ?? null;
    this.store.append({
      type: 'session.usage',
      goalId: meta.goalId,
      payload: {
        provider,
        sessionId: result.sessionId,
        kind: meta.kind,
        model: modelFromUsage ?? meta.model ?? null,
        inputTokens: n(u.input_tokens),
        outputTokens: n(u.output_tokens),
        cacheReadTokens: n(u.cache_read_input_tokens),
        cacheCreateTokens: n(u.cache_creation_input_tokens),
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        subtype: result.subtype,
        rateLimit: result.rateLimit ? { status: result.rateLimit.status, resetsAt: result.rateLimit.resetsAt, rateLimitType: result.rateLimit.rateLimitType, isUsingOverage: result.rateLimit.isUsingOverage } : null,
        skillsUsed: result.skillsUsed ?? [],
      },
    });
    this.observeRateLimit(result, provider);
  }

  private observeRateLimit(result: RunResult, provider: 'claude' | 'codex'): void {
    const rl = result.rateLimit;
    const now = Date.now();
    const limitedByStatus = !!rl && !['allowed', 'allowed_warning'].includes(rl.status) && !!rl.resetsAt && rl.resetsAt * 1000 > now;
    const limitedByError = result.isError && /rate.?limit|usage limit|overloaded|too many requests|\b429\b/i.test(result.errorMessage ?? '');
    if (!limitedByStatus && !limitedByError) return;
    const until = limitedByStatus ? rl!.resetsAt! * 1000 : now + 5 * 60_000;
    this.pauseUntil(until, rl?.rateLimitType ?? null, limitedByStatus ? `rate_limit_event status=${rl!.status}` : `session error: ${(result.errorMessage ?? '').slice(0, 120)}`, provider);
  }

  /** A limit on one account must not pause the other backend. */
  pauseUntil(until: number, rateLimitType: string | null, reason: string, provider = this.config.provider): void {
    if ((this.rateLimitedUntil.get(provider) ?? 0) >= until) return;
    this.rateLimitedUntil.set(provider, until);
    this.store.append({ type: 'rate_limit.paused', goalId: null, payload: { provider, rateLimitType, until: new Date(until).toISOString(), reason } });
    this.armResume(until, provider);
  }
  private armResume(until: number, provider: 'claude' | 'codex'): void {
    clearTimeout(this.resumeTimers.get(provider));
    this.resumeTimers.set(provider, setTimeout(() => {
      this.rateLimitedUntil.delete(provider);
      this.resumeTimers.delete(provider);
      this.store.append({ type: 'rate_limit.resumed', goalId: null, payload: { provider, reason: 'retry time reached' } });
      for (const g of listGoals(this.store.db)) if ((g.provider ?? this.config.provider) === provider && !['done', 'over_delivered', 'failed', 'cancelled'].includes(g.state)) this.tick(g.id);
    }, Math.max(0, until - Date.now()) + 1000));
  }
  private restoreRateLimitPause(): void {
    for (const provider of ['claude', 'codex'] as const) {
      const paused = this.store.listByType('rate_limit.paused', 100).find((e) => (('provider' in e.payload ? e.payload.provider : undefined) ?? this.config.provider) === provider);
      const resumed = this.store.listByType('rate_limit.resumed', 100).find((e) => (('provider' in e.payload ? e.payload.provider : undefined) ?? this.config.provider) === provider);
      if (!paused || (resumed && resumed.seq > paused.seq)) continue;
      const until = Date.parse((paused.payload as { until: string }).until);
      if (!Number.isFinite(until)) continue;
      if (until > Date.now()) { this.rateLimitedUntil.set(provider, until); this.armResume(until, provider); }
      else this.store.append({ type: 'rate_limit.resumed', goalId: null, payload: { provider, reason: 'retry time passed while the engine was down' } });
    }
  }
  isRateLimited(provider = this.config.provider): boolean { return (this.rateLimitedUntil.get(provider) ?? 0) > Date.now(); }
  rateLimitedUntilIso(provider = this.config.provider): string | null { return this.isRateLimited(provider) ? new Date(this.rateLimitedUntil.get(provider)!).toISOString() : null; }

  usage(provider = this.config.provider): UsageSummary & { pausedUntil: string | null } {
    return { ...usageSummary(this.store.db, Date.now(), provider, this.config.provider), provider, costAvailable: provider !== 'codex', ...(provider === 'codex' ? { codexQuota: this.codexQuota.current(), note: 'Codex reports tokens, not USD cost. $0 means unreported, not free. USD budgets cannot be enforced; use time, concurrency and attempt limits. Account quota follows the native account; activity totals count only Foundry sessions.' } : {}), pausedUntil: this.rateLimitedUntilIso(provider) };
  }

  // ---------- models ----------

  /** seed aliases ∪ names seen in sessions, with what they resolved to; what the Settings page lists */
  listModels(provider: 'claude' | 'codex' = this.config.provider): (ModelRecord & { label: string | null; note: string | null; pinned: boolean; inUse: string[] })[] {
    const used = this.modelsInUse(provider);
    return this.providerModels[provider].list().map((r) => {
      const seed = SEED_MODELS.find((s) => s.name === r.name);
      const inUse = used.get(r.name) ?? [];
      return { ...r, label: provider === 'codex' ? r.codex?.displayName ?? (r.name === 'codex-default' ? 'CLI default' : null) : seed?.label ?? null, note: provider === 'codex' ? r.codex?.description ?? null : seed?.note ?? null, pinned: isPinnedId(r.name), inUse };
    });
  }
  private validateCodexChoice(model?: string, effort?: CodexEffort): void {
    if (!model || !effort || model === 'codex-default') return;
    const advertised = this.providerModels.codex.get(model)?.codex;
    if (advertised?.available && advertised.reasoningEfforts.length && !advertised.reasoningEfforts.includes(effort)) {
      throw new Error(`Codex model ${model} does not advertise reasoning effort ${effort}. Choose ${advertised.reasoningEfforts.join(', ')} or CLI default, then sync models if the catalog is stale.`);
    }
  }
  /** One minimal session with `name` (user-triggered; costs one short call) to learn what it resolves to. */
  async probeModel(name: string, provider: 'claude' | 'codex' = this.config.provider, effort?: CodexEffort): Promise<{ ok: boolean; name: string; resolvedId: string | null; costUsd: number; costAvailable: boolean; error: string | null }> {
    const handle = await this.runner.run({ prompt: 'Reply with the single word OK.', cwd: this.config.dataDir, model: name, effort, meta: { tier: 'probe', provider }, maxTurns: 1, maxBudgetUsd: 0.5, permissionMode: 'dontAsk', allowedTools: [], timeoutMs: 90_000, label: `model probe ${name}` });
    let resolved: string | null = null;
    for await (const ev of handle.events) if (ev.kind === 'init') resolved = ev.model;
    const r = await handle.result;
    this.recordSessionUsage(r, { goalId: null, kind: 'probe', model: name, provider });
    const ok = r.subtype === 'success' && !r.isError;
    const rec = this.providerModels[provider].get(name);
    return { ok, name, resolvedId: resolved ?? rec?.resolvedId ?? null, costUsd: r.costUsd, costAvailable: provider === 'claude' && r.costStatus !== 'unavailable', error: ok ? null : (r.errorMessage ?? r.subtype) };
  }
  /** Read native account metadata separately from local activity; never start inference. */
  async readUsage(provider = this.config.provider, force = false): Promise<UsageSummary & { pausedUntil: string | null }> {
    if (provider === 'codex') await this.codexQuota.read(force);
    return this.usage(provider);
  }

  /** the models the presets Settings picks actually use, with where: "opus" → ["Code: Standard tasks", …] */
  modelsInUse(provider: 'claude' | 'codex' = this.config.provider): Map<string, string[]> {
    const presets = effectivePresets(this.config.modelPresets);
    const used = new Map<string, string[]>();
    if (provider === 'codex') {
      const native = effectiveCodexPresets(this.config.codexPresets);
      for (const n of MODEL_NATURES) {
        const p = native[this.config.codexNaturePreset[n]] ?? native[DEFAULT_NATURE_PRESETS[n]]!;
        for (const a of CODEX_MODEL_ACTIONS) {
          const model = p.tables[n][a].model === 'codex-default' ? this.config.codexModel : p.tables[n][a].model;
          used.set(model, [...(used.get(model) ?? []), `${NATURE_LABEL[n]}: ${a === 'housekeeping' ? 'Housekeeping' : ACTION_INFO[a].label}`]);
        }
      }
      return used;
    }
    for (const n of MODEL_NATURES) {
      const p = presets[this.config.naturePreset[n]] ?? BUILTIN_PRESETS[DEFAULT_NATURE_PRESETS[n]]!;
      for (const a of MODEL_ACTIONS) used.set(p.tables[n][a], [...(used.get(p.tables[n][a]) ?? []), `${NATURE_LABEL[n]}: ${ACTION_INFO[a].label}`]);
    }
    return used;
  }

  private modelsCheck(provider: 'claude' | 'codex' = this.config.provider) {
    const registry = this.providerModels[provider];
    const issues: string[] = [];
    for (const [name, where] of this.modelsInUse(provider)) {
      const r = registry.get(name);
      if (r?.lastFailAt && (!r.lastOkAt || r.lastFailAt > r.lastOkAt)) issues.push(`${name} (${where.length} action${where.length === 1 ? '' : 's'}): last failed ${r.lastFailAt.slice(0, 16).replace('T', ' ')} (${r.lastError ?? 'model unavailable'})`);
      else if (!r || (!r.seed && !r.discovered && !registry.known(name))) issues.push(`${name} (${where.length} action${where.length === 1 ? '' : 's'}): never seen resolving on this machine`);
    }
    const picks = provider === 'codex' ? `Codex: ${this.config.codexModel}` : MODEL_NATURES.map((n) => `${NATURE_LABEL[n]} ${effectivePresets(this.config.modelPresets)[this.config.naturePreset[n]]?.label ?? this.config.naturePreset[n]}`).join(' · ');
    const detail = issues.length ? issues.join('; ') : `${picks}${provider === 'codex' ? '' : '; fallbacks ' + this.config.modelFallbacks.join(' → ')}`;
    return { id: 'models', label: 'Models (presets in use)', ok: issues.length === 0, severity: 'warn' as const, detail, fix: issues.length ? { action: 'test-models' as const } : null };
  }

  /**
   * Model sync: read every model id the Claude Code binary knows (free), then resolve the family aliases with one tiny
   * session each so the dropdowns show what `fable` / `opus` / `sonnet` / `haiku` mean today. Runs on demand and when the
   * Claude Code version changes.
   */
  async syncModels(opts: { probe?: boolean; provider?: 'claude' | 'codex' } = {}): Promise<{ found: number; newest: string[]; resolved: Record<string, string | null>; cliVersion: string | null }> {
    const provider = opts.provider ?? this.config.provider;
    const registry = this.providerModels[provider];
    if (provider === 'codex') {
      if (this.stopped) throw new Error('Foundry is stopped; model discovery cannot start.');
      const bin = this.config.codexBin ?? Bun.which('codex');
      if (!bin) throw new Error('Codex CLI is not installed. Set the CLI path in Accounts and restart Foundry.');
      const discovery = discoverCodexModels(bin, this.config.codexHome, { signal: this.modelDiscoveryAbort.signal });
      this.modelDiscoveries.add(discovery);
      let result: Awaited<typeof discovery>;
      try { result = await discovery; } finally { this.modelDiscoveries.delete(discovery); }
      if (this.stopped) throw new Error('Foundry stopped during model discovery.');
      registry.noteCodexDiscovered(result.models);
      const cliVersion = result.cliVersion ?? null;
      registry.noteSync({ cliVersion, at: new Date().toISOString(), found: result.models.length });
      return { found: result.models.length, newest: result.models.filter((m) => m.isDefault).map((m) => m.id), resolved: {}, cliVersion };
    }
    const bin = this.config.claudeBin ?? Bun.which('claude');
    const found = bin ? modelsInBinary(bin) : [];
    if (found.length) registry.noteDiscovered(found);
    const resolved: Record<string, string | null> = {};
    if (opts.probe !== false) for (const alias of ['fable', 'opus', 'sonnet', 'haiku']) resolved[alias] = (await this.probeModel(alias, provider).catch(() => null))?.resolvedId ?? null;
    const cliVersion = await this.claudeVersion();
    registry.noteSync({ cliVersion, at: new Date().toISOString(), found: found.length });
    this.config.log(`[models] sync: ${found.length} id(s) in the Claude Code binary; ${Object.entries(resolved).map(([a, r]) => `${a} → ${r ?? '?'}`).join(', ')}`);
    return { found: found.length, newest: found.filter((f) => f.newest).map((f) => f.id), resolved, cliVersion };
  }
  private async claudeVersion(): Promise<string | null> {
    const bin = this.config.claudeBin ?? Bun.which('claude');
    if (!bin) return null;
    const r = await exec([bin, '--version'], this.config.dataDir, { timeoutMs: 15_000 }).catch(() => null);
    return r?.code === 0 ? r.stdout.trim().split(/\s/)[0] ?? null : null;
  }
  /**
   * Presets replaced the strong / worker / cheap tiers in Settings. A settings file that set tiers but never chose presets
   * is moved to the shipped defaults once, with a note listing what it had so the choice can be undone.
   */
  private migrateModelTiersToPresets(): void {
    if (this.config.provider === 'codex') return;
    for (const name of ['FOUNDRY_MODEL_STRONG', 'FOUNDRY_MODEL_WORKER', 'FOUNDRY_GOAL_REVIEWER']) {
      if (process.env[name]) this.config.log(`[settings] ${name} is set but no longer does anything: models come from presets (Settings → Models & limits)`);
    }
    // the tier keys are no longer part of the settings schema: read what an older version wrote straight from the file
    let raw: { models?: Record<string, unknown> } = {};
    try {
      raw = JSON.parse(readFileSync(this.settings.path, 'utf8'));
    } catch {}
    // `cheap` is still a setting (the housekeeping model): only strong / worker mark a pre-presets install
    const tiers = (['strong', 'worker'] as const).filter((t) => typeof raw.models?.[t] === 'string');
    const chosen = (['presetCode', 'presetDocs', 'presetMedia'] as const).some((k) => raw.models?.[k] != null);
    if (!tiers.length || chosen) return;
    const before = tiers.map((t) => `${t} = ${raw.models![t]}`).join(', ');
    this.updateSettings({ models: { presetCode: DEFAULT_NATURE_PRESETS.code, presetDocs: DEFAULT_NATURE_PRESETS.docs, presetMedia: DEFAULT_NATURE_PRESETS.media } });
    this.store.append({ type: 'engine.note', goalId: null, payload: { level: 'info', message: `Models now come from presets: Code = Production, Docs & research = Balanced, Media = Balanced (Settings → Models). Your previous tiers were ${before}; the Economy or Balanced preset is closest if you want them back.` } });
  }

  /** a new Claude Code version may know new models: sync once, in the background */
  private async syncModelsIfCliChanged(): Promise<void> {
    if (this.config.provider === 'codex') return; // no paid model probes at startup
    const v = await this.claudeVersion();
    if (v && v !== this.models.syncState().cliVersion) await this.syncModels().catch((err) => this.config.log(`[models] sync failed: ${String(err)}`));
  }

  /** One minimal cheap-model session purely to refresh the rate-limit signal (~$0.02). */
  /**
   * MiniMax quota, read with `mmx quota show` using the credentials sessions get. Kept for 10 minutes: the header asks
   * often, and each read is a MiniMax API call. `force` reads it now (the Usage page's Refresh).
   */
  async minimaxQuota(force = false): Promise<MinimaxQuota> {
    // an answer lasts 10 minutes; an error only 30 s, so a fixed key or network shows up soon
    const ttl = this.minimax?.quota.state === 'error' ? 30_000 : 10 * 60_000;
    if (!force && this.minimax && Date.now() - this.minimax.at < ttl) return this.minimax.quota;
    // Refresh means a new read: wait out one already under way (it may still use an old key), then read again
    if (force && this.minimaxRun) await this.minimaxRun.catch(() => null);
    this.minimaxRun ??= fetchMinimaxQuota({ bin: Bun.which('mmx'), signedIn: !!this.minimaxKey() || mmxSignedIn(), env: this.sessionEnvExtra(), cwd: this.config.dataDir })
      .then((quota) => {
        this.minimax = { quota, at: Date.now() };
        return quota;
      })
      .finally(() => {
        this.minimaxRun = null;
      });
    return this.minimaxRun;
  }

  async probeUsage(provider: 'claude' | 'codex' = this.config.provider): Promise<UsageSummary & { pausedUntil: string | null }> {
    if (provider === 'codex') return this.readUsage(provider, true);
    const handle = await this.runner.run({ prompt: 'Reply with the single word OK.', cwd: this.config.dataDir, model: this.config.models.cheap, maxTurns: 1, maxBudgetUsd: 0.05, permissionMode: 'dontAsk', allowedTools: [], timeoutMs: 60_000, label: 'usage probe', meta: { provider } });
    for await (const _ of handle.events) {
      /* drain */
    }
    const r = await handle.result;
    this.recordSessionUsage(r, { goalId: null, kind: 'probe', provider, model: this.config.models.cheap });
    return this.usage(provider);
  }

  // ---------- in-flight bookkeeping ----------

  private goalWsLocks = new Map<string, Promise<unknown>>();
  /** Serialise git operations on a goal's workspace (parallel tasks finishing together would otherwise race on its index). */
  async withGoalWsLock<T>(goalId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.goalWsLocks.get(goalId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {});
    this.goalWsLocks.set(goalId, tail);
    try {
      return await next;
    } finally {
      if (this.goalWsLocks.get(goalId) === tail) this.goalWsLocks.delete(goalId);
    }
  }

  reserve(taskId: string): void {
    const t = getTask(this.store.db, taskId);
    this.inFlight.set(taskId, { goalId: t?.goalId ?? '', attemptId: null, handle: null });
  }
  registerInFlight(taskId: string, attemptId: string, handle: RunHandle): void {
    const f = this.inFlight.get(taskId);
    if (f) {
      f.attemptId = attemptId;
      f.handle = handle;
    }
  }
  unregisterInFlight(taskId: string): void {
    const f = this.inFlight.get(taskId);
    if (f) f.handle = null;
  }
  release(taskId: string): void {
    this.inFlight.delete(taskId);
  }
  isInFlight(taskId: string): boolean {
    return this.inFlight.has(taskId);
  }
  /**
   * Everything a restart would interrupt — not just Claude processes: an attempt between two sessions (running checks,
   * merging, waiting for the workspace lock), a clarify, a goal review or a delivery in progress all count.
   */
  busy(): { sessions: number; attempts: number; clarifying: number; reviewing: number; delivering: number; total: number } {
    const b = { sessions: this.runner.active(), attempts: this.inFlight.size, clarifying: this.clarifying.size, reviewing: this.reviewing.size, delivering: this.delivering.size, total: 0 };
    b.total = b.sessions + b.attempts + b.clarifying + b.reviewing + b.delivering;
    return b;
  }
  inFlightForGoal(goalId: string): string[] {
    return [...this.inFlight.entries()].filter(([, f]) => f.goalId === goalId).map(([t]) => t);
  }
  attemptCount(taskId: string): number {
    return listAttempts(this.store.db, taskId).filter((a) => a.kind === 'work').length;
  }
  killGoal(goalId: string, reason: string): void {
    for (const [, f] of this.inFlight) if (f.goalId === goalId) f.handle?.kill('killed_manual');
    this.config.log(`[engine] killed in-flight sessions for ${goalId}: ${reason}`);
  }
  /** In-flight sessions joined with their attempt records — what the agents monitor shows as Foundry rows. */
  foundryLiveSessions(): FoundryLiveSession[] {
    const out: FoundryLiveSession[] = [];
    for (const [taskId, f] of this.inFlight) {
      const a = f.attemptId ? getAttempt(this.store.db, f.attemptId) : null;
      out.push({ taskId, goalId: f.goalId, attemptId: f.attemptId, kind: a?.kind, attemptIndex: a?.index ?? null, sessionId: a?.sessionId ?? null, pid: a?.pid ?? null, model: a?.model ?? null, cwd: a?.cwd ?? null, startedAt: a?.startedAt ?? null, killable: f.handle != null });
    }
    return out;
  }
  /** Kill one in-flight task's session (same path killGoal uses); false when nothing is running for it. */
  killTaskSession(taskId: string, reason = 'killed from Agents page'): boolean {
    const f = this.inFlight.get(taskId);
    if (!f?.handle) return false;
    f.handle.kill('killed_manual');
    this.config.log(`[engine] ${reason}: task ${taskId}`);
    return true;
  }

  // ---------- tick ----------

  tick(goalId: string): void {
    if (this.pendingTick.has(goalId)) return;
    this.pendingTick.add(goalId);
    const prev = this.chains.get(goalId) ?? Promise.resolve();
    const next = prev
      .then(() => new Promise<void>((r) => setTimeout(r, 0)))
      .then(() => {
        this.pendingTick.delete(goalId);
        return this.runTick(goalId);
      })
      .catch((err) => {
        this.config.log(`[engine] tick error for ${goalId}: ${String((err as Error)?.stack ?? err)}`);
        this.store.append({ type: 'engine.note', goalId, payload: { level: 'error', message: `tick error: ${String(err)}` } });
      });
    this.chains.set(goalId, next);
  }

  private async runTick(goalId: string): Promise<void> {
    if (this.stopped) return;
    const goal = getGoal(this.store.db, goalId);
    if (!goal) return;
    if (this.isRateLimited(goal.provider ?? this.config.provider)) return; // resume timer will tick again
    if (this.updateDraining) return; // endUpdateDrain re-ticks every goal
    switch (goal.state) {
      case 'draft':
        this.store.append({ type: 'goal.state_changed', goalId, payload: { from: 'draft', to: 'clarifying', reason: 'start clarify' } });
        return;
      case 'awaiting_feedback':
        return; // the human continues or gives feedback (escalation answer); nothing to schedule
      case 'clarifying': {
        if (this.clarifying.has(goalId)) return;
        const iv = goal.interview;
        if (iv?.status === 'awaiting_answers') return; // a round is open: the human answers on the goal page
        // a round was answered but no session settled it (engine restarted mid-interview): pick it up again
        if (iv?.status === 'thinking' && iv.rounds.length && iv.rounds.at(-1)!.answers) void continueInterview(this, goal);
        else void runClarify(this, goal);
        return;
      }
      case 'running':
        await schedule(this, goal);
        return;
      case 'done':
      case 'over_delivered': {
        // media artifacts leave the workspace first (independent of delivery mode — they never ride a PR)
        if (!goal.completion.artifactsRun && !this.deliveringArtifacts.has(goalId)) {
          this.deliveringArtifacts.add(goalId);
          void deliverArtifacts(this, goal)
            .catch((err) => this.store.append({ type: 'engine.note', goalId, payload: { level: 'warn', message: `artifact delivery crashed: ${String(err)}` } }))
            .finally(() => this.deliveringArtifacts.delete(goalId));
        }
        // graph refresh: after delivery for goals that leave the machine, right away for local ones
        if (shouldRunGraphRefresh(goal) && !this.completing.has(goalId)) {
          this.completing.add(goalId);
          void runGraphRefresh(this, goal, this.graphRefreshDeps)
            .catch((err) => this.store.append({ type: 'engine.note', goalId, payload: { level: 'warn', message: `graph refresh crashed: ${String(err)}` } }))
            .finally(() => this.completing.delete(goalId));
        }
        if (goal.delivery.policy.mode === 'local' || goal.delivery.status !== 'idle' || this.delivering.has(goalId)) return;
        const ac = new AbortController();
        this.delivering.set(goalId, ac);
        void runDelivery(this, goal, ac.signal)
          .catch((err) => this.store.append({ type: 'delivery.failed', goalId, payload: { step: 'preflight', reason: `delivery crashed: ${String(err)}` } }))
          .finally(() => {
            this.delivering.delete(goalId);
            this.tick(goalId);
          });
        return;
      }
      case 'goal_review':
        if (this.reviewing.has(goalId)) return;
        this.reviewing.add(goalId);
        void runGoalReview(this, goal)
          .catch((err) => {
            this.store.append({ type: 'engine.note', goalId, payload: { level: 'error', message: `goal review crashed: ${String(err)}` } });
            raiseEscalation(this, { goal, trigger: 'retries_exhausted', message: `Goal review crashed: ${String(err)}`, payload: { kind: 'goal-review' }, blockGoal: true });
          })
          .finally(() => {
            this.reviewing.delete(goalId);
            this.tick(goalId);
          });
        return;
      default:
        return;
    }
  }

  skillsForProvider(provider: 'claude' | 'codex' = this.config.provider): SkillsManager {
    return this.providerSkills[provider];
  }

  mcpFor(provider: 'claude' | 'codex' = this.config.provider) {
    return provider === 'codex' ? this.codexMcp : this.mcp;
  }

  mcpAllowedFor(goal: Goal): string[] {
    return (goal.provider ?? this.config.provider) === 'codex' ? this.config.codexMcpAllowed : this.config.mcpAllowed;
  }

  skillsFor(goal: Goal): SkillsManager {
    return this.providerSkills[goal.provider ?? this.config.provider];
  }

  // ---------- commands ----------

  async createGoal(input: CreateGoalInput): Promise<Goal> {
    const provider = input.provider ?? this.config.provider;
    if (!['claude', 'codex'].includes(provider)) throw new Error('Unknown coding agent');
    const codexModel = input.codexModel?.trim() || this.config.codexModel;
    // an unknown preset would silently fall back to the Settings pick while the goal still shows the typo
    if (provider === 'codex' && input.models) throw new Error('Codex uses its own model presets, not Claude tiers.');
    if (provider === 'claude' && input.effort != null && !Effort.safeParse(input.effort).success) throw new Error('This reasoning effort is only supported by Codex.');
    if (input.modelPreset) {
      const known = Object.keys(provider === 'codex' ? effectiveCodexPresets(this.config.codexPresets) : effectivePresets(this.config.modelPresets));
      if (!known.includes(input.modelPreset)) throw new Error(`unknown model preset "${input.modelPreset}"; use one of: ${known.join(', ')}`);
    }
    if (!(await isGitRepo(input.repoPath))) throw new Error(`${input.repoPath} is not a git repository`);
    const id = newId(IdPrefix.goal);
    // a Follow-up snapshots what it needs from the earlier goal now, and delivers to the same base branch
    const followUp = input.follows ? await prepareFollowUp(this, input.follows, input.repoPath, id, input.attachments?.length ?? 0) : null;
    const baseBranch = input.baseBranch ?? followUp?.baseBranch ?? (await currentBranch(input.repoPath));
    if (baseBranch === 'HEAD') throw new Error('repository is in detached HEAD state; pass --base <branch>');
    const now = new Date().toISOString();
    const nature: GoalNature = input.nature ?? 'auto';
    let codexPreset: CodexModelPreset | undefined;
    const presetId = input.modelPreset ?? (provider === 'codex' && nature !== 'auto' ? this.config.codexNaturePreset[natureKey(nature)] : null);
    if (provider === 'codex') {
      const presets = effectiveCodexPresets(this.config.codexPresets);
      if (presetId) {
        if (!presets[presetId]) throw new Error(`Unknown Codex preset: ${presetId}`);
        codexPreset = structuredClone(presets[presetId]!);
      } else {
        const tables = Object.fromEntries(MODEL_NATURES.map((n) => {
          const id = this.config.codexNaturePreset[n];
          if (!presets[id]) throw new Error(`Unknown Codex preset: ${id}`);
          return [n, structuredClone(presets[id]!.tables[n])];
        })) as CodexModelPreset['tables'];
        codexPreset = { label: 'Nature defaults', description: 'Captured per-nature defaults; the inferred nature selects its table.', basedOn: null, tables };
      }
      for (const table of Object.values(codexPreset.tables)) for (const choice of Object.values(table)) {
        choice.model = input.codexModel?.trim() || (choice.model === 'codex-default' ? codexModel : choice.model);
      }
      for (const choice of Object.values(codexPreset.tables[natureKey(nature)])) this.validateCodexChoice(choice.model, (input.effort === undefined ? this.config.effort : input.effort) ?? choice.effort ?? undefined);
    }
    // anyone-facing default: a goal that produces prose or media opens in the plain-language view
    const mode: GoalMode = input.mode ?? (nature !== 'auto' && nature !== 'code' ? 'simple' : this.config.defaultGoalMode);
    const title = input.title?.trim() || input.prompt.trim().split('\n')[0]!.slice(0, 80);
    const goal: Goal = {
      provider,
      id,
      title,
      prompt: input.prompt,
      repoPath: input.repoPath,
      // the progress folder: next to the repository (or under Settings → workspaces root), named after the title
      workspaceDir: defaultWorkspaceDir(this.config.workspacesRoot, { id, title, repoPath: input.repoPath }),
      checkpoint: null,
      selfCheck: input.selfCheck ?? this.config.selfCheck,
      previewRef: null,
      previewPlace: 'auto',
      effort: input.effort === undefined ? this.config.effort : input.effort,
      modelPreset: presetId,
      ...(codexPreset ? { codexPreset, codexFallbacks: [...this.config.codexFallbacks], ...(input.codexModel?.trim() ? { codexModelOverride: input.codexModel.trim() } : {}) } : {}),
      modelSubstitutions: {},
      interview: (() => {
        const mode = input.interview ?? this.config.interview;
        return mode === 'never' ? null : { mode, status: 'thinking' as const, sessionId: null, rounds: [] };
      })(),
      baseBranch,
      branch: `goal/${id}`,
      budgets: Budgets.parse({ ...BUDGET_PRESETS[input.budgetPreset ?? 'custom'].budgets, ...(input.budgets ?? {}), ...(provider === 'codex' ? { maxCostUsd: null } : {}) }),
      budgetPreset: input.budgetPreset ?? 'custom',
      mode,
      nature,
      outputDir: input.outputDir ?? null,
      workflow: (() => {
        // media goals default to fast: their deliverables are judged by the human's eye, not by $5 review sessions
        const pace = input.workflow?.pace ?? (MEDIA_NATURES.includes(nature) ? 'fast' : this.config.workflowPace);
        // fast goals run only what the Brief asks for: no TDD mandate unless the caller insists
        return { pace, tdd: input.workflow?.tdd ?? (pace === 'fast' ? ('off' as const) : mode === 'simple' ? ('preferred' as const) : this.config.workflowTdd) };
      })(),
      models: provider === 'codex' ? { strong: codexPreset!.tables[natureKey(nature)].clarifier.model, cheap: codexPreset!.tables[natureKey(nature)].housekeeping.model, worker: codexPreset!.tables[natureKey(nature)].standard.model } : { ...this.config.models, ...(input.models ?? {}) },
      state: 'draft',
      stateBeforeBlock: null,
      costUsd: 0,
      fixCycles: 0,
      delivery: { ...IDLE_DELIVERY, policy: DeliveryPolicy.parse({ ...(this.config.defaultDelivery ?? {}), ...(input.delivery ?? {}) }) },
      attachments: [...(input.attachments?.length ? claimStaged(this.config.dataDir, id, input.attachments.map((a) => this.latestStaged(a))) : []), ...(followUp?.attachments ?? [])],
      baseSync: null,
      autoskills: null,
      completion: { ...IDLE_COMPLETION },
      follows: followUp?.follows ?? null,
      runningSince: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.append({ type: 'goal.created', goalId: id, payload: { goal } });
    for (const a of goal.attachments) this.staged.delete(a.id);
    if (input.autoBrief || input.brief) {
      this.store.append({ type: 'goal.state_changed', goalId: id, payload: { from: 'draft', to: 'clarifying', reason: 'auto brief' } });
      const brief = input.brief ? BriefSchema.parse({ ...input.brief, goalId: id }) : autoBrief(goal, input.autoBrief!.mustChecks, input.autoBrief!.stretchChecks ?? []);
      this.store.append({ type: 'brief.proposed', goalId: id, payload: { brief } });
      this.store.append({ type: 'goal.state_changed', goalId: id, payload: { from: 'clarifying', to: 'awaiting_brief_approval', reason: 'auto brief' } });
      // Auto preset: no human sees the Brief here, so the engine adopts the proposed budget itself
      await this.approveBrief(id, brief, goal.budgetPreset === 'auto' ? proposeBudgetFromEstimate(brief) : undefined);
    }
    return getGoal(this.store.db, id)!;
  }

  // ---------- attachments & markdown conversion ----------

  markitdown: Markitdown;
  /** uploads not yet claimed by a goal, with their latest conversion status */
  private staged = new Map<string, Attachment>();
  private markitdownVersion: string | null | undefined;

  /**
   * Remember a staged upload / link and (unless `convert: false`) start converting it in the background.
   * Callers that claim the upload for a goal right away pass `convert: false` and let `addAttachment` start it
   * after the move, so the converter never races the rename.
   */
  stage(att: Attachment, opts: { convert?: boolean } = {}): Attachment {
    const planned = this.planConversion(att);
    this.staged.set(att.id, planned);
    if (planned.markdown?.status === 'pending' && opts.convert !== false) void this.runConversion(planned);
    return planned;
  }
  stagedView(attId: string): Attachment | null {
    return this.staged.get(attId) ?? null;
  }
  /** Latest record for a staged id (conversion may have finished since the upload response). */
  private latestStaged(att: Attachment): Attachment {
    return this.staged.get(att.id) ?? att;
  }

  private planConversion(att: Attachment): Attachment {
    const now = new Date().toISOString();
    const md = (status: 'pending' | 'skipped', error: string | null): Attachment['markdown'] => ({ status, path: null, bytes: null, tool: null, error, at: now });
    if (att.markdown && att.markdown.status !== 'pending') return att;
    const applicable = att.kind === 'link' ? !!att.url : this.markitdown.canConvert(att.name, att.mime);
    if (!applicable) return { ...att, markdown: md('skipped', att.kind === 'file' ? 'not a document markitdown improves on (images and text are read directly)' : null) };
    if (!this.markitdown.available()) return { ...att, markdown: md('skipped', 'markitdown not installed') };
    return { ...att, markdown: md('pending', null) };
  }

  /**
   * Convert one attachment. Writes to a scratch file, then places the markdown next to the attachment wherever it
   * lives by then (staging, or the goal directory if it was claimed meanwhile) and records the outcome.
   */
  private async runConversion(att: Attachment): Promise<void> {
    const tmp = conversionTmpPath(this.config.dataDir, att.id);
    // the file may have moved from staging into a goal directory since the upload: read it where it is now
    const current = this.staged.get(att.id)?.path ?? listGoals(this.store.db).flatMap((g) => g.attachments).find((a) => a.id === att.id)?.path ?? att.path;
    const r = att.kind === 'link' ? await this.markitdown.convertUrl(att.url!, tmp) : await this.markitdown.convertFile(resolve(this.config.dataDir, current!), tmp);
    if (this.markitdownVersion === undefined) this.markitdownVersion = await this.markitdown.version();
    const base = { tool: this.markitdownVersion ?? 'markitdown', at: new Date().toISOString() };
    const result: NonNullable<Attachment['markdown']> = r.ok ? { status: 'ready', path: null, bytes: r.bytes, error: r.truncated ? 'output truncated at 2 MB' : null, ...base } : { status: 'failed', path: null, bytes: null, error: r.error, ...base };
    const staged = this.staged.get(att.id);
    const owner = staged ? null : listGoals(this.store.db).find((g) => g.attachments.some((a) => a.id === att.id)) ?? null;
    if (r.ok) {
      const dir = attachmentDir(this.config.dataDir, owner?.id ?? null, att.id);
      mkdirSync(dir, { recursive: true });
      const dest = resolve(dir, markdownFileName(att));
      if (existsSync(tmp)) renameSync(tmp, dest);
      result.path = relative(this.config.dataDir, dest);
    }
    if (staged) {
      this.staged.set(att.id, { ...staged, markdown: result });
      return;
    }
    if (owner) this.store.append({ type: 'goal.attachment_converted', goalId: owner.id, payload: { attachmentId: att.id, markdown: result } });
  }

  /** Re-run (or first run after installing markitdown) the conversion of a goal's attachment. */
  async reconvertAttachment(goalId: string, attId: string): Promise<Attachment['markdown']> {
    const goal = this.mustGoal(goalId);
    const att = goal.attachments.find((a) => a.id === attId);
    if (!att) throw new Error(`attachment ${attId} not found`);
    const planned = this.planConversion({ ...att, markdown: null });
    this.store.append({ type: 'goal.attachment_converted', goalId, payload: { attachmentId: attId, markdown: planned.markdown! } });
    if (planned.markdown?.status === 'pending') await this.runConversion(planned);
    return this.mustGoal(goalId).attachments.find((a) => a.id === attId)?.markdown ?? null;
  }

  /** One-click `uv tool install markitdown[all]`, streaming output. Resolves when done; re-detects the binary. */
  async installMarkitdown(onLine: (l: string) => void): Promise<{ ok: boolean; command: string[]; exitCode: number | null }> {
    const command = this.markitdown.installCommand();
    if (!command) throw new Error('uv is not installed — install uv (https://docs.astral.sh/uv/) or run the command shown in Setup');
    onLine(`$ ${command.join(' ')}`);
    const t0 = Date.now();
    const r = await spawnStreaming(command, this.config.dataDir, onLine, { timeoutMs: 10 * 60_000 });
    const ok = r.code === 0 && this.markitdown.refresh();
    onLine(ok ? `■ installed ${(await this.markitdown.version()) ?? 'markitdown'} at ${this.markitdown.binary()}` : `■ failed (exit ${r.code})${r.code === 0 ? ' — binary not found on PATH or ~/.local/bin' : ''}`);
    this.store.append({ type: 'engine.note', goalId: null, payload: { level: ok ? 'info' : 'warn', message: `markitdown install: \`${command.join(' ')}\` exited ${r.code} in ${Math.round((Date.now() - t0) / 1000)}s${ok ? `; binary ${this.markitdown.binary()}` : ''}` } });
    return { ok, command, exitCode: r.code };
  }

  /**
   * One-click install of a catalog `cli` entry (e.g. graphify): runs its documented install command through
   * `sh -lc`, streaming output. Only entries from the catalog can be run — never arbitrary commands.
   */
  /** Playwright's Chromium for the self-check: the package ships with Foundry, the browser is downloaded on demand */
  async installPlaywright(onLine: (l: string) => void): Promise<{ ok: boolean; command: string[]; exitCode: number | null }> {
    const command = playwrightInstallCommand();
    onLine(`$ ${command.join(' ')}`);
    const t0 = Date.now();
    const r = await spawnStreaming(command, this.config.rootDir, onLine, { timeoutMs: 15 * 60_000 });
    const st = await playwrightStatus();
    const ok = r.code === 0 && st.browser;
    onLine(ok ? `■ ${st.detail}` : `■ failed (exit ${r.code}): ${st.detail}`);
    this.store.append({ type: 'engine.note', goalId: null, payload: { level: ok ? 'info' : 'warn', message: `playwright install: \`${command.join(' ')}\` exited ${r.code} in ${Math.round((Date.now() - t0) / 1000)}s — ${st.detail}` } });
    return { ok, command, exitCode: r.code };
  }
  playwrightStatus(): Promise<{ installed: boolean; browser: boolean; detail: string }> {
    return playwrightStatus();
  }

  async installTool(id: string, onLine: (l: string) => void, provider: 'claude' | 'codex' = this.config.provider): Promise<{ ok: boolean; command: string; exitCode: number | null }> {
    if (id === 'playwright') {
      const r = await this.installPlaywright(onLine);
      return { ok: r.ok, command: r.command.join(' '), exitCode: r.exitCode };
    }
    if (id === 'markitdown') {
      const r = await this.installMarkitdown(onLine);
      return { ok: r.ok, command: r.command.join(' '), exitCode: r.exitCode };
    }
    // a coding agent's own CLI (Setup's Claude Code / Codex check), else a CLI tool from the skills catalog
    const agentCli = AGENT_CLI_IDS.includes(id as AgentCliId) ? agentCliInstall(id === 'codex-cli' ? 'codex' : 'claude') : null;
    if (AGENT_CLI_IDS.includes(id as AgentCliId) && !agentCli) throw new Error(`${id}: no installer available here (needs curl, Homebrew or npm) — see the linked setup docs`);
    const entry = agentCli ? null : this.skillsForProvider(provider).catalog().entries.find((e) => e.id === id);
    if (!agentCli && (!entry || entry.source.type !== 'cli')) throw new Error(`${id} is not a CLI tool in the catalog`);
    const command = agentCli?.command ?? (entry!.source as { install: string }).install;
    const first = command.trim().split(/\s+/)[0]!;
    if (!Bun.which(first)) throw new Error(`${first} is not installed — install it first (https://docs.astral.sh/uv/ for uv), then retry`);
    onLine(`$ ${command}`);
    const t0 = Date.now();
    const r = await spawnStreaming(['sh', '-lc', command], this.config.dataDir, onLine, { timeoutMs: 10 * 60_000 });
    const ok = r.code === 0;
    if (ok && agentCli && adoptLocalBin()) onLine('added ~/.local/bin to this server\'s PATH');
    onLine(ok ? `■ done in ${Math.round((Date.now() - t0) / 1000)}s` : `■ failed (exit ${r.code})`);
    Object.values(this.providerSkills).forEach((skills) => skills.hints.invalidate());
    this.store.append({ type: 'engine.note', goalId: null, payload: { level: ok ? 'info' : 'warn', message: `tool install ${id}: \`${command}\` exited ${r.code}` } });
    return { ok, command, exitCode: r.code };
  }

  /** Doctor report including engine-level optional tools. */
  async doctor(provider: 'claude' | 'codex' = this.config.provider) {
    const available = this.markitdown.available();
    const cmd = this.markitdown.installCommand();
    const check = available
      ? { id: 'markitdown', label: 'markitdown (optional)', ok: true, severity: 'warn' as const, detail: `${this.markitdown.binary()} — attachments and repository documents are converted to markdown before sessions read them`, fix: null }
      : { id: 'markitdown', label: 'markitdown (optional)', ok: false, severity: 'warn' as const, detail: 'not installed — PDFs, Office files and links are handed to sessions as-is (more tokens to read). Installing converts them to markdown first.', fix: { command: "uv tool install --python 3.12 'markitdown[all]'", url: 'https://github.com/microsoft/markitdown', ...(cmd ? { action: 'install-markitdown' as const } : {}) } };
    const n = this.settings.values().notifications;
    const notifChannels = [n.telegramBotToken && n.telegramChatId ? 'Telegram' : null, n.discordWebhookUrl ? 'Discord' : null].filter(Boolean);
    const notif = notifChannels.length
      ? { id: 'notifications', label: 'Notifications (optional)', ok: true, severity: 'warn' as const, detail: `${notifChannels.join(' + ')} configured — you get pinged when a goal needs you, finishes, delivers, or usage pauses`, fix: null }
      : { id: 'notifications', label: 'Notifications (optional)', ok: false, severity: 'warn' as const, detail: 'not configured — get a Telegram or Discord ping when a goal needs you, finishes, or a delivery fails', fix: { url: '/settings' } };
    return this.skillsForProvider(provider).doctor([check, this.modelsCheck(provider), notif, ...await this.mcpFor(provider).doctorChecks()]);
  }

  /** Attach a staged upload or a link to an existing goal; later sessions see it. */
  addAttachment(goalId: string, att: Attachment): Attachment {
    const goal = this.mustGoal(goalId);
    const [claimed] = claimStaged(this.config.dataDir, goalId, [this.latestStaged(att)], goal.attachments.length);
    this.staged.delete(att.id);
    this.store.append({ type: 'goal.attachment_added', goalId, payload: { attachment: claimed! } });
    if (claimed!.markdown?.status === 'pending') void this.runConversion(claimed!);
    return claimed!;
  }

  removeAttachment(goalId: string, attachmentId: string): void {
    const goal = this.mustGoal(goalId);
    const att = goal.attachments.find((a) => a.id === attachmentId);
    if (!att) throw new Error(`attachment ${attachmentId} not found`);
    trashAttachment(this.config.dataDir, goalId, att);
    this.store.append({ type: 'goal.attachment_removed', goalId, payload: { attachmentId } });
  }

  /** The AI analyses a blocked task and proposes an action + hint (recorded on the escalation; nothing is applied here). */
  async suggestForEscalation(escalationId: string): Promise<EscalationSuggestion> {
    // the same card is on several screens (and tabs): a second click joins the running analysis instead of paying for another
    const running = this.suggesting.get(escalationId);
    if (running) return running;
    const p = runSuggest(this, escalationId).finally(() => this.suggesting.delete(escalationId));
    this.suggesting.set(escalationId, p);
    return p;
  }

  /** Draft with AI on the Brief page: a read-only strong session proposes spec/checks/tasks; nothing is written to the Brief. */
  async draftBrief(goalId: string, req: DraftRequest): Promise<DraftProposal> {
    return runDraft(this, this.mustGoal(goalId), req);
  }

  editBrief(goalId: string, brief: Brief): Brief {
    const goal = this.mustGoal(goalId);
    if (goal.state !== 'awaiting_brief_approval') throw new Error(`goal is ${goal.state}, brief cannot be edited`);
    const parsed = BriefSchema.parse({ ...brief, goalId });
    this.store.append({ type: 'brief.edited', goalId, payload: { brief: parsed } });
    return parsed;
  }

  /**
   * Approve the Brief and materialise its tasks and checks.
   * `budgets` (optional) is applied first — this is how the Auto preset's proposed budget, confirmed or edited
   * by the human on the Brief page, becomes the goal's budget before any work starts.
   */
  async approveBrief(goalId: string, edited?: Brief, budgets?: Partial<Budgets>, completion?: { graphRefresh?: boolean; docs?: DocType[] }): Promise<void> {
    const goal = this.mustGoal(goalId);
    if (goal.state !== 'awaiting_brief_approval') throw new Error(`goal is ${goal.state}, cannot approve`);
    const brief = BriefSchema.parse({ ...(edited ?? getBrief(this.store.db, goalId)?.brief), goalId });
    const unanswered = brief.questions.filter((q) => q.blocking && !q.answer?.trim());
    if (unanswered.length) throw new Error(`blocking questions unanswered: ${unanswered.map((q) => q.text).join(' | ')}`);
    topoSort(brief.tasks.map((t) => ({ id: t.key, dependsOn: t.dependsOnKeys })));
    if (!brief.tasks.length) throw new Error('brief has no tasks');

    const ws = await this.ensureSyncedWorkspace(goal);
    this.startAutoskills(goal, ws);
    // completion actions: what the UI sent, holes filled from the Brief (Simple mode and API callers send nothing)
    const inferred = inferCompletion(brief, ws, goal.workflow.pace);
    this.store.append({
      type: 'goal.completion_set',
      goalId,
      payload: { graphRefresh: completion?.graphRefresh ?? inferred.graphRefresh, docs: completion?.docs ?? inferred.docs, reason: completion ? 'set at brief approval' : inferred.reason },
    });
    if (budgets && Object.keys(budgets).length) {
      const next = Budgets.parse({ ...goal.budgets, ...budgets, ...(goal.provider === 'codex' ? { maxCostUsd: null } : {}) });
      this.store.append({ type: 'goal.budgets_changed', goalId, payload: { budgets: next, reason: goal.budgetPreset === 'auto' ? 'auto-from-brief' : 'set at brief approval' } });
    }
    const now = new Date().toISOString();
    const idByKey = new Map<string, string>();
    for (const t of brief.tasks) idByKey.set(t.key, newId(IdPrefix.task));
    this.store.append({ type: 'brief.approved', goalId, payload: { brief } });
    for (const t of brief.tasks) {
      const area = brief.areas.find((a) => a.key === t.areaKey) ?? null;
      const task: Task = {
        id: idByKey.get(t.key)!,
        goalId,
        title: t.title,
        spec: t.spec,
        kind: t.kind,
        // the commit scope defaults to the Area's slug (Conventional Commits: feat(student-portal): …)
        scope: t.scope?.trim() || area?.slug || null,
        scenario: t.scenario ?? 'general',
        area: area?.name ?? null,
        // docs, infra, research and media work gets no TDD mandate regardless of the goal's discipline
        tdd: t.tdd === 'off' || ['docs', 'infra', 'research', 'image', 'video'].includes(t.scenario ?? 'general') ? 'off' : 'inherit',
        dependsOn: t.dependsOnKeys.map((k) => idByKey.get(k)!),
        relevantFiles: t.relevantFiles,
        milestone: t.milestone ?? null,
        milestoneVisits: 0,
        checkpointOf: null,
        difficulty: t.difficulty ?? 'standard',
        parallelizable: t.parallelizable,
        retryBudget: goal.budgets.attemptsPerTask,
        origin: 'brief',
        state: 'pending',
        branch: null,
        worktreePath: null,
        baseRef: null,
        commitRef: null,
        commitMessage: null,
        hint: null,
        extraAttempts: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.store.append({ type: 'task.created', goalId, payload: { task } });
    }
    for (const c of brief.checks) {
      const taskId = c.taskKey ? idByKey.get(c.taskKey) : null;
      if (c.taskKey && !taskId) throw new Error(`check ${c.name} references unknown task ${c.taskKey}`);
      const check: Check = { id: newId(IdPrefix.check), goalId, taskId: taskId ?? null, name: c.name, tier: c.tier, spec: c.spec };
      this.store.append({ type: 'check.created', goalId, payload: { check } });
    }
    ensureSelfCheck(this, getGoal(this.store.db, goalId)!);
    this.store.append({ type: 'goal.state_changed', goalId, payload: { from: 'awaiting_brief_approval', to: 'running', reason: 'brief approved' } });
  }

  async answerEscalation(id: string, answer: EscalationAnswer): Promise<void> {
    await answerEsc(this, id, answer);
  }

  // ---------- delivery ----------

  /** Set (or change) the delivery policy; runs immediately when the goal is already finished. */
  async deliver(goalId: string, policyIn: Partial<DeliveryPolicy>, source: 'deliver' | 'retry' | 'resume' = 'deliver'): Promise<Goal> {
    const goal = this.mustGoal(goalId);
    if (goal.delivery.status === 'running') throw new Error('delivery is already running');
    const policy = DeliveryPolicy.parse({ ...goal.delivery.policy, ...policyIn });
    this.refuseStructural(goal, policy);
    await this.checkDeliverable(goal, policy);
    this.store.append({ type: 'delivery.policy_set', goalId, payload: { policy, source } });
    return getGoal(this.store.db, goalId)!;
  }

  /**
   * "Save" on the Delivery tab: store the policy without starting anything. The switches (wait for checks, merge
   * without checks, resolve conflicts, delete branches, fix-CI budget) take effect at the next step of a running
   * delivery; mode, unit, merge method, base and remote cannot change while pull requests are open or a run is going.
   */
  saveDeliveryPolicy(goalId: string, policyIn: Partial<DeliveryPolicy>): Goal {
    const goal = this.mustGoal(goalId);
    const policy = DeliveryPolicy.parse({ ...goal.delivery.policy, ...policyIn });
    this.refuseStructural(goal, policy);
    this.store.append({ type: 'delivery.policy_saved', goalId, payload: { policy } });
    return getGoal(this.store.db, goalId)!;
  }

  /** "Resume delivery": carry on from where the delivery stands — open PRs are reused, merged ones skipped, missing ones added */
  async resumeDelivery(goalId: string): Promise<Goal> {
    const g = this.mustGoal(goalId);
    if (g.delivery.policy.mode === 'local') throw new Error('this goal is delivered Local only — pick a delivery on the Delivery tab first');
    return this.deliver(goalId, {}, 'resume');
  }

  /** "Start over": close the open PRs, delete the stacked branches, and deliver again with `policyIn` (any field may change) */
  async startOverDelivery(goalId: string, policyIn: Partial<DeliveryPolicy>): Promise<Goal> {
    const goal = this.mustGoal(goalId);
    if (goal.delivery.status === 'running' || this.delivering.has(goalId)) throw new Error('delivery is running — cancel it first');
    const policy = DeliveryPolicy.parse({ ...goal.delivery.policy, ...policyIn });
    await this.checkDeliverable(goal, policy);
    await startOver(this, goal, policy);
    return getGoal(this.store.db, goalId)!;
  }

  private refuseStructural(goal: Goal, policy: DeliveryPolicy): void {
    const d = goal.delivery;
    const busy = d.status === 'running' ? 'a delivery is running' : d.prs.some((p) => p.state === 'open') ? 'pull requests are open' : null;
    const changed = busy ? structuralChanges(d.policy, policy, d.status === 'running') : [];
    if (changed.length) throw new Error(`${changed.join(', ')} cannot change while ${busy}; use Start over to deliver again with different settings`);
  }

  private async checkDeliverable(goal: Goal, policy: DeliveryPolicy): Promise<void> {
    if (policy.mode !== 'local') {
      const probes = await probeForPlan(this, goal, policy);
      if (!probes.remoteExists && !policy.remoteUrl && !policy.createRepo) throw new Error(`remote "${policy.remote}" does not exist: provide remoteUrl or createRepo`);
      if (policy.createRepo && !probes.gh?.authenticated) throw new Error('creating a GitHub repository needs the gh CLI, logged in: brew install gh && gh auth login --web');
    }
  }

  async deliveryPlan(goalId: string, policyIn: Partial<DeliveryPolicy> = {}) {
    const goal = this.mustGoal(goalId);
    const policy = DeliveryPolicy.parse({ ...goal.delivery.policy, ...policyIn });
    const probes = await probeForPlan(this, goal, policy);
    return { policy, probes, steps: planDelivery(goal, policy, probes) };
  }

  cancelDelivery(goalId: string): boolean {
    const ac = this.delivering.get(goalId);
    if (!ac) return false;
    ac.abort();
    return true;
  }

  /** Prefill and start point for a Follow-up of this goal (the New goal form, `goal new --follows`). */
  followUpDraft(goalId: string): Promise<FollowUpDraft> {
    return followUpDraft(this, goalId);
  }

  /** "Mark as follow-up of…": record that a goal follows an earlier goal of the same repository (relationship only). */
  markFollowUp(goalId: string, previousGoalId: string): Goal {
    return linkFollowUp(this, goalId, previousGoalId);
  }

  cancelGoal(goalId: string): void {
    const goal = this.mustGoal(goalId);
    if (['done', 'over_delivered', 'failed', 'cancelled'].includes(goal.state)) return;
    this.killGoal(goalId, 'cancelled');
    this.cancelDelivery(goalId);
    this.store.append({ type: 'goal.state_changed', goalId, payload: { from: goal.state, to: 'cancelled', reason: 'cancelled by user' } });
  }

  /**
   * Restart a goal from a task: that task and everything downstream of it go back to `pending` with a fresh attempt
   * budget; tasks upstream keep their results. Without `fromTaskId` every task restarts. A failed / cancelled / finished
   * goal goes back to `running`; the goal branch keeps the work done so far, so restarted tasks build on it.
   */
  async restartGoal(goalId: string, opts: { fromTaskId?: string } = {}): Promise<{ restarted: string[] }> {
    const goal = this.mustGoal(goalId);
    if (!['failed', 'cancelled', 'done', 'over_delivered', 'blocked', 'running'].includes(goal.state)) throw new Error(`goal is ${goal.state}; restart applies to running or finished goals`);
    const tasks = listTasks(this.store.db, goalId);
    let targets: Task[];
    if (opts.fromTaskId) {
      const from = tasks.find((t) => t.id === opts.fromTaskId);
      if (!from) throw new Error(`task ${opts.fromTaskId} not found`);
      const set = new Set<string>([from.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const t of tasks) if (!set.has(t.id) && t.dependsOn.some((d) => set.has(d))) (set.add(t.id), (grew = true));
      }
      targets = tasks.filter((t) => set.has(t.id));
    } else targets = tasks;
    // never restart something that is mid-flight
    targets = targets.filter((t) => !this.isInFlight(t.id) && t.state !== 'running' && t.state !== 'observing' && t.state !== 'merging');
    if (!targets.length) throw new Error('nothing to restart (tasks are running or none selected)');
    // open escalations on these tasks are moot now
    for (const esc of listEscalations(this.store.db, { goalId, openOnly: true })) {
      if (esc.taskId && targets.some((t) => t.id === esc.taskId)) this.store.append({ type: 'escalation.answered', goalId, payload: { escalationId: esc.id, answer: { action: 'retry_with_hint', extraAttempts: 0 } } });
    }
    // Upstream tasks that are failed/blocked would immediately re-fail the restarted ones ("dependency failed").
    // Starting from a task means the human accepts what is above it: mark those as skipped.
    const targetIds = new Set(targets.map((t) => t.id));
    for (const t of tasks) {
      if (targetIds.has(t.id)) continue;
      if (t.state === 'failed' || t.state === 'blocked') this.store.append({ type: 'task.state_changed', goalId, payload: { taskId: t.id, from: t.state, to: 'skipped', reason: 'human: restarted downstream — treated as skipped' } });
    }
    // a restarted task starts over: its old worktree and branch (if still around) go, so the rerun cannot inherit stale work
    for (const t of targets) if (t.worktreePath) await dropTaskWorkspace(goal, t).catch((err) => this.config.log(`[restart] drop worktree of ${t.id} failed: ${err}`));
    for (const t of targets) {
      const used = this.attemptCount(t.id);
      const over = Math.max(0, used - t.retryBudget - t.extraAttempts + t.retryBudget); // refresh: used attempts no longer count
      this.store.append({ type: 'task.restarted', goalId, payload: { taskId: t.id, extraAttempts: over, reason: opts.fromTaskId ? `restarted by user from ${opts.fromTaskId === t.id ? 'this task' : 'an upstream task'}` : 'restarted by user' } });
    }
    if (goal.state !== 'running') this.store.append({ type: 'goal.state_changed', goalId, payload: { from: goal.state, to: 'running', reason: opts.fromTaskId ? `restarted from task ${opts.fromTaskId}` : 'restarted' } });
    this.tick(goalId);
    return { restarted: targets.map((t) => t.id) };
  }

  /**
   * Delete a goal: stop its sessions, remove its worktrees (task branches always, the goal branch only when asked),
   * move its attachments to the trash and drop its read models. The event log keeps the history (tombstone event).
   * The user's checkout is never touched beyond branch/worktree bookkeeping.
   */
  async deleteGoal(goalId: string, opts: { deleteBranch?: boolean } = {}): Promise<{ deletedBranch: string | null }> {
    const goal = this.mustGoal(goalId);
    this.cancelGoal(goalId);
    const repoOk = await isGitRepo(goal.repoPath).catch(() => false);
    for (const t of listTasks(this.store.db, goalId)) {
      if (t.worktreePath && repoOk) await removeWorktree(goal.repoPath, t.worktreePath, { deleteBranch: t.branch ?? undefined }).catch(() => {});
    }
    const ws = goalWorkspacePath(this.config.dataDir, goal);
    let deletedBranch: string | null = null;
    if (repoOk) {
      await removeWorktree(goal.repoPath, deliveryWorkspacePath(this.config.dataDir, goal)).catch(() => {});
      await removeWorktree(goal.repoPath, previewWorkspacePath(this.config.dataDir, goal)).catch(() => {});
      await removeWorktree(goal.repoPath, ws, { deleteBranch: opts.deleteBranch ? goal.branch : undefined }).catch(() => {});
      if (opts.deleteBranch) deletedBranch = goal.branch;
      // stacked delivery branches (goal/<id>/<n>-<slug>) belong to the goal and go with it
      for (const b of await listStackBranches(goal.repoPath, goal.branch)) await git(['branch', '-D', b], goal.repoPath).catch(() => {});
    }
    // the folders go too: the legacy tree under data/, or the progress folder and its hidden internal sibling
    rmSync(join(this.config.dataDir, 'worktrees', goalId), { recursive: true, force: true });
    if (goal.workspaceDir) for (const d of [goal.workspaceDir, internalWorkspaceDir(goal)!]) rmSync(d, { recursive: true, force: true });
    for (const a of goal.attachments) trashAttachment(this.config.dataDir, goalId, a);
    this.store.append({ type: 'goal.deleted', goalId, payload: { title: goal.title, deletedBranch, reason: 'deleted by user' } });
    return { deletedBranch };
  }

  /** Called by the boundary hook (via the server) when a command was blocked. */
  handleBoundaryCallback(attemptId: string | null, payload: any): void {
    const command = String(payload?.tool_input?.command ?? '');
    const attempt = attemptId ? getAttempt(this.store.db, attemptId) : null;
    const goalId = attempt?.goalId ?? null;
    if (!goalId) {
      this.config.log(`[boundary] blocked command outside a known attempt: ${command}`);
      return;
    }
    const goal = getGoal(this.store.db, goalId)!;
    const task = attempt ? getTask(this.store.db, attempt.taskId) : null;
    this.store.append({ type: 'boundary.blocked', goalId, payload: { taskId: task?.id ?? null, attemptId, command } });
    raiseEscalation(this, {
      goal,
      task: null,
      attemptId,
      trigger: 'boundary_action',
      message: `Claude tried to run a command that leaves the local workspace while working on "${task?.title ?? '?'}":\n\n    ${command}\n\nIt was blocked. Approve to run it once on your behalf, or deny.`,
      payload: { command, cwd: attempt?.cwd ?? null, taskId: task?.id ?? null },
    });
  }

  private mustGoal(id: string): Goal {
    const g = getGoal(this.store.db, id);
    if (!g) throw new Error(`goal ${id} not found`);
    return g;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function autoBrief(goal: Goal, must: string[], stretch: string[]): Brief {
  const checks: Brief['checks'] = [];
  must.forEach((cmd, i) => {
    checks.push({ key: `M${i + 1}`, name: `must: ${cmd}`, tier: 'must', taskKey: 'T1', areaKey: null, spec: { type: 'command', cmd, timeoutMs: 300_000, expectExitCode: 0 } });
    checks.push({ key: `GM${i + 1}`, name: `goal must: ${cmd}`, tier: 'must', taskKey: null, areaKey: null, spec: { type: 'command', cmd, timeoutMs: 300_000, expectExitCode: 0 } });
  });
  stretch.forEach((cmd, i) => {
    checks.push({ key: `S${i + 1}`, name: `stretch: ${cmd}`, tier: 'stretch', taskKey: 'T1', areaKey: null, spec: { type: 'command', cmd, timeoutMs: 300_000, expectExitCode: 0 } });
  });
  return {
    goalId: goal.id,
    title: '',
    understanding: goal.prompt,
    areas: [],
    assumptions: [],
    checks,
    tasks: [{ key: 'T1', title: goal.title, spec: goal.prompt, kind: 'feature', scope: null, scenario: 'general', areaKey: null, tdd: 'inherit', dependsOnKeys: [], parallelizable: false, relevantFiles: [], milestone: null }],
    costEstimateUsd: 1,
    timeEstimateMin: 15,
    questions: [],
    run: null, styleOptions: [],
  };
}
