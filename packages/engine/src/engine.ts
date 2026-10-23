import { AGENT_PROVIDERS, AgentProvider, NATIVE_ACCOUNT, PROVIDER_NAME, isPooled, listAccountRateLimits, listRateLimitState, reportsDollars, type PooledProvider, type RateLimitRow } from '@foundry/core';
import { AccountPool } from './accounts/pool.ts';
import type { AccountUsage, AccountWindow, CodexQuota, WindowSummary } from './usage/types.ts';
import { CAD_VIEWER_KEY, CODEX_MODEL_ACTIONS, FINAL_WALK, CodexEffort, Effort, effectiveCodexPresets, isHistory, natureKey, repoHere, type CodexModelPreset } from '@foundry/core';
import { CodexPlugins } from './plugins/codex-plugins.ts';
import { AgyQuotaReader } from './usage/agy-quota.ts';
import { CodexQuotaReader } from './usage/codex-quota.ts';
import { discoverCodexModels } from './models/codex-discover.ts';
import { basename, dirname, join } from 'node:path';
import type { Attachment, Attempt, Brief, BriefApp, BudgetPreset, DocType, Escalation, EscalationAnswer, EscalationSuggestion, Goal, GoalMode, GoalNature, GoalWorkflow, ModelConfig, Task, Check } from '@foundry/core';
import {
  BUDGET_PRESETS,
  Budgets,
  DeliveryPolicy,
  IDLE_DELIVERY,
  proposeBudgetFromEstimate,
  renderDecisions,
  IDLE_COMPLETION,
  MEDIA_NATURES,
  depthOfMode,
  EventStore,
  IdPrefix,
  getAttempt,
  getBrief,
  getGoal,
  listRepoLearnings,
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
import { AgyCliRunner, CodexCliRunner, ClaudeCliRunner, LIMIT_TEXT, type ClaudeRunner, type RunHandle } from '@foundry/runner';
import { McpManager } from './mcp/manager.ts';
import { CodexMcpManager } from './mcp/codex-manager.ts';
import { mmxConfigDir, mmxSignedIn, writeMmxConfig } from './mmx.ts';
import { fetchMinimaxQuota } from './usage/minimax.ts';
import type { MinimaxQuota } from './usage/types.ts';
import { answerInterview, continueInterview, runClarify } from './clarify.ts';
import { type DraftProposal, type DraftRequest, type ReviseAnswer, answerRevise, cancelRevise, runDraft } from './brief-draft.ts';
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
import { budgetStatus } from './budget.ts';
import { dueCheckpoint, recordMilestone } from './checkpoint.ts';
import { milestoneQueues, milestoneRunsFor } from './checks/walkthrough.ts';
import { runInvestigation } from './investigation.ts';
import { needsInvestigation } from './references.ts';
import { MILESTONE_CHECK_PREFIX, milestoneCheckSpec } from './checks/milestone-script.ts';
import { cleanDeliverables, deliversCheckName, deliversCheckSpec } from './checks/delivers.ts';
import { filesOverlap } from './catchup.ts';
import { SkillsManager } from './skills/manager.ts';
import { skillUsage } from './skills/usage.ts';
import { linkSkillDirs, linkSuiteSkills } from './skills/suites.ts';
import { exportLearningsSkill } from './learnings-skill.ts';
import { secondOpinion, secondOpinionFailureOf, secondOpinionOf, secondOpinionOnBrief, startSecondOpinion, type SecondOpinionFailure, type SecondOpinionView } from './brief-second-opinion.ts';
import { SATISFIED } from './skills/catalog.ts';
import { UpdateManager } from './update/updater.ts';
import { AgentsMonitor, type FoundryLiveSession } from './agents/monitor.ts';
import { ClaudeAuth } from './auth/claude-auth.ts';
import { CliGh, type GhClient } from './delivery/gh.ts';
import { probeForPlan, runDelivery } from './delivery/pipeline.ts';
import { planDelivery } from './delivery/policy.ts';
import { usageSummary, type UsageSummary } from './usage/ledger.ts';
import type { RunResult, RunSpec } from '@foundry/runner';
import type { StreamEvent, StreamListener } from './types.ts';
import { ARTIFACTS_DIR, defaultWorkspaceDir, deliveryWorkspacePath, dropTaskWorkspace, ensureGoalWorkspace, goalWorkspacePath, internalWorkspaceDir, listArtifacts, listStackBranches, previewWorkspacePath } from './workspace.ts';
import { transferGoalDir } from './transfer/paths.ts';
import { relocateLegacyWorkspaces } from './workspace-migrate.ts';
import { PreviewManager } from './preview/manager.ts';
import { ensureSelfCheck, playwrightInstallCommand, playwrightStatus, runSelfCheck } from './checks/selfcheck.ts';
import { afterMerge, type AfterMergeOptions } from './delivery/after-merge.ts';
import { startOver, structuralChanges } from './delivery/start-over.ts';
import { runDocsAfterMerge, runDocsGeneration } from './docs-generate.ts';
import { checkGoalPrs, checkOpenPrs, markDelivered, recheckPr } from './delivery/pr-watch.ts';
import { startReviewRun } from './delivery/reviews.ts';
import { attachmentDir, claimStaged, conversionTmpPath, markdownFileName, sweepStaging, trashAttachment } from './attachments.ts';
import { Markitdown } from './convert/markitdown.ts';
import { SettingsError, SettingsStore, applySettingsToConfig } from './settings.ts';
import { NotificationDispatcher } from './notify/dispatcher.ts';
import { TelegramBot } from './notify/telegram-bot.ts';
import { DiscordBot } from './notify/discord-bot.ts';
import { endedForLearning, learnFromGoal, learnOnEnd, learningWork, learningsOf, setLearnings } from './learnings.ts';
import { Memory, memorySessionEnv, type MemoryDeps } from './memory/memory.ts';
import { DEPLOYABLE_STATES, type DeployRequest, deployCredentials, deployName, deployWork, deploying, goalDeployability, npxCli, smokeAgain, smoking, startDeploy, unsupported } from './deploy/deploy.ts';
import { type RevertInfo, type RevertRequest, revertInfo, revertWork, startRevert } from './delivery/revert.ts';
import { buildReport } from './reports.ts';
import { deliverCompanions } from './companions.ts';
import type { GoalCompanion } from '@foundry/core';
import { Access } from './access.ts';
import type { Report } from './usage/types.ts';
import { smokeScripts } from './deploy/smoke.ts';
import { DEPLOY_PROVIDERS, PROVIDER_LABEL, configured, deploySteps, redact } from './deploy/providers.ts';
import { ModelFallbackRunner } from './models/fallback-runner.ts';
import { modelsInBinary } from './models/discover.ts';
import { EffortRunner } from './effort-runner.ts';
import { AGY_SEED_MODELS, ModelRegistry, SEED_MODELS, isPinnedId, parseAgyModels, type ModelRecord } from './models/registry.ts';
import { copyProjectSkills, hasStackManifest, runAutoskills, type AutoskillsDeps } from './skills/autoskills.ts';
import { artifactsDue, deliverArtifacts, inferCompletion, runGraphRefresh, shouldRunGraphRefresh, type GraphRefreshDeps } from './completion.ts';
import { stuckCommits, takeBackOrphaned, takeBackStuck } from './take-back.ts';
import { cadModelIn, recoverOverlays } from './goal-artifacts.ts';
import type { Learning, SettingsPatch, SettingsView, DeployProvider } from '@foundry/core';
import { ACTION_INFO, BUILTIN_PRESETS, DEFAULT_NATURE_PRESETS, MODEL_ACTIONS, MODEL_NATURES, NATURE_LABEL, effectivePresets } from '@foundry/core';
import { spawnStreaming } from './skills/updaters.ts';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { removeWorktree } from './git/git.ts';
import { BaselineChecks } from './checks/baseline.ts';
import { homedir } from 'node:os';
import { relative, resolve } from 'node:path';
import { adoptLocalBin, AGENT_CLI_IDS, agentCliInstall, type AgentCliId } from './agent-cli.ts';
import { type FollowUpDraft, type FollowUpInput, copyAttachments, followUpDraft, linkFollowUp, prepareFollowUp } from './follow-up.ts';
import { autoApproveDelegated, delegatingTasks, isDelegationTask, settleDelegations } from './delegation.ts';
import { startDueSearches, subjectSearchesFor, trashSubjects } from './subjects.ts';
import { onMilestoneEvidence } from './likeness.ts';
import { ATTACHMENT_LIMITS, GoalIssue, LEARNINGS_EVERYWHERE, type GoalDelegatedFrom, type GoalDelegation } from '@foundry/core';
import { readIssue, type IssueRead } from './issue.ts';
import { autoApproveScheduled, checkSchedules, deleteSchedule, fireSchedule, saveSchedule, setScheduleEnabled, type ScheduleInput } from './schedules.ts';
import { calibrationFor } from './calibration.ts';
import { defaultQaDeps, type QaDeps } from './qa.ts';
import { calibratedEstimate, type Calibration } from '@foundry/core';
import { getSchedule, listSchedules, nextRunAt, type GoalSchedule, type Schedule } from '@foundry/core';
import { Tailnet } from './notify/tailnet.ts';
import { SessionCosts } from './session-costs.ts';
import { CODE_SERVER_INSTALL, CodeServer } from './editor/code-server.ts';
import { workerTools } from './guards/boundary.ts';
import { DESKTOP_APPS_PATTERNS, SLICER_APP_PATTERNS, SLICER_HEADLESS_PATTERNS } from './guards/patterns.ts';
import { pluginServerPrefix } from './mcp/servers.ts';
import { serverBaseArgs } from './skills/installer.ts';

export interface CreateGoalInput {
  provider?: AgentProvider;
  codexModel?: string;
  /** the Antigravity model of every role of this goal; default: Settings */
  agyModel?: string;
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
  /** pause at milestones for the human's look; default = Settings → workflow.milestonePause */
  milestonePause?: boolean;
  /** interview the human in rounds before the Brief; default = Settings → workflow.interview */
  interview?: 'auto' | 'always' | 'never';
  /** how deep the interview probes, 0 (none) to 5; wins over `interview`; default = Settings → workflow.interviewDepth */
  interviewDepth?: number;
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
  /** shipped software to learn from: REA investigates each before Clarify, when it is installed */
  references?: { target: string; lookAt?: string }[];
  /** simple = plain-language Brief and progress; default from Settings */
  mode?: GoalMode;
  /** engineering discipline; Simple mode defaults tdd to `preferred`, Expert to the Settings default */
  workflow?: Partial<GoalWorkflow>;
  /** what the goal produces; auto (default) = the Clarifier decides. Prose and media goals open in Simple mode unless mode says otherwise; cad keeps the default view. */
  nature?: GoalNature;
  /** where media artifacts are copied at done; null = they stay in the goal workspace */
  outputDir?: string | null;
  /** create the goal as a Follow-up of an earlier finished goal of the same repository (see follow-up.ts) */
  follows?: FollowUpInput;
  /** may the planner delegate steps to goals of their own, and are their Briefs approved without the human (both off by default) */
  delegation?: Partial<GoalDelegation>;
  /** engine-internal (delegation.ts): this goal does one `goal` task of a main goal; the API never sets it */
  delegatedFrom?: Omit<GoalDelegatedFrom, 'at'>;
  /** the GitHub issue the goal is made from, as `readIssue` returned it (ADR-0052); its thread travels in `attachments` */
  issue?: GoalIssue;
  /** engine-internal (schedules.ts): the Schedule this goal is a run of (ADR-0054) */
  schedule?: GoalSchedule;
  /** the Person who asked for it (ADR-0061); null when Access is off or it came another way */
  by?: string | null;
  /** the other repositories the goal changes (ADR-0063): each gets its part as a `goal` task bound to it */
  companions?: { repoPath: string; baseBranch?: string }[];
}

/** events of a Delegated goal its main goal must hear of: the ones that change what the main goal waits for, or cost it */
const PARENT_TICK_EVENTS = new Set<string>(['goal.state_changed', 'goal.cost_added', 'goal.deleted', 'interview.round_asked', 'interview.round_answered', 'brief.proposed', 'brief.approved', 'brief.edited', 'escalation.raised', 'escalation.answered']);

export interface InFlight {
  goalId: string;
  attemptId: string | null;
  handle: RunHandle | null;
  /** when the slot was taken: a reservation that never got going is stale after a while */
  since: number;
}

/** a ready task whose slot was taken this long ago but never started counts as stuck */
const STALE_RESERVATION_MS = 5 * 60_000;

/** the longest usage window a plan has (the weekly ones), with an hour to spare: no real reset is further away */
const MAX_PAUSE_MS = 7 * 24 * 60 * 60_000 + 60 * 60_000;
/** extra usage (overage) that ran out stops work only while sessions already run on it, until the plan's window resets */
const OVERAGE_PAUSE_MS = 5 * 60 * 60_000;

/**
 * Until when a session's rate-limit report pauses new sessions, or null. Only a `rejected` window pauses. An `overage`
 * rejection (the extra-usage credit is used up or not enabled, resetting monthly) pauses only a session already running
 * on extra usage, and only for the plan's next window; any pause is capped at the longest window.
 */
/** when the latest used-up window of a Codex account's quota resets (capped at the longest window), or null when none is used up */
export function codexResumeAt(q: CodexQuota, now: number): number | null {
  if (q.state !== 'available') return null;
  const resets = q.buckets
    .flatMap((b) => [b.primary, b.secondary])
    .filter((w): w is NonNullable<typeof w> => !!w && (w.usedPercent ?? 0) >= 100 && !!w.resetsAt && w.resetsAt * 1000 > now)
    .map((w) => w.resetsAt! * 1000);
  return resets.length ? Math.min(Math.max(...resets), now + MAX_PAUSE_MS) : null;
}

/** when a limit the error text names comes back ("… Individual quota reached. Resets in 2h39m52s.", Antigravity), capped like any pause */
export function resetsInAt(text: string | null | undefined, now: number): number | null {
  const m = /resets in\s+(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?!s))?\s*(?:(\d+)\s*s)?/i.exec(text ?? '');
  const ms = m ? (Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) * 1000 : 0;
  return ms > 0 ? Math.min(now + ms, now + MAX_PAUSE_MS) : null;
}

export function limitPauseUntil(rl: RunResult['rateLimit'], now: number): number | null {
  if (!rl || rl.status !== 'rejected' || !rl.resetsAt || rl.resetsAt * 1000 <= now) return null;
  if (rl.rateLimitType === 'overage' && !rl.isUsingOverage) return null;
  return Math.min(rl.resetsAt * 1000, now + (rl.rateLimitType === 'overage' ? OVERAGE_PAUSE_MS : MAX_PAUSE_MS));
}

export class Engine {
  readonly store: EventStore;
  readonly runner: ClaudeRunner;
  readonly roles: Roles;
  readonly skills: SkillsManager;
  readonly mcp: McpManager;
  readonly codexMcp: CodexMcpManager;
  readonly codexQuota: CodexQuotaReader;
  readonly agyQuota: AgyQuotaReader;
  readonly codexPlugins: CodexPlugins;
  readonly agents: AgentsMonitor;
  readonly auth: ClaudeAuth;
  readonly accounts: Record<AgentProvider, ClaudeAuth>;
  /** each coding agent's sign-ins and the one new sessions run on (ADR-0065) */
  readonly accountPool: AccountPool;
  private providerSkills: Record<AgentProvider, SkillsManager>;
  readonly gh: GhClient;
  /** who may use this Foundry from elsewhere (ADR-0061) */
  readonly access: Access;
  context: ContextProvider;
  private delivering = new Map<string, AbortController>();
  /** escalation id → the analysis running for it */
  private suggesting = new Map<string, Promise<EscalationSuggestion>>();
  /** post-completion graph refreshes in progress, per goal */
  private completing = new Set<string>();
  /** the artifact delivery of each goal in flight: a tidy-up after its merge waits for it, and so does stop() */
  private deliveringArtifacts = new Map<string, Promise<void>>();
  /** the goal's artifact delivery while it is copying, else undefined */
  artifactDelivery(goalId: string): Promise<void> | undefined {
    return this.deliveringArtifacts.get(goalId);
  }
  /** the tidy-ups after a merge that a delivery put off, running now, per goal */
  private tidying = new Map<string, Promise<void>>();
  /** goals whose folders the tidy-up after a merge is removing now, and goals being restarted: never both at once */
  readonly removingFolders = new Set<string>();
  readonly restarting = new Set<string>();
  /**
   * Run the tidy-up after a merge that was put off for the goal's artifact delivery (its hold is recorded as waiting),
   * once no copy is in flight: only that hold (one of another kind waits for a refresh or a button, or every tick of a
   * held goal would run it again), only for a goal still finished, and one at a time. A delivery that ended while the
   * engine was stopped is covered too: the first tick after the start finds the waiting hold.
   */
  private tidyAfterDelivery(goalId: string): void {
    const g = getGoal(this.store.db, goalId);
    const c = g?.delivery.cleanup;
    if (this.stopped || this.tidying.has(goalId) || this.deliveringArtifacts.has(goalId) || !c?.waiting || c.done || g!.delivery.outcome !== 'merged' || !['done', 'over_delivered'].includes(g!.state)) return;
    const run = afterMerge(this, goalId, { afterDelivery: true })
      .catch(() => {})
      .finally(() => this.tidying.delete(goalId));
    this.tidying.set(goalId, run);
  }

  private streamListeners = new Set<StreamListener>();
  private escalationListeners = new Set<(e: Escalation) => void>();
  private inFlight = new Map<string, InFlight>();
  private chains = new Map<string, Promise<void>>();
  private pendingTick = new Set<string>();
  readonly clarifying = new Set<string>();
  /** tasks already noted as waiting for an overlapping task (one note each, not one per tick) */
  readonly overlapNoted = new Set<string>();
  /** ready tasks the person started with Start now: the next scheduling pass starts them past slots, running alone and shared files */
  readonly forceStart = new Set<string>();
  /** goals whose final walkthrough (every milestone script once all tasks are done) is running */
  readonly finalWalking = new Set<string>();
  /** goals whose audit (ponytail-audit on the finished branch) is running */
  readonly auditing = new Set<string>();
  /** goals whose browser QA (the finished app tried in Chromium) is running */
  readonly qaing = new Set<string>();
  /** what the browser QA needs from outside its session (the browser, the preview); tests replace it */
  qaDeps: QaDeps = defaultQaDeps;
  /** goals whose references REA is investigating */
  readonly investigating = new Set<string>();
  /** goals whose Brief a second opinion is being written for (ADR-0051) */
  readonly secondOpinions = new Set<string>();
  /** goal tasks whose Delegated goal is landing on the goal branch now, with the landing (delegation.ts); stop() waits for them */
  readonly landingDelegations = new Map<string, Promise<void>>();
  /** Delegated goals whose Brief the engine is approving now, with the approval; stop() waits for them */
  readonly approvingDelegated = new Map<string, Promise<void>>();
  /** sessions run for a goal outside a task (the audit, an investigation): killed with the goal's in-flight sessions */
  readonly background = new Map<string, Set<RunHandle>>();
  /** remember a background session until it ends, so cancelling the goal or stopping Foundry kills it too */
  trackBackground(goalId: string, handle: RunHandle): () => void {
    let set = this.background.get(goalId);
    if (!set) this.background.set(goalId, (set = new Set()));
    set.add(handle);
    return () => {
      set.delete(handle);
      if (!set.size) this.background.delete(goalId);
    };
  }
  get isStopped(): boolean {
    return this.stopped;
  }
  /** a scripted milestone whose script still fails after its repair: the goal pauses at it once no task is in flight */
  readonly pauseDue = new Map<string, string>();
  /** consecutive engine-side crashes per task (reset when an attempt runs) */
  readonly engineCrashes = new Map<string, number>();
  /** must checks already failing on a goal-branch commit (merges are judged on regressions only) */
  readonly baseline = new BaselineChecks(this);
  private reviewing = new Set<string>();
  private ownedSessionIds = new Set<string>();
  private rateLimitedUntil = new Map<AgentProvider, number>();
  private resumeTimers = new Map<AgentProvider, ReturnType<typeof setTimeout>>();

  readonly settings: SettingsStore;
  /** Memory (ADR-0072): a Hindsight server the person runs remembers what a folder's goals did and taught; nothing while unset */
  readonly memory: Memory;
  /** test seam: a fake server behind Memory, and timeouts a test can wait for */
  memoryDeps: MemoryDeps = {};
  /** pushes escalations / goal endings / delivery results / usage pauses to Telegram & Discord (Settings → Notifications) */
  readonly notifications: NotificationDispatcher;
  /** Telegram's buttons and replies: reads the bot's updates while the engine serves (ADR-0038) */
  readonly telegram: TelegramBot;
  /** Discord's buttons and forms: a bot beside the webhook, read over the gateway while the engine serves (ADR-0039) */
  readonly discord: DiscordBot;
  /** version self-knowledge, the daily update check, and the self-update pipeline (ADR-0010) */
  readonly updater: UpdateManager;
  /** dev servers started in progress folders (Goal page, milestones, integrations) */
  readonly preview: PreviewManager;
  /** this computer on the person's tailnet: links that open on their phone */
  readonly tailnet: Tailnet;
  /** VS Code in the browser, for reading a repository or a goal's folder from any device */
  readonly codeServer: CodeServer;
  /** self-update drain: no new sessions start; in-flight work finishes (mirror of the rate-limit gate) */
  private updateDraining = false;
  private minimax: { quota: MinimaxQuota; at: number } | null = null;
  private minimaxRun: Promise<MinimaxQuota> | null = null;
  /** Foundry's mmx config holds the current key: only then are sessions pointed at it */
  private mmxReady = false;
  /** what this machine has learned about model names (requested → resolved id, last ok/fail) */
  readonly models: ModelRegistry;
  readonly providerModels: Record<AgentProvider, ModelRegistry>;
  /** autoskills runs in progress, per goal (tasks wait for them before their first attempt) */
  private autoskillsRuns = new Map<string, Promise<void>>();
  /** test seam: deps handed to runAutoskills (fake npx / node version) */
  autoskillsDeps: AutoskillsDeps = {};
  /** test seam: deps handed to runGraphRefresh (fake which/exec) */
  graphRefreshDeps: GraphRefreshDeps = {};
  /** how a host's CLI is run for Deploy (ADR-0041); tests point it at stand-ins */
  deployCli: (p: DeployProvider) => string[] = npxCli;

  constructor(
    public readonly config: EngineConfig,
    runner?: ClaudeRunner | Partial<Record<AgentProvider, ClaudeRunner>>,
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
    this.access = new Access(config.dataDir);
    this.store = new EventStore(openDatabase(join(config.dataDir, 'engine.db')));
    for (const row of this.store.db.query("SELECT DISTINCT json_extract(payload, '$.sessionId') AS id FROM events WHERE type = 'session.usage'").all() as { id: string | null }[]) {
      if (row.id) this.ownedSessionIds.add(row.id);
    }
    // Freeze the owner of old goals before either backend may create new work in this store.
    for (const goal of listGoals(this.store.db)) if (!goal.provider) this.store.append({ type: 'goal.provider_assigned', goalId: goal.id, payload: { provider: config.provider } });
    this.providerModels = {
      claude: new ModelRegistry(config.provider === 'claude' ? config.dataDir : join(config.dataDir, 'providers', 'claude'), 'claude'),
      codex: new ModelRegistry(config.provider === 'codex' ? config.dataDir : join(config.dataDir, 'providers', 'codex'), 'codex'),
      agy: new ModelRegistry(config.provider === 'agy' ? config.dataDir : join(config.dataDir, 'providers', 'agy'), 'agy'),
    };
    this.models = this.providerModels[config.provider];
    const env = () => ({ ...claudeConfigEnv(config.claudeHome), FOUNDRY_CALLBACK: `http://${config.host}:${config.port}`, ...this.sessionEnvExtra() });
    const supplied = (provider: AgentProvider) => runner && ('run' in runner ? runner : runner[provider]);
    const sessionCosts = new SessionCosts(config.dataDir);
    const wrap = (inner: ClaudeRunner, provider: AgentProvider) => {
      const checked: ClaudeRunner & { killAll: () => number } = {
        active: () => inner.active(),
        setMaxConcurrent: (n) => inner.setMaxConcurrent?.(n),
        killAll: () => (inner as { killAll?: () => number }).killAll?.() ?? 0,
        run: async (spec) => {
          if (provider === 'codex') this.validateCodexChoice(spec.model, spec.effort);
          const suite = await this.suiteFor(spec, provider);
          // the current account of the coding agent runs the session; an added one in its own home (ADR-0065), where
          // Claude Code finds no user-scope MCP servers of the native sign-in unless handed them
          const account = isPooled(provider) ? this.accountPool.forRun(provider) : null;
          const home = account?.home ? { configHome: account.home, ...(provider === 'claude' && !spec.strictMcp ? { mcpConfig: this.nativeMcpServers() } : {}) } : {};
          const full = { ...spec, ...suite, ...home, env: { ...this.mediaEnv(spec.cwd, spec.meta?.goalId ?? null), ...spec.env } };
          // Claude Code reports a resumed session's whole cost; Codex reports none worth correcting
          const handle = await (provider === 'claude' ? sessionCosts.run(full, (s) => inner.run(s)) : inner.run(full));
          return account ? { ...handle, result: handle.result.then((r) => ({ ...r, accountId: account.id })) } : handle;
        },
      };
      const fallback = new ModelFallbackRunner(checked, {
        // Antigravity has no fallback order: its CLI refuses an unknown model outright
        fallbacks: (spec) => provider === 'codex' ? (spec.meta?.goalId ? this.mustGoal(spec.meta.goalId).codexFallbacks ?? [] : config.codexFallbacks) : provider === 'agy' ? [] : config.modelFallbacks,
        registry: this.providerModels[provider],
        log: config.log,
        onFallback: ({ spec, from, to, reason }) => {
          const goalId = spec.meta?.goalId ?? null;
          this.store.append({ type: 'goal.models_changed', goalId, payload: { tier: null, from, to, reason } });
        },
      });
      return new EffortRunner(fallback, () => this.store.db, () => (provider === 'codex' ? null : provider === 'agy' ? this.config.agyEffort : this.config.effort));
    };
    this.runner = new ProviderRunner({
      claude: wrap(supplied('claude') ?? new ClaudeCliRunner({ claudeBin: config.claudeBin, claudeHome: config.claudeHome, maxConcurrent: config.maxConcurrent, env, log: config.log }), 'claude'),
      codex: wrap(supplied('codex') ?? new CodexCliRunner({ codexBin: config.codexBin, codexHome: config.codexHome, maxConcurrent: config.maxConcurrent, env, log: config.log }), 'codex'),
      agy: wrap(supplied('agy') ?? new AgyCliRunner({ agyBin: config.agyBin, maxConcurrent: config.maxConcurrent, env, log: config.log }), 'agy'),
    }, (spec) => {
      if (spec.meta?.goalId) return this.mustGoal(spec.meta.goalId).provider ?? config.provider;
      const named = AgentProvider.safeParse(spec.meta?.provider);
      return named.success ? named.data : config.provider;
    }, config.maxConcurrent);
    this.roles = new Roles(config.rolesDir);
    const makeSkills = (provider: AgentProvider) => new SkillsManager({
      provider, codexBin: config.codexBin, codexHome: config.codexHome, agyBin: config.agyBin,
      // Antigravity reads skills only from a workspace's .agents/skills: its store is the shared ~/.agents/skills, linked in per goal
      claudeHome: provider === 'codex' ? config.codexHome : provider === 'agy' ? join(homedir(), '.agents') : config.claudeHome,
      claudeSkillsDir: provider !== 'claude' ? join(config.claudeHome, 'skills') : undefined,
      dataDir: provider === config.provider ? config.dataDir : join(config.dataDir, 'providers', provider),
      catalogPath: config.catalogPath,
      // one store for both coding agents: a suite's copy is the same plugin either way
      suitesDir: join(config.dataDir, 'suites'),
      claudeBin: config.claudeBin,
      log: config.log,
      // user skills only load when user settings are in scope
      hintsEnabled: () => provider === 'codex' || !config.settingSources || config.settingSources.includes('user'),
      workflowProfile: () => config.workflowProfile ?? 'mattpocock',
      // one choice per suite for every coding agent: a Move on any of their pages is saved in Settings
      suiteReleases: () => config.suiteReleases ?? {},
      onSuiteRelease: (id, ref) => {
        const { [id]: _, ...rest } = config.suiteReleases ?? {};
        this.updateSettings({ workflow: { suiteReleases: ref ? { ...rest, [id]: ref } : rest } });
      },
      packs: () => ({ design: config.designPack, image: config.imagePack, video: config.videoPack }),
      // a plugin that ships MCP servers (text-to-cad's `cad`) is allowed for sessions as soon as it is installed, under the prefix this coding agent gives it
      onPluginServers: (prefixes) => {
        if (provider !== 'agy') for (const p of prefixes) this.mcpFor(provider).allow(p, true);
      },
      sessionEnv: () => this.sessionEnvExtra(),
      gates: () => ({ desktopApps: this.config.desktopApps }),
      // a cad goal that waited for text-to-cad goes on to Clarify once the plugin is in
      onPluginInstalled: () => this.pluginInstalled(provider),
      // mmx signed in with `mmx auth login` needs no key from Foundry
      // `||`, not `??`: an empty variable in the engine's environment must not hide a key from Settings
      envProbe: (name) => !!(process.env[name] || this.sessionEnvExtra()[name]) || (name === 'MINIMAX_API_KEY' && mmxSignedIn()),
      // every updater run is an audit event (goalId null, informational)
      onRun: (run) => this.store.append({ type: 'skills.update_run', goalId: null, payload: { provider, sourceId: run.sourceId, updater: run.updater, command: run.command, cwd: run.cwd, exitCode: run.exitCode, durationMs: run.durationMs, outputTail: run.outputTail, changed: run.changed, error: run.error } }),
      // which skills Claude sessions invoked; Codex reports none
      usage: provider === 'claude' ? (installed, limit) => skillUsage({
        installed, limit,
        goals: listGoals(this.store.db).filter((g) => (g.provider ?? 'claude') === 'claude'),
        events: (goalId) => this.store.listByGoalOfTypes(goalId, ['session.usage', 'attempt.finished', 'attempt.started', 'attempt.session']),
      }) : undefined,
    });
    this.providerSkills = { claude: makeSkills('claude'), codex: makeSkills('codex'), agy: makeSkills('agy') };
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
    this.agyQuota = new AgyQuotaReader({ bin: () => config.agyBin ?? Bun.which('agy') });
    this.accounts = {
      claude: new ClaudeAuth({ provider: 'claude', claudeHome: config.claudeHome, claudeBin: () => config.claudeBin ?? Bun.which('claude'), log: config.log }),
      codex: new ClaudeAuth({ provider: 'codex', claudeBin: () => config.codexBin ?? Bun.which('codex'), codexHome: config.codexHome, log: config.log }),
      agy: new ClaudeAuth({ provider: 'agy', claudeBin: () => config.agyBin ?? Bun.which('agy'), log: config.log }),
    };
    this.accounts.codex.onLoginUpdate(() => { this.codexQuota.invalidate(); this.codexPlugins.invalidate(); });
    this.accountPool = new AccountPool({
      store: this.store,
      dataDir: config.dataDir,
      nativeHome: (p) => (p === 'codex' ? config.codexHome : config.claudeHome),
      bin: (p) => (p === 'codex' ? config.codexBin ?? Bun.which('codex') : config.claudeBin ?? Bun.which('claude')),
      nativeAuth: (p) => this.accounts[p],
      autoSwitch: (p) => this.config.autoSwitch[p],
      log: config.log,
    });
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
    this.memory = new Memory(this);
    this.store.subscribe((e) => {
      if (e.type === 'session.usage' && e.payload.sessionId) this.ownedSessionIds.add(e.payload.sessionId);
      // a goal that ended teaches its folder something (ADR-0040)
      if (e.type === 'goal.state_changed') learnOnEnd(this, e.goalId, e.payload.to);
      // what a goal did, decided, was refused and wrote goes into the folder's Memory (ADR-0072); nothing while it is off
      this.memory.onEvent(e);
      // the notebook changed: the folder's exported skill follows (ADR-0050)
      // the everywhere notebook is in every folder's exported skill (ADR-0055): a change of it rewrites them all
      if (e.type === 'learnings.set') for (const r of e.payload.repoPath === LEARNINGS_EVERYWHERE ? listRepoLearnings(this.store.db).map((x) => x.repoPath).filter((x) => x !== LEARNINGS_EVERYWHERE) : [e.payload.repoPath]) void exportLearningsSkill(this, r);
      // a Brief ready for a person's approval gets a second opinion when Settings say so (ADR-0051)
      if (e.type === 'goal.state_changed' && e.payload.to === 'awaiting_brief_approval' && e.payload.reason !== 'auto brief' && e.goalId) secondOpinionOnBrief(this, e.goalId);
      if ((e.type === 'task.artifacts_landed' || e.type === 'goal.artifacts_delivered') && e.goalId) this.cadModelMemo.delete(e.goalId);
      // a milestone recorded in a goal with Subject pictures: the Likeness review compares the two (in the background)
      if (e.type === 'milestone.evidence') onMilestoneEvidence(this, e);
      if (e.goalId) this.tick(e.goalId);
      // a Delegated goal's progress is its main goal's business: what it costs counts there, and its state moves the main goal on
      if (e.goalId && PARENT_TICK_EVENTS.has(e.type)) {
        const g = getGoal(this.store.db, e.goalId);
        const main = g?.delegatedFrom ? getGoal(this.store.db, g.delegatedFrom.goalId) : null;
        if (g && main) {
          if (e.type === 'goal.cost_added') this.store.append({ type: 'goal.cost_added', goalId: main.id, payload: { costUsd: e.payload.costUsd, source: `delegated:${g.id}` } });
          this.tick(main.id);
        }
      }
    });
    this.notifications = new NotificationDispatcher(this);
    this.notifications.attach();
    this.telegram = new TelegramBot(this);
    this.discord = new DiscordBot(this);
    this.updater = new UpdateManager(this);
    this.tailnet = new Tailnet({ mode: () => this.settings.values().notifications.tailscale, host: () => this.settings.values().notifications.tailscaleHost, log: config.log, bin: config.tailscaleBin, stateFile: join(config.dataDir, 'tailnet-served.json') });
    void this.tailnet.cleanUp();
    this.codeServer = new CodeServer({ dataDir: config.dataDir, expose: (p) => this.tailnet.expose(p), unexpose: (p) => this.tailnet.unexpose(p), log: config.log, ...(process.env.NODE_ENV === 'test' ? { bin: null } : {}) });
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

  /**
   * Where image tools a person installed save their files (the media-pipeline plugin writes to ./generated-images of the
   * session's folder by default, as soon as it starts): artifacts/ of an image or video goal's folder, which stays out
   * of git, else Foundry's own folder beside the progress folder, so other goals are not left with generated-images/.
   */
  mediaEnv(cwd: string, goalId: string | null): Record<string, string> {
    const goal = goalId ? getGoal(this.store.db, goalId) : null;
    if (goal && MEDIA_NATURES.includes(goal.nature)) return { IMAGE_OUTPUT_DIR: join(cwd, ARTIFACTS_DIR) };
    const own = goal ? (internalWorkspaceDir(goal) ?? join(this.config.dataDir, 'worktrees', goal.id)) : this.config.dataDir;
    return { IMAGE_OUTPUT_DIR: join(own, 'media') };
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
      // Memory's bearer token for Codex, whose HTTP MCP servers read it from the environment (ADR-0072)
      ...memorySessionEnv(this.settings.values().memory),
      // text-to-cad's cadgen: no usage stats and no update check from Foundry's own processes (the person's setting stays theirs)
      CADGEN_TELEMETRY: '0',
      CADGEN_UPDATE_CHECK: '0',
      // Settings → Safety → Desktop apps & printers: off = the boundary hook refuses the openers, the slicers' windows and the gated skills
      ...(this.config.desktopApps ? {} : this.desktopGateEnv()),
    };
  }

  /** what the boundary hook needs while the switch is off: the openers, the slicers' programs with their headless switches, and the gated skills as ERE alternatives */
  private desktopGateEnv(): Record<string, string> {
    const denied = this.gatedSkills('desktopApps').map((n) => n.replace(/[^\w-]/g, '\\$&'));
    return { FOUNDRY_DESKTOP_PATTERNS: DESKTOP_APPS_PATTERNS, FOUNDRY_SLICER_PATTERNS: SLICER_APP_PATTERNS, FOUNDRY_HEADLESS_PATTERNS: SLICER_HEADLESS_PATTERNS, ...(denied.length ? { FOUNDRY_DENIED_SKILLS: denied.join('|') } : {}) };
  }

  /**
   * text-to-cad's viewer as a preview app of a cad goal, started by the person from the milestone or preview card: the
   * plugin's own pinned cadgen command with `viewer` in place of `mcp`, on a preview port. Null without the plugin.
   */
  cadViewerApp(goal: Goal): BriefApp | null {
    if (goal.nature !== 'cad') return null;
    const server = this.skillsFor(goal).pluginServerCommand('text-to-cad', 'cad');
    if (!server) return null;
    // quoted for the preview manager's `sh -lc` where needed; the usual tokens stay bare, so the command reads well and {port} is substituted
    const q = (a: string) => (/^[\w./:=@%+{}-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
    // the viewer opens a model named by its absolute path (`?file=`, with / and : kept, as cadgen's own links do)
    const model = this.cadModel(goal);
    const file = model ? `/?file=${encodeURIComponent(model).replace(/%2F/gi, '/').replace(/%3A/gi, ':')}` : '';
    return { key: CAD_VIEWER_KEY, name: 'CAD Viewer', dir: '', install: null, command: [server.command, ...serverBaseArgs(server.args), 'viewer', '--port', '{port}'].map(q).join(' '), url: `http://localhost:{port}${file}`, platform: 'web' };
  }

  /**
   * The model the CAD Viewer opens on (cadModelIn): from the goal's workspace while it runs, from the output folder
   * once delivered. Null = the viewer's home. Every status poll of the preview asks, so the answer is kept for 10 s and
   * dropped when a landing or a delivery changes the goal's files.
   */
  cadModel(goal: Goal): string | null {
    const hit = this.cadModelMemo.get(goal.id);
    if (hit && Date.now() - hit.at < 10_000) return hit.value;
    const value = this.findCadModel(goal);
    this.cadModelMemo.set(goal.id, { at: Date.now(), value });
    return value;
  }
  private cadModelMemo = new Map<string, { at: number; value: string | null }>();
  private findCadModel(goal: Goal): string | null {
    const ws = goalWorkspacePath(this.config.dataDir, goal);
    const live = cadModelIn(join(ws, ARTIFACTS_DIR), listArtifacts(ws));
    if (live) return join(ws, ARTIFACTS_DIR, live);
    const run = goal.completion.artifactsRun;
    if (run?.status !== 'ok' || !run.dest) return null;
    // recorded at delivery, so the output folder (a network share, perhaps) is not searched; older deliveries did not record it
    const model = run.model === undefined ? cadModelIn(run.dest, run.files) : run.model;
    return model ? join(run.dest, model) : null;
  }

  /** text-to-cad installed: the bundle's `cad` entry satisfied for a coding agent */
  private static cadInstalled = (s: { entry: { bundle?: string | null; name: string }; status: string }) => s.entry.bundle === 'text-to-cad' && s.entry.name === 'cad' && (SATISFIED as readonly string[]).includes(s.status);
  /** the answer per coding agent and repository, good for 10 s: a waiting goal's ticks and the pages' polls must not rescan the skills tree every time */
  private cadMemo = new Map<string, { at: number; value: boolean }>();

  /** text-to-cad installed for this goal's provider: the cad nature can be offered, classified and planned */
  async cadAvailable(goal: Pick<Goal, 'provider' | 'repoPath'>): Promise<boolean> {
    const provider = goal.provider ?? this.config.provider;
    const key = `${provider}:${goal.repoPath}`;
    const hit = this.cadMemo.get(key);
    if (hit && Date.now() - hit.at < 10_000) return hit.value;
    const statuses = await this.providerSkills[provider].status(goal.repoPath).catch(() => []);
    const value = statuses.some(Engine.cadInstalled);
    this.cadMemo.set(key, { at: Date.now(), value });
    return value;
  }

  /**
   * What the New goal form and a waiting goal's page ask: the plugin and uv, for a coding agent. A cad goal waiting for
   * the plugin goes on when it turned up (installed by hand, say): the page asks while it waits.
   */
  async cadStatus(provider: AgentProvider): Promise<{ installed: boolean; uv: boolean }> {
    const installed = await this.cadAvailable({ provider, repoPath: '' });
    if (installed) for (const id of this.cadWaiting) {
      const g = getGoal(this.store.db, id);
      if (g && (g.provider ?? this.config.provider) === provider) void this.tick(id);
    }
    return { installed, uv: !!(Bun.which('uvx') ?? Bun.which('uv')) };
  }

  /** a plugin was installed for this coding agent: forget what was known, and let the cad goals waiting for it go on to Clarify */
  pluginInstalled(provider: AgentProvider): void {
    this.cadMemo.clear();
    for (const g of listGoals(this.store.db)) if (g.state === 'clarifying' && g.nature === 'cad' && (g.provider ?? this.config.provider) === provider) void this.tick(g.id);
  }

  /** catalog skills behind a Settings switch (text-to-cad's Bambu hand-off), by name */
  gatedSkills(gate: 'desktopApps'): string[] {
    try {
      return this.skills.catalog().entries.filter((e) => e.gate === gate).map((e) => e.name);
    } catch {
      return [];
    }
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
  /**
   * Settings sections taken from another Foundry (Transfer, ADR-0030): each chosen section becomes what it saved there,
   * this computer's own leaves and the credentials stay; validated and hot-applied like any change.
   */
  replaceSettingsSections(imported: SettingsPatch, sections: (keyof SettingsPatch)[]): string[] {
    if (sections.includes('models')) {
      const models = { ...this.settings.values().models, ...(imported.models ?? {}) };
      const presets = effectiveCodexPresets(models.codexPresets);
      for (const id of [models.codexPresetCode, models.codexPresetDocs, models.codexPresetMedia]) {
        if (!presets[id]) throw new SettingsError(`Unknown Codex preset: ${id}`);
      }
    }
    const { changed } = this.settings.replaceSections(imported, sections.filter((s) => s !== 'engine'));
    this.applySettingsChange(changed);
    return changed;
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
    if (changed.includes('workflow.learningsSkill')) for (const r of listRepoLearnings(this.store.db)) if (r.repoPath !== LEARNINGS_EVERYWHERE) void exportLearningsSkill(this, r.repoPath);
    if (changed.includes('tools.minimaxApiKey')) {
      this.mmxReady = writeMmxConfig(this.config.dataDir, this.minimaxKey(), this.config.log);
      // the quota belongs to the old key
      this.minimax = null;
    }
    // keys feed the skills env probe ("key missing" warnings) — refresh the cached statuses right away
    if (changed.some((k) => /^tools\.\w+(ApiKey|BaseUrl)$/.test(k))) Object.values(this.providerSkills).forEach((skills) => skills.hints.invalidate());
    // another server, another token, or a folder left out: Memory connects anew and makes its banks ready again (ADR-0072)
    if (changed.some((k) => k.startsWith('memory.'))) this.memory.reconfigure();
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
      if ((goal.provider ?? 'claude') !== 'claude' || isHistory(goal)) continue;
      if (['done', 'over_delivered', 'failed', 'cancelled'].includes(goal.state)) continue;
      for (const tier of ['strong', 'worker', 'cheap'] as const) {
        const to = this.config.models[tier];
        if (goal.models[tier] === to || goal.models[tier] !== before[tier]) continue;
        this.store.append({ type: 'goal.models_changed', goalId: goal.id, payload: { tier, from: before[tier], to, reason: 'settings changed' } });
      }
    }
  }

  /** the human answered the open interview round (finish = write the Brief with what there is); the session continues in the background */
  answerInterview(goalId: string, answers: Record<string, string>, finish = false, note: string | null = null): void {
    answerInterview(this, this.mustGoal(goalId), answers, finish, note);
  }

  /** switch a goal's headless self-check; turning it on creates its goal-level must check right away */
  setSelfCheck(goalId: string, on: boolean): void {
    const goal = this.mustGoal(goalId);
    if (goal.selfCheck === on) return;
    this.store.append({ type: 'goal.selfcheck_set', goalId, payload: { on } });
    // before approval only the choice is recorded: approving the Brief creates the check with the others
    if (on && !['draft', 'clarifying', 'awaiting_brief_approval'].includes(goal.state)) ensureSelfCheck(this, getGoal(this.store.db, goalId)!);
  }

  /** switch whether a goal pauses at its milestones ("Have a look"); applies from its next milestone */
  setMilestonePause(goalId: string, on: boolean): void {
    if (this.mustGoal(goalId).milestonePause === on) return;
    this.store.append({ type: 'goal.milestone_pause_set', goalId, payload: { on } });
  }

  /** run the investigation of a goal's references in the background, once at a time; the tick goes on when it ends */
  private startInvestigation(goal: Goal): void {
    if (this.investigating.has(goal.id)) return;
    this.investigating.add(goal.id);
    void runInvestigation(this, goal)
      .catch((err) => this.config.log(`[investigate] ${goal.id}: ${String((err as Error).message ?? err)}`))
      .finally(() => {
        this.investigating.delete(goal.id);
        this.tick(goal.id);
      });
  }

  /**
   * Study the goal's references again (a changed target, a new look): the report is replaced; the Brief changes only
   * with Re-run Clarify. Possible until the Brief is approved.
   */
  investigate(goalId: string): void {
    const goal = this.mustGoal(goalId);
    if (!goal.references.length) throw new Error('this goal has no reference to investigate');
    if (!['draft', 'clarifying', 'awaiting_brief_approval'].includes(goal.state)) throw new Error(`the goal is ${goal.state}; its references can be investigated again until the Brief is approved`);
    if (this.investigating.has(goalId)) throw new Error('the references are being investigated now; wait for the report');
    this.store.append({ type: 'goal.investigation_requested', goalId, payload: {} });
    this.startInvestigation(getGoal(this.store.db, goalId)!);
  }

  /** switch Ponytail (the lazy senior dev) on or off for a goal; applies from its next session */
  setPonytail(goalId: string, on: boolean): void {
    if ((this.mustGoal(goalId).workflow.ponytail === 'on') === on) return;
    this.store.append({ type: 'goal.ponytail_set', goalId, payload: { on } });
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
    // a Delegated goal starts from its main goal's branch, which lives here: nothing to fetch
    const s = await fetchBase(goal.repoPath, goal.baseBranch, { fetch: this.config.sync.fetchBeforeGoal && !goal.delegatedFrom, ...(goal.delegatedFrom ? { remote: null } : {}) });
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
    // the investigation session works in the worktree this discards
    if (this.investigating.has(goalId)) throw new Error('the references are being investigated now; re-run Clarify when the report is in');
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
    // the references are studied again before the new Brief
    if (goal.references.length) this.store.append({ type: 'goal.investigation_requested', goalId, payload: {} });
    this.store.append({ type: 'goal.reclarified', goalId, payload: { reason, workspaceRebuilt: rebuilt, decisions } });
    this.store.append({ type: 'goal.state_changed', goalId, payload: { from: 'awaiting_brief_approval', to: 'clarifying', reason: `re-run clarify: ${reason}` } });
  }

  /** Between tasks (nothing running): fetch again and merge a moved base into the goal branch. Off unless `sync.refreshBetweenTasks`. */
  async refreshBase(goal: Goal): Promise<void> {
    // a Delegated goal's base is the main goal's branch, here: nothing upstream to bring in
    if (!this.config.sync.refreshBetweenTasks || goal.delegatedFrom) return;
    const s = await fetchBase(goal.repoPath, goal.baseBranch);
    if (!s.remote || !s.remoteRef) return;
    const ws = goalWorkspacePath(this.config.dataDir, goal);
    const ref = `${s.remote}/${s.base}`;
    if ((await git(['merge-base', '--is-ancestor', ref, 'HEAD'], ws)).code === 0) return;
    const now = new Date().toISOString();
    const task: Task = { id: newId(IdPrefix.task), goalId: goal.id, title: `sync ${goal.branch} with ${ref}`, spec: `${ref} moved while this goal was running. Merge it into ${goal.branch} so the remaining tasks build on the current base.`, kind: 'chore', scope: 'sync', scenario: 'general', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: false, retryBudget: 2, origin: 'merge', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard' as const, state: 'merging', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: now, updatedAt: now };
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
    this.reconciling = true;
    try {
      await this.reconcile();
    } finally {
      this.reconciling = false;
    }
    await relocateLegacyWorkspaces(this);
    this.migrateModelTiersToPresets();
    void this.syncModelsIfCliChanged();
    this.preview.startSweeper();
    // pull requests merged or closed on GitHub after their delivery finished (ADR-0015)
    this.prWatchTimer = setInterval(() => {
      if (!this.stopped) void checkOpenPrs(this).catch((err) => this.config.log(`[delivery] the PR watch failed: ${String((err as Error).message ?? err)}`));
    }, this.config.delivery.prWatchMs);
    this.prWatchTimer.unref?.();
    // background loops log what goes wrong: an unhandled rejection here would end the server
    void checkOpenPrs(this).catch((err) => this.config.log(`[delivery] the PR watch failed: ${String((err as Error).message ?? err)}`));
    // schedules that are due (ADR-0054): every minute, and once now (a run missed while the engine was off fires once)
    this.scheduleTimer = setInterval(() => {
      if (!this.stopped) void checkSchedules(this).catch((err) => this.config.log(`[schedules] the check failed: ${String((err as Error).message ?? err)}`));
    }, 60_000);
    this.scheduleTimer.unref?.();
    void checkSchedules(this).catch((err) => this.config.log(`[schedules] the check failed: ${String((err as Error).message ?? err)}`));
    this.telegram.start();
    this.discord.start();
    for (const g of listGoals(this.store.db)) this.tick(g.id);
  }

  private prWatchTimer: ReturnType<typeof setInterval> | null = null;
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  /** start() is putting right what the last run left (orphaned attempts, overlays): no goal runs meanwhile */
  private reconciling = false;
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

  /**
   * "Fix review comments" on one PR (ADR-0053): read it on GitHub now, then address its waiting round whatever the
   * budget. Throws when the PR has no review comments waiting.
   */
  async requestReviewFix(goalId: string, prNumber: number): Promise<void> {
    const goal = this.mustGoal(goalId);
    if (goal.delivery.status === 'running') throw new Error('a delivery is running: the comments are picked up by it, or by the next look once it ends');
    await recheckPr(this, goalId, prNumber);
    const fresh = getGoal(this.store.db, goalId)!;
    const round = fresh.delivery.reviews.filter((r) => r.prNumber === prNumber && r.status === 'pending').at(-1);
    if (!round) throw new Error(`no review comments are waiting on PR #${prNumber}`);
    if (!round.requested) this.store.append({ type: 'delivery.review_requested', goalId, payload: { roundId: round.id } });
    await startReviewRun(this, goalId, `${round.comments.length} review comment(s) on PR #${prNumber}, asked for`);
  }

  /** "Re-check" on one PR: read it on GitHub now; a passing PR of a stopped delivery carries on with the delivery */
  async recheckDeliveryPr(goalId: string, prNumber: number): Promise<void> {
    this.mustGoal(goalId);
    const state = await recheckPr(this, goalId, prNumber);
    const d = getGoal(this.store.db, goalId)!.delivery;
    if (d.status === 'failed' && (state === 'passing' || state === 'none')) await this.retryDelivery(goalId);
  }

  private rerunning = new Set<string>();
  /** goals whose docs are being written after the goal turned done: their delivery and graph refresh wait for them */
  private documenting = new Set<string>();

  /**
   * Write a goal's docs when it finished without the goal review that normally writes them (the human accepted it as
   * is). Call it before the goal turns done: the done tick holds the delivery and the graph refresh until this ends,
   * so the docs commit still ships with the code.
   */
  documentBeforeDelivery(goal: Goal): void {
    if (!goal.completion.docs.length || goal.completion.docsRun || this.documenting.has(goal.id)) return;
    this.documenting.add(goal.id);
    void runDocsGeneration(this, goal)
      .catch((err) => this.store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `docs generation crashed: ${String(err)}` } }))
      .finally(() => {
        this.documenting.delete(goal.id);
        this.tick(goal.id);
      });
  }

  /**
   * "Re-run" on the Completion card: the graph refresh again, or docs generation when it never ran, failed or wrote
   * nothing. Runs in the background; the card shows the new result. A new docs commit lands on the goal branch, so a
   * delivered goal ships it with Resume delivery; once the work merged and the folder is gone, the docs get a branch and
   * a pull request of their own.
   */
  rerunCompletion(goalId: string, what: 'docs' | 'graph'): void {
    const g = this.mustGoal(goalId);
    if (g.state !== 'done' && g.state !== 'over_delivered') throw new Error('completion actions run once the goal is done');
    const key = `${goalId}:${what}`;
    if (this.rerunning.has(key) || (what === 'graph' && this.completing.has(goalId)) || (what === 'docs' && this.documenting.has(goalId))) throw new Error(`the ${what === 'docs' ? 'docs generation' : 'graph refresh'} is already running`);
    let job: Promise<void>;
    if (what === 'graph') {
      if (!g.completion.graphRefresh) throw new Error('this goal has no graph refresh');
      job = runGraphRefresh(this, g, this.graphRefreshDeps);
    } else {
      if (!g.completion.docs.length) throw new Error('this goal generates no docs');
      if (g.completion.docsRun?.status === 'ok') throw new Error('the docs were written and committed; edit them in the goal branch instead');
      if (g.delivery.status === 'running') throw new Error('a delivery is running — wait for it, or cancel it first');
      // the folder is cleaned up only after a merge: the docs then go out on a branch and pull request of their own
      const gone = !existsSync(goalWorkspacePath(this.config.dataDir, g));
      if (gone && g.delivery.outcome !== 'merged') throw new Error("the goal's folder is missing, so there is nowhere to write the docs");
      job = gone ? runDocsAfterMerge(this, g) : runDocsGeneration(this, g, { rerun: true });
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
    // no press from a chat starts work on an engine going down
    await Promise.all([this.telegram.stop(), this.discord.stop()]);
    this.updater.stopSchedule();
    if (this.prWatchTimer) clearInterval(this.prWatchTimer);
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    for (const timer of this.resumeTimers.values()) clearTimeout(timer);
    this.resumeTimers.clear();
    for (const account of Object.values(this.accounts)) account.cancelLogin();
    this.mcp.login.cancel();
    this.codexQuota.invalidate();
    await Promise.all([this.codexMcp.stop(), this.codexPlugins.stop(), Promise.allSettled([...this.modelDiscoveries])]);
    this.agents.stop();
    this.preview.stopSweeper();
    await this.preview.stopAll('engine shutdown');
    await this.codeServer.dispose();
    await this.tailnet.unexposeAll();
    for (const [, f] of this.inFlight) f.handle?.kill('killed_manual');
    for (const set of this.background.values()) for (const h of set) h.kill('killed_manual');
    // reviews, clarify, merges and probes are not in `inFlight`: kill every child the runner still owns
    const n = (this.runner as { killAll?: () => number }).killAll?.() ?? 0;
    if (n) this.config.log(`[engine] stopped ${n} agent session(s) on shutdown`);
    // drain what is already in flight (bounded): a tick writing to a database the caller is about to delete
    // was the source of cross-file test flakes
    const t0 = Date.now();
    while (this.busy().total > 0 && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 25));
    await Promise.allSettled([...this.chains.values()]);
    // milestone recordings write their evidence when they finish: wait for them too (a script is killed by its timeout),
    // and an artifact delivery records where its files went; both bounded, and no timer outlives the wait
    const settle = async (work: Promise<unknown>[], ms: number) => {
      if (!work.length) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.allSettled(work), new Promise((r) => (timer = setTimeout(r, ms)))]);
      clearTimeout(timer);
    };
    await settle(milestoneQueues(), 5000);
    await settle([...this.deliveringArtifacts.values(), ...this.tidying.values()], 10_000);
    // a Delegated goal landing on its main goal's branch, or its Brief being approved by the engine, write to the database too
    await settle([...this.landingDelegations.values(), ...this.approvingDelegated.values()], 10_000);
    // a learning session writes the folder's notebook when it ends (its session was killed above)
    await settle(learningWork(), 5_000);
    // what Memory is still writing (a goal's record, a transcript) finishes, bounded (ADR-0072)
    await settle(this.memory.pendingWork(), 5_000);
    // a deploy records how it ended (its commands were killed with the rest)
    await settle([...deployWork(), ...revertWork()], 5_000);
    // last of all, the database closes: a data directory deleted after stop() then holds a closed file (on macOS, a
    // database unlinked while open makes its next close a guard trap that kills the process — the test runner died of it)
    this.store.close();
  }

  /** the escalation for a commit a merge attempt made before the engine stopped and git would not take back at the next start */
  private async raiseStuckOrphan(a: Attempt, ref: string, why: string): Promise<void> {
    const goal = getGoal(this.store.db, a.goalId);
    if (!goal) return;
    const task = getTask(this.store.db, a.taskId);
    const branch = (await git(['branch', '--show-current'], a.cwd!)).stdout.trim();
    const where = branch ? `\`${branch}\`` : `the worktree at ${a.cwd}`;
    // commits on top of it: the answer cannot take it back without them, so the person reverts it
    const onTop = (await git(['rev-parse', 'HEAD'], a.cwd!)).stdout.trim() !== ref;
    const then = onTop ? `revert it there (git revert ${ref.slice(0, 7)}), then answer` : 'your answer takes it back once git lets go of it';
    const reason = `merge attempt ${a.index} committed its resolution, then the engine stopped before its checks finished; the commit could not be taken back (${why}), so ${where} still holds that unverified resolution: nothing lands on it meanwhile, and ${then}`;
    raiseEscalation(this, {
      goal,
      task,
      attemptId: a.id,
      trigger: 'retries_exhausted',
      message: `${task ? `The merge for "${task.title}"` : 'A merge'} did not finish: ${reason}.\n\nYou can let the engine try again, resolve it by hand (**Resolve manually**), or skip the task.`,
      payload: { kind: 'merge', files: [], reasons: [reason], stuck: { cwd: a.cwd!, base: a.baseRef!, ref, ...(branch ? { branch } : {}) } },
      blockGoal: true,
    });
  }

  private async reconcile(): Promise<void> {
    this.accountPool.restore();
    this.restoreRateLimitPause();
    for (const a of listRunningAttempts(this.store.db)) {
      // an Imported Goal's sessions ran on another computer: the Transfer concluded them, this pid is not theirs
      if (isHistory(getGoal(this.store.db, a.goalId) ?? {})) continue;
      // a merge attempt stopped during its checks committed its resolution already: the merge did not land, so the
      // commit goes and its next integration meets the conflict again. One git would not take back is named on an
      // escalation that blocks the goal, as when an attempt's own take-back is refused: nothing lands on it meanwhile
      if (a.kind === 'merge' && a.cwd && a.baseRef) {
        const back = await takeBackOrphaned(a.cwd, a.baseRef, { index: a.index, made: a.endRef }).catch((err) => ({ taken: false, why: String((err as Error)?.message ?? err).slice(0, 200), ref: null }));
        if (back.taken && !back.why) this.store.append({ type: 'engine.note', goalId: a.goalId, payload: { level: 'info', message: `took back the commit merge attempt ${a.id} made before the engine stopped: its checks never finished` } });
        else if (back.taken && back.ref) await this.raiseStuckOrphan(a, back.ref, back.why!);
        else if (back.why) this.store.append({ type: 'engine.note', goalId: a.goalId, payload: { level: 'warn', message: `could not tell whether merge attempt ${a.id} left its commit in ${a.cwd} when the engine stopped (${back.why}): if its last commit says "Resolved by merge attempt ${a.index}", that resolution was never checked` } });
      }
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
        // an orphaned attempt that cannot be resumed is not a failed one either: give the budget back, and so for the merge
        // attempt of a task whose work had passed (it runs again)
        if ((a.kind === 'work' && !resumable) || (a.kind === 'merge' && t.state === 'merging')) this.store.append({ type: 'task.hint_set', goalId: a.goalId, payload: { taskId: t.id, hint: t.hint, extraAttempts: 1 } });
      }
      this.store.append({ type: 'engine.note', goalId: a.goalId, payload: { level: resumable ? 'info' : 'warn', message: resumable ? `attempt ${a.id} was interrupted by an engine restart; its session will be resumed` : `attempt ${a.id} was orphaned by an engine restart` } });
    }
    for (const g of listGoals(this.store.db)) {
      if (isHistory(g)) continue;
      if (g.delivery.status === 'running') {
        this.store.append({ type: 'delivery.failed', goalId: g.id, payload: { step: g.delivery.step ?? 'preflight', reason: 'engine restarted during delivery — run Deliver again (every step is idempotent)' } });
      }
      if (['done', 'over_delivered', 'failed', 'cancelled'].includes(g.state)) continue;
      // exports a merge attempt laid over the goal's when the engine stopped never landed: the goal's go back first
      await recoverOverlays(this, g);
      await git(['worktree', 'prune'], g.repoPath).catch(() => {});
      // a task still merging passed its checks and was landing, or waiting to land, when the engine stopped: nothing picks
      // it up where it was, so it runs again (its attempt given back) and lands once its checks pass
      for (const t of listTasks(this.store.db, g.id)) {
        if (t.state !== 'merging') continue;
        this.store.append({ type: 'task.state_changed', goalId: g.id, payload: { taskId: t.id, from: 'merging', to: 'observing', reason: 'engine restart' } });
        this.store.append({ type: 'task.state_changed', goalId: g.id, payload: { taskId: t.id, from: 'observing', to: 'ready', reason: 'engine restarted before it landed; it runs again' } });
        this.store.append({ type: 'task.hint_set', goalId: g.id, payload: { taskId: t.id, hint: t.hint, extraAttempts: 1 } });
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
  recordSessionUsage(result: RunResult, meta: { goalId: string | null; kind: string; model?: string | null; provider?: AgentProvider }): void {
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
        costStatus: result.costStatus ?? 'reported',
        durationMs: result.durationMs,
        subtype: result.subtype,
        rateLimit: result.rateLimit ? { status: result.rateLimit.status, resetsAt: result.rateLimit.resetsAt, rateLimitType: result.rateLimit.rateLimitType, isUsingOverage: result.rateLimit.isUsingOverage } : null,
        skillsUsed: result.skillsUsed ?? [],
        ...(result.accountId ? { accountId: result.accountId } : {}),
      },
    });
    this.observeRateLimit(result, provider);
  }

  private observeRateLimit(result: RunResult, provider: AgentProvider): void {
    const rl = result.rateLimit;
    const now = Date.now();
    const byStatus = limitPauseUntil(rl, now);
    const limitedByError = result.isError && LIMIT_TEXT.test(result.errorMessage ?? '');
    if (byStatus === null && !limitedByError) return;
    let until = byStatus ?? resetsInAt(result.errorMessage, now) ?? now + 5 * 60_000;
    const reason = byStatus !== null ? `rate_limit_event status=${rl!.status}` : `session error: ${(result.errorMessage ?? '').slice(0, 120)}`;
    const accountId = result.accountId ?? NATIVE_ACCOUNT;
    // an account's own limit (not the provider overloaded) is passed over until it resets; new sessions go on with the
    // next account when auto switch is on, or never paused when the limit hit an account they had left already (ADR-0065)
    const accountLimit = isPooled(provider) && (byStatus !== null || !/overloaded|\b529\b/i.test(result.errorMessage ?? ''));
    if (accountLimit) {
      this.accountPool.markLimited(provider, accountId, until, reason);
      if (this.accountPool.afterLimit(provider, accountId)) return;
      if (this.config.autoSwitch[provider]) until = this.accountPool.earliestReset(provider) ?? until;
    }
    this.pauseUntil(until, rl?.rateLimitType ?? null, reason, provider);
    // Codex reports no reset with the error: the account's quota windows say when the exhausted one comes back
    if (provider === 'codex' && byStatus === null)
      void this.accountPool
        .codexQuota(accountId, this.codexQuota)
        .read(true)
        .then((q) => {
          const reset = codexResumeAt(q, Date.now());
          if (!reset) return;
          this.accountPool.markLimited('codex', accountId, reset, 'Codex quota window used up');
          if (this.isRateLimited('codex')) this.pauseUntil(this.config.autoSwitch.codex ? (this.accountPool.earliestReset('codex') ?? reset) : reset, 'codex-quota', 'Codex quota window used up', 'codex');
        })
        .catch(() => {});
  }

  /**
   * The user-scope MCP servers of the native Claude sign-in, for a session on an added account: they live in the native
   * .claude.json, and an account's home has a .claude.json of its own (its sign-in is in it).
   */
  private nativeMcpServers(): { mcpServers: Record<string, unknown> } | undefined {
    const dir = claudeConfigEnv(this.config.claudeHome).CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR;
    try {
      const servers = JSON.parse(readFileSync(dir ? join(dir, '.claude.json') : join(homedir(), '.claude.json'), 'utf8')).mcpServers;
      return servers && typeof servers === 'object' && Object.keys(servers).length ? { mcpServers: servers } : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * New sessions of the coding agent run on `to` from now (Use now, or Switch and continue on a usage pause); sessions
   * already running finish on their account. A pause the old account's limit set lifts when `to` is not limited.
   */
  switchAccount(provider: PooledProvider, to: string): void {
    this.accountPool.switchTo(provider, to, { auto: false, reason: 'switched by hand' });
    if (this.isRateLimited(provider) && !this.accountPool.isLimited(provider, to)) this.resume(provider, `switched to ${this.accountPool.label(provider, to)}`);
  }
  /** Switch and continue (the usage banner, a chat button): the next account no limit holds becomes current; null when there is none */
  switchToNext(provider: PooledProvider): string | null {
    const next = this.accountPool.next(provider);
    if (!next) return null;
    this.switchAccount(provider, next.id);
    return this.accountPool.label(provider, next.id);
  }

  /** A limit on one account must not pause the other backend. */
  pauseUntil(until: number, rateLimitType: string | null, reason: string, provider = this.config.provider): void {
    if ((this.rateLimitedUntil.get(provider) ?? 0) >= until) return;
    this.rateLimitedUntil.set(provider, until);
    this.store.append({ type: 'rate_limit.paused', goalId: null, payload: { provider, rateLimitType, until: new Date(until).toISOString(), reason } });
    this.armResume(until, provider);
  }
  private armResume(until: number, provider: AgentProvider): void {
    clearTimeout(this.resumeTimers.get(provider));
    this.resumeTimers.set(provider, setTimeout(() => this.resume(provider, 'retry time reached'), Math.max(0, until - Date.now()) + 1000));
  }
  private resume(provider: AgentProvider, reason: string): void {
    // with auto switch on, sessions start again on an account whose limit is not holding
    if (isPooled(provider)) this.accountPool.leaveLimited(provider);
    clearTimeout(this.resumeTimers.get(provider));
    this.rateLimitedUntil.delete(provider);
    this.resumeTimers.delete(provider);
    this.store.append({ type: 'rate_limit.resumed', goalId: null, payload: { provider, reason } });
    for (const g of listGoals(this.store.db)) if ((g.provider ?? this.config.provider) === provider && !['done', 'over_delivered', 'failed', 'cancelled'].includes(g.state)) this.tick(g.id);
  }
  /** Resume now (Usage banner): new sessions start again; a limit that still holds pauses the next one again */
  resumeNow(provider = this.config.provider): boolean {
    if (!this.isRateLimited(provider)) return false;
    this.resume(provider, 'resumed by hand');
    return true;
  }
  private restoreRateLimitPause(): void {
    for (const provider of AGENT_PROVIDERS) {
      const paused = this.store.listByType('rate_limit.paused', 100).find((e) => (('provider' in e.payload ? e.payload.provider : undefined) ?? this.config.provider) === provider);
      const resumed = this.store.listByType('rate_limit.resumed', 100).find((e) => (('provider' in e.payload ? e.payload.provider : undefined) ?? this.config.provider) === provider);
      if (!paused || (resumed && resumed.seq > paused.seq)) continue;
      const saved = Date.parse((paused.payload as { until: string }).until);
      if (!Number.isFinite(saved)) continue;
      // a pause longer than limitPauseUntil now allows was saved under the old rule (an overage that stopped nothing, a
      // reset weeks away) and is lifted rather than kept
      const type = (paused.payload as { rateLimitType?: string | null }).rateLimitType ?? null;
      const tooLong = saved - Date.parse(paused.ts) > (type === 'overage' ? OVERAGE_PAUSE_MS : MAX_PAUSE_MS);
      if (tooLong) this.store.append({ type: 'rate_limit.resumed', goalId: null, payload: { provider, reason: 'a pause longer than the usage limit allows was lifted' } });
      else if (saved > Date.now()) { this.rateLimitedUntil.set(provider, saved); this.armResume(saved, provider); }
      else this.store.append({ type: 'rate_limit.resumed', goalId: null, payload: { provider, reason: 'retry time passed while the engine was down' } });
    }
  }
  isRateLimited(provider = this.config.provider): boolean { return (this.rateLimitedUntil.get(provider) ?? 0) > Date.now(); }
  rateLimitedUntilIso(provider = this.config.provider): string | null { return this.isRateLimited(provider) ? new Date(this.rateLimitedUntil.get(provider)!).toISOString() : null; }

  usage(provider = this.config.provider): UsageSummary & { pausedUntil: string | null } {
    const now = Date.now();
    // with several accounts the windows, the signals and the quota are the current account's (ADR-0065); the activity
    // totals stay every account's
    const pooled = isPooled(provider) ? provider : null;
    const current = pooled ? this.accountPool.currentId(pooled) : NATIVE_ACCOUNT;
    const several = !!pooled && this.accountPool.list(pooled).length > 1;
    const codexQuota = provider === 'codex' ? this.accountPool.codexQuota(current, this.codexQuota).current() : undefined;
    const summary = usageSummary(this.store.db, now, provider, this.config.provider, pooled === 'claude' ? { state: this.accountSignals('claude', current) } : {});
    return { ...summary, ...(several ? { currentAccount: this.accountPool.label(pooled!, current), accounts: this.accountUsage(pooled!, now) } : {}), provider, costAvailable: reportsDollars(provider), ...(provider === 'codex' ? { codexQuota, note: 'Codex reports tokens, not USD cost. $0 means unreported, not free. USD budgets cannot be enforced; use time, concurrency and attempt limits. Account quota follows the current account; activity totals count only Foundry sessions, on every account.' } : provider === 'agy' ? { agyQuota: this.agyQuota.current(), note: 'Antigravity reports tokens, not USD cost. $0 means unreported, not free. USD budgets cannot be enforced; use time, concurrency and attempt limits. The quota is the account\'s own, read from agy; activity totals count only Foundry sessions.' } : {}), pausedUntil: this.rateLimitedUntilIso(provider) };
  }

  // ---------- models ----------

  /** seed aliases ∪ names seen in sessions, with what they resolved to; what the Settings page lists */
  listModels(provider: AgentProvider = this.config.provider): (ModelRecord & { label: string | null; note: string | null; pinned: boolean; inUse: string[] })[] {
    const used = this.modelsInUse(provider);
    return this.providerModels[provider].list().map((r) => {
      const seed = (provider === 'agy' ? AGY_SEED_MODELS : SEED_MODELS).find((s) => s.name === r.name);
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
  async probeModel(name: string, provider: AgentProvider = this.config.provider, effort?: CodexEffort): Promise<{ ok: boolean; name: string; resolvedId: string | null; costUsd: number; costAvailable: boolean; error: string | null }> {
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
  /** Reports (ADR-0060): what Foundry cost and did over the last `days` (null = all time), by project and session kind */
  report(days: number | null = 30): Report {
    return buildReport(this, { days });
  }

  /**
   * One account's rate-limit windows (ADR-0065). The native sign-in's from before accounts existed are only in the coding
   * agent's own table, so it stands in until the account has reported any of its own.
   */
  private accountSignals(provider: PooledProvider, id: string): RateLimitRow[] {
    const own = listAccountRateLimits(this.store.db, provider, id);
    return own.length || id !== NATIVE_ACCOUNT ? own : listRateLimitState(this.store.db);
  }
  /** each of the coding agent's accounts with its own windows (Claude) or quota (Codex), and Foundry's sessions on it */
  private accountUsage(provider: PooledProvider, now: number): AccountUsage[] {
    const win = (w: WindowSummary): AccountWindow => ({ status: w.status, resetsAt: w.resetsAt, lastSignalAt: w.lastSignalAt, isUsingOverage: w.isUsingOverage, sessions: w.sessions, costUsd: w.costUsd, outputTokens: w.outputTokens });
    return this.accountPool.views(provider).map((a) => {
      const s = usageSummary(this.store.db, now, provider, this.config.provider, { accountId: a.id, state: provider === 'claude' ? this.accountSignals(provider, a.id) : [] });
      return { id: a.id, label: this.accountPool.label(provider, a.id), plan: a.plan, current: a.current, limitedUntil: a.limitedUntil, fiveHour: win(s.fiveHour), sevenDay: win(s.sevenDay), ...(provider === 'codex' ? { codexQuota: this.accountPool.codexQuota(a.id, this.codexQuota).current() } : {}) };
    });
  }

  async readUsage(provider = this.config.provider, force = false): Promise<UsageSummary & { pausedUntil: string | null }> {
    // every Codex account's own quota: the current one's for the card, the others' for the accounts list
    if (provider === 'codex') await Promise.all(this.accountPool.list('codex').map((a) => this.accountPool.codexQuota(a.id, this.codexQuota).read(force)));
    if (provider === 'agy') await this.agyQuota.read(force);
    return this.usage(provider);
  }

  /** the models the presets Settings picks actually use, with where: "opus" → ["Code: Standard tasks", …] */
  modelsInUse(provider: AgentProvider = this.config.provider): Map<string, string[]> {
    const presets = effectivePresets(this.config.modelPresets);
    const used = new Map<string, string[]>();
    if (provider === 'agy') {
      used.set(this.config.agyModel, ['Every role']);
      return used;
    }
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

  private modelsCheck(provider: AgentProvider = this.config.provider) {
    const registry = this.providerModels[provider];
    const issues: string[] = [];
    for (const [name, where] of this.modelsInUse(provider)) {
      const r = registry.get(name);
      if (r?.lastFailAt && (!r.lastOkAt || r.lastFailAt > r.lastOkAt)) issues.push(`${name} (${where.length} action${where.length === 1 ? '' : 's'}): last failed ${r.lastFailAt.slice(0, 16).replace('T', ' ')} (${r.lastError ?? 'model unavailable'})`);
      else if (!r || (!r.seed && !r.discovered && !registry.known(name))) issues.push(`${name} (${where.length} action${where.length === 1 ? '' : 's'}): never seen resolving on this machine`);
    }
    const picks = provider === 'codex' ? `Codex: ${this.config.codexModel}` : provider === 'agy' ? `Antigravity: ${this.config.agyModel} (${this.config.agyEffort} effort)` : MODEL_NATURES.map((n) => `${NATURE_LABEL[n]} ${effectivePresets(this.config.modelPresets)[this.config.naturePreset[n]]?.label ?? this.config.naturePreset[n]}`).join(' · ');
    const detail = issues.length ? issues.join('; ') : `${picks}${provider !== 'claude' ? '' : '; fallbacks ' + this.config.modelFallbacks.join(' → ')}`;
    return { id: 'models', label: 'Models (presets in use)', ok: issues.length === 0, severity: 'warn' as const, detail, fix: issues.length ? { action: 'test-models' as const } : null };
  }

  /**
   * Model sync: read every model id the Claude Code binary knows (free), then resolve the family aliases with one tiny
   * session each so the dropdowns show what `fable` / `opus` / `sonnet` / `haiku` mean today. Runs on demand and when the
   * Claude Code version changes.
   */
  async syncModels(opts: { probe?: boolean; provider?: AgentProvider } = {}): Promise<{ found: number; newest: string[]; resolved: Record<string, string | null>; cliVersion: string | null }> {
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
    if (provider === 'agy') {
      const bin = this.config.agyBin ?? Bun.which('agy');
      if (!bin) throw new Error('The Antigravity CLI is not installed. Set the CLI path in Accounts and restart Foundry.');
      const r = await exec([bin, 'models'], this.config.dataDir, { timeoutMs: 60_000 }).catch(() => null);
      if (!r || r.code !== 0) throw new Error(`agy models failed: ${(r?.stderr || r?.stdout || 'no output').trim().slice(0, 200)}`);
      const found = parseAgyModels(r.stdout);
      if (found.length) registry.noteDiscovered(found.map((m) => ({ id: m.id, family: m.id.replace(/-(high|medium|low)$/, ''), newest: false })));
      const v = await exec([bin, '--version'], this.config.dataDir, { timeoutMs: 15_000 }).catch(() => null);
      const cliVersion = v?.code === 0 ? v.stdout.trim().split(/\s/).pop() ?? null : null;
      registry.noteSync({ cliVersion, at: new Date().toISOString(), found: found.length });
      this.config.log(`[models] sync: ${found.length} model(s) listed by agy`);
      return { found: found.length, newest: [], resolved: {}, cliVersion };
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
    if (this.config.provider !== 'claude') return;
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
    if (this.config.provider !== 'claude') return; // no paid model probes at startup
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

  async probeUsage(provider: AgentProvider = this.config.provider): Promise<UsageSummary & { pausedUntil: string | null }> {
    if (provider !== 'claude') return this.readUsage(provider, true);
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
  /** whether anything holds the goal workspace's lock now, or waits for it */
  goalWsBusy(goalId: string): boolean {
    return this.goalWsLocks.has(goalId);
  }

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

  reserve(taskId: string): InFlight {
    const t = getTask(this.store.db, taskId);
    const slot: InFlight = { goalId: t?.goalId ?? '', attemptId: null, handle: null, since: Date.now() };
    this.inFlight.set(taskId, slot);
    return slot;
  }
  /** the slot was released under the work holding it (the human unstuck the task): that work must stop touching it */
  holds(taskId: string, slot: InFlight): boolean {
    return this.inFlight.get(taskId) === slot;
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
  /** with `slot`, only that reservation is released: a newer one taken after an unstick stays */
  release(taskId: string, slot?: InFlight): void {
    if (slot && this.inFlight.get(taskId) !== slot) return;
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
    for (const h of this.background.get(goalId) ?? []) h.kill('killed_manual');
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

  /** what the task drawer needs to tell a stuck task from a busy one: a slot held, and a session process alive in it */
  taskLiveness(taskId: string): { inFlight: boolean; session: boolean; since: string | null } {
    const f = this.inFlight.get(taskId);
    return { inFlight: !!f, session: !!f?.handle, since: f ? new Date(f.since).toISOString() : null };
  }

  /**
   * Why a ready task of a running goal is not running, in words — or null when nothing should hold it back, which is
   * when the task drawer offers "Start now". Mirrors the scheduler's rules.
   */
  readyBlocker(goal: Goal, task: Task): string | null {
    return this.readyHold(goal, task)?.reason ?? null;
  }

  /**
   * What holds a ready task back, and whether the person may start it anyway: a full set of slots, running alone or
   * files another task is changing are the scheduler's caution (`capacity`, `serial`, `overlap`) and can be overridden
   * with Start now; a goal that is not running, a usage pause, an update, a reached budget or a milestone waiting for the
   * person (`hard`) cannot.
   */
  readyHold(goal: Goal, task: Task): { reason: string; kind: 'capacity' | 'serial' | 'overlap' | 'hard' } | null {
    const hard = (reason: string) => ({ reason, kind: 'hard' as const });
    if (task.state !== 'ready') return hard(`the task is ${task.state}`);
    if (goal.state !== 'running') return hard(`the goal is ${goal.state.replace(/_/g, ' ')}`);
    if (this.isRateLimited(goal.provider ?? this.config.provider)) return hard('work is paused until the usage limit resets');
    if (this.updateDraining) return hard('Foundry is finishing work before an update');
    const own = this.inFlight.get(task.id);
    if (own) return Date.now() - own.since < STALE_RESERVATION_MS ? hard('it is starting') : null;
    const b = budgetStatus(goal);
    if (b.exceeded) return hard('the goal reached its budget');
    const tasks = listTasks(this.store.db, goal.id);
    if (dueCheckpoint(tasks)) return hard('a milestone landed; Foundry waits for the work in flight, then for you');
    if (isDelegationTask(task)) {
      const under = delegatingTasks(tasks).filter((t) => t.id !== task.id);
      return hard(under.length >= goal.budgets.maxConcurrent ? `every parallel slot is taken by delegated goals (${under.length} of ${goal.budgets.maxConcurrent} under way): it starts once one has landed` : 'it starts as a delegated goal at the next scheduling pass');
    }
    if (this.forceStart.has(task.id)) return hard('it is starting (you asked for it)');
    const inFlight = this.inFlightForGoal(goal.id);
    const running = tasks.filter((t) => inFlight.includes(t.id));
    const names = (ts: Task[]) => ts.map((t) => `"${t.title}"`).join(', ');
    if (inFlight.length >= goal.budgets.maxConcurrent) return { kind: 'capacity', reason: `every slot is taken (${names(running) || `${inFlight.length} running`})` };
    // not a dependency: a task the Brief marked not parallelizable runs alone, so it waits for whatever runs now
    if (!task.parallelizable && inFlight.length > 0) return { kind: 'serial', reason: `it runs alone (not parallelizable), so it starts once ${names(running) || 'the running task'} ${running.length > 1 ? 'finish' : 'finishes'}; it does not depend on ${running.length > 1 ? 'them' : 'it'}` };
    const clash = running.find((x) => filesOverlap(task.relevantFiles, x.relevantFiles).length > 0);
    if (clash) return { kind: 'overlap', reason: `it waits for "${clash.title}": both touch ${filesOverlap(task.relevantFiles, clash.relevantFiles).slice(0, 3).join(', ')}` };
    return null;
  }

  /**
   * Record a milestone again (taskId = FINAL_WALK: every milestone that landed): a scripted one runs its script, one
   * Foundry walked through replays the walkthrough it recorded last time. In a running goal a script that fails gets its
   * repair task, as when it landed. Runs in the background; the milestone card shows it until the recording arrives.
   */
  rerunMilestone(goalId: string, taskId: string): { started: string[] } {
    const goal = this.mustGoal(goalId);
    const tasks = listTasks(this.store.db, goalId);
    const targets = taskId === FINAL_WALK ? tasks.filter((t) => t.milestone && t.state === 'done') : tasks.filter((t) => t.id === taskId);
    if (!targets.length) throw new Error(taskId === FINAL_WALK ? 'no milestone has landed yet' : `task ${taskId} not found`);
    for (const t of targets) {
      if (!t.milestone) throw new Error(`"${t.title}" is not a milestone`);
      if (t.state !== 'done') throw new Error(`"${t.title}" has not landed yet`);
    }
    const running = new Set(milestoneRunsFor(goalId));
    const started = targets.filter((t) => !running.has(t.id));
    for (const t of started) void recordMilestone(this, goal, t, { replay: true });
    return { started: started.map((t) => t.id) };
  }

  /** the milestones of a goal being recorded or waiting their turn; FINAL_WALK while its final walkthrough runs */
  milestoneRuns(goalId: string): string[] {
    return [...milestoneRunsFor(goalId), ...(this.finalWalking.has(goalId) ? [FINAL_WALK] : [])];
  }

  /**
   * The human's way out of a stuck task without restarting Foundry. A ready task that nothing holds back is scheduled
   * again (a reservation that never got going is dropped first). A running task with no live session — work that hung
   * between sessions — is concluded the way an engine restart would conclude it, and goes back to ready: its session
   * resumes when it can, and the attempt is not counted otherwise.
   */
  unstickTask(goalId: string, taskId: string, opts: { force?: boolean } = {}): { action: 'scheduled' | 'stopped' } {
    const goal = this.mustGoal(goalId);
    const task = getTask(this.store.db, taskId);
    if (!task || task.goalId !== goalId) throw new Error(`task ${taskId} not found`);
    if (isDelegationTask(task) && task.state !== 'ready') throw new Error(`"${task.title}" is done by a delegated goal: open that goal to see where it is`);
    if (task.state === 'ready') {
      const hold = this.readyHold(goal, task);
      // the scheduler's caution (slots, running alone, shared files) gives way when the person says so; nothing else does
      if (hold && (hold.kind === 'hard' || !opts.force)) throw new Error(`"${task.title}" cannot start now: ${hold.reason}`);
      if (this.inFlight.has(task.id)) this.inFlight.delete(task.id);
      this.overlapNoted.delete(task.id);
      if (hold) this.forceStart.add(task.id);
      this.store.append({ type: 'engine.note', goalId, payload: { level: 'info', message: hold ? `you started "${task.title}" now, although ${hold.reason}` : `"${task.title}" was ready but had not started; you asked Foundry to start it now` } });
      this.tick(goalId);
      return { action: 'scheduled' };
    }
    if (task.state !== 'running' && task.state !== 'observing' && task.state !== 'merging') throw new Error(`"${task.title}" is ${task.state}; only a ready or running task can be unstuck`);
    if (this.inFlight.get(task.id)?.handle) throw new Error(`a session of "${task.title}" is still running; stop it from the live log first`);
    for (const a of listRunningAttempts(this.store.db).filter((x) => x.taskId === task.id)) {
      if (a.pid && isAlive(a.pid)) {
        try {
          process.kill(a.pid, 'SIGTERM');
        } catch {}
      }
      const resumable = a.kind === 'work' && !!a.sessionId && a.continuations < this.config.maxContinuations;
      this.store.append({ type: 'attempt.finished', goalId, payload: { attemptId: a.id, state: resumable ? 'interrupted' : 'error', resultSubtype: 'orphaned', costUsd: a.costUsd, numTurns: a.numTurns, endRef: a.endRef, permissionDenials: [], skillsUsed: [], toolsUsed: {} } });
      this.store.append({ type: 'attempt.concluded', goalId, payload: { attemptId: a.id, state: resumable ? 'interrupted' : 'error', reason: resumable ? 'stuck; stopped by you — resumes next' : 'stuck; stopped by you' } });
      if (a.kind === 'work' && !resumable) this.store.append({ type: 'task.hint_set', goalId, payload: { taskId: task.id, hint: task.hint, extraAttempts: 1 } });
    }
    if (task.state === 'merging') this.store.append({ type: 'task.state_changed', goalId, payload: { taskId: task.id, from: 'merging', to: 'observing', reason: 'stuck; stopped by you' } });
    this.store.append({ type: 'task.state_changed', goalId, payload: { taskId: task.id, from: task.state === 'merging' ? 'observing' : task.state, to: 'ready', reason: 'stuck with no live session; stopped by you' } });
    // the hung work still holds the old slot; it checks `holds` and stops touching the task when it ever returns
    this.inFlight.delete(task.id);
    this.overlapNoted.delete(task.id);
    this.tick(goalId);
    return { action: 'stopped' };
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
    // reconcile's own events wake goals while it still undoes overlays a stop cut short: start() ticks every goal after it
    if (this.reconciling) return;
    const goal = getGoal(this.store.db, goalId);
    if (!goal) return;
    if (isHistory(goal)) return; // an Imported Goal waits to be Reattached (ADR-0030)
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
        // a cad goal needs text-to-cad: it waits (the goal page offers the install) until the plugin is in
        if (goal.nature === 'cad' && !(await this.cadAvailable(goal))) {
          this.cadWaiting.add(goalId);
          // one note per goal, across restarts: the store remembers it
          if (!this.store.listByGoalOfTypes(goalId, ['engine.note']).some((e) => String((e.payload as { message?: string }).message ?? '').startsWith('text-to-cad is not installed'))) {
            this.store.append({ type: 'engine.note', goalId, payload: { level: 'warn', message: 'text-to-cad is not installed for this coding agent: Clarify waits for it (Setup → 3D models, or the button on this page)' } });
          }
          return;
        }
        this.cadWaiting.delete(goalId);
        // a goal with references: REA studies them first, so the Brief is grounded in how they work
        if (needsInvestigation(goal)) {
          this.startInvestigation(goal);
          return;
        }
        const iv = goal.interview;
        if (iv?.status === 'awaiting_answers') return; // a round is open: the human answers on the goal page
        // a round was answered but no session settled it (engine restarted mid-interview): pick it up again
        if (iv?.status === 'thinking' && iv.rounds.length && iv.rounds.at(-1)!.answers) void continueInterview(this, goal);
        else void runClarify(this, goal);
        return;
      }
      case 'awaiting_brief_approval':
        // "Investigate again" cleared the report; a restart in between lost the session: study the references once more
        if (needsInvestigation(goal)) this.startInvestigation(goal);
        // pictures of the Subjects are searched once while the Brief waits (a restart searches again); approval waits for them
        else if (startDueSearches(this, goal)) return;
        // a Delegated goal whose main goal approves for it: approved once its Brief leaves no question to the person
        else if (goal.delegatedFrom) autoApproveDelegated(this, goal);
        // a scheduled run whose schedule approves for the person (ADR-0054)
        else if (goal.schedule?.autoApprove) autoApproveScheduled(this, goal);
        return;
      case 'blocked':
        // a main goal blocked while its Delegated goal needs the person goes on once it no longer does; a finished one lands meanwhile
        if (listTasks(this.store.db, goalId).some((t) => isDelegationTask(t))) await settleDelegations(this, goal);
        return;
      case 'running':
        await schedule(this, goal);
        return;
      case 'done':
      case 'over_delivered': {
        // media artifacts leave the workspace first (independent of delivery mode — they never ride a PR)
        // never delivered, or run again since its delivery (a restart): the output folder gets the files as they are now
        if (!this.deliveringArtifacts.has(goalId) && artifactsDue(this, goal)) {
          const copy = deliverArtifacts(this, goal)
            .catch((err) => void this.store.append({ type: 'engine.note', goalId, payload: { level: 'warn', message: `artifact delivery crashed: ${String(err)}` } }))
            .finally(() => this.deliveringArtifacts.delete(goalId));
          this.deliveringArtifacts.set(goalId, copy);
          // a tidy-up put off for these files runs once they are there (ADR-0033)
          void copy.then(() => this.tidyAfterDelivery(goalId));
        } else if (!this.deliveringArtifacts.has(goalId)) this.tidyAfterDelivery(goalId);
        // docs still being written (the goal finished without its goal review): they ship with the code, so wait
        if (this.documenting.has(goalId)) return;
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

  skillsForProvider(provider: AgentProvider = this.config.provider): SkillsManager {
    return this.providerSkills[provider];
  }

  /** the MCP manager of a coding agent; Antigravity keeps its servers itself (`agy mcp`), so it has none here */
  mcpFor(provider: AgentProvider = this.config.provider) {
    if (provider === 'agy') throw new Error("Antigravity keeps its MCP servers itself: add them with agy mcp add, list them with agy mcp list.");
    return provider === 'codex' ? this.codexMcp : this.mcp;
  }

  mcpAllowedFor(goal: Goal): string[] {
    const provider = goal.provider ?? this.config.provider;
    // Antigravity sessions use the servers the person configured in agy itself; Foundry keeps no allowlist for them
    return provider === 'codex' ? this.config.codexMcpAllowed : provider === 'agy' ? [] : this.config.mcpAllowed;
  }

  /**
   * The MCP servers a session may use and the tools of theirs it may not: the catalog's deny lists (REA: launching the
   * target, a debugger, a connected device, writing files where the caller says), as `mcp__<server>__<tool>` names,
   * unless Settings opened them. The catalog is data on disk; when it cannot be read (a broken install) there is no
   * deny list to apply, so no MCP server reaches the session at all: safe by default, and the Setup page says why.
   */
  mcpToolPolicy(provider: AgentProvider, allowed: readonly string[]): { allowed: string[]; denied: string[] | undefined; catalogUnreadable: boolean } {
    const servers = allowed.filter((p) => p.startsWith('mcp__'));
    if (this.config.mcpDynamicTools || !servers.length) return { allowed: [...allowed], denied: undefined, catalogUnreadable: false };
    let lists: { prefix: string; denyTools: string[] }[];
    try {
      lists = [
        ...this.mcpFor(provider).catalog().entries.map((e) => ({ prefix: `mcp__${e.name}`, denyTools: e.denyTools })),
        // servers a catalog plugin ships (text-to-cad's `cad`) carry their deny list on the skills catalog, under the prefix this coding agent gives them
        ...this.providerSkills[provider].catalog().entries.flatMap((e) => {
          const src = e.source;
          return src.type === 'plugin' ? src.mcpServers.map((s) => ({ prefix: pluginServerPrefix(provider, src.plugin, s.name), denyTools: s.denyTools })) : [];
        }),
      ];
    } catch (err) {
      this.config.log(`[mcp] a catalog cannot be read (${String((err as Error).message ?? err)}): no MCP server reaches this session`);
      return { allowed: allowed.filter((p) => !p.startsWith('mcp__')), denied: undefined, catalogUnreadable: true };
    }
    const denied: string[] = [];
    for (const e of lists) {
      if (!allowed.includes(e.prefix)) continue;
      for (const t of e.denyTools) denied.push(`${e.prefix}__${t}`);
    }
    return { allowed: [...allowed], denied: denied.length ? [...new Set(denied)] : undefined, catalogUnreadable: false };
  }

  /** the tools to deny for these servers; undefined = nothing to deny (see mcpToolPolicy) */
  deniedMcpTools(provider: AgentProvider, allowed: readonly string[]): string[] | undefined {
    return this.mcpToolPolicy(provider, allowed).denied;
  }

  /** goals already told that the MCP catalog is unreadable: one note each, not one per session */
  private catalogNoted = new Set<string>();
  /** cad goals told once that they wait for text-to-cad */
  private cadWaiting = new Set<string>();

  /** a worker session's tools: the base set plus the allowed MCP servers, minus the tools that run or change things */
  workerToolPolicy(goal: Goal): { allowedTools: string[]; disallowedTools: string[] | undefined } {
    const provider = goal.provider ?? this.config.provider;
    const policy = this.mcpToolPolicy(provider, this.mcpAllowedFor(goal));
    if (policy.catalogUnreadable && !this.catalogNoted.has(goal.id)) {
      this.catalogNoted.add(goal.id);
      this.store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: 'the MCP catalog (or the skills catalog, which holds a plugin server\'s deny list) cannot be read, so no MCP server reaches the sessions of this goal; the Setup page has the details' } });
    }
    return { allowedTools: workerTools(policy.allowed), disallowedTools: policy.denied };
  }

  skillsFor(goal: Goal): SkillsManager {
    return this.providerSkills[goal.provider ?? this.config.provider];
  }

  /** the workflow suite a goal's sessions follow: its own, or the Settings default for a goal from before suites were per goal (ADR-0049) */
  workflowProfileOf(goal: Pick<Goal, 'workflow'>): NonNullable<GoalWorkflow['profile']> {
    return goal.workflow.profile ?? this.config.workflowProfile;
  }

  lastWorkflowIn(repoPath: string): { goalId: string; title: string; createdAt: string; workflow: { profile: NonNullable<GoalWorkflow['profile']>; tdd: GoalWorkflow['tdd']; ponytail: GoalWorkflow['ponytail'] } } | null {
    const goal = listGoals(this.store.db).find((g) => g.repoPath === repoPath && !isHistory(g));
    if (!goal) return null;
    return { goalId: goal.id, title: goal.title, createdAt: goal.createdAt, workflow: { profile: this.workflowProfileOf(goal), tdd: goal.workflow.tdd, ponytail: goal.workflow.ponytail } };
  }

  /**
   * What a session of a goal on the pstack suite gets (ADR-0049): Claude loads the suite's hook-less plugin copy with
   * --plugin-dir; Codex finds the suite's skills linked into the session's workspace. Nothing for another suite, or when
   * the suite is not installed (the goal then runs on the fallback rules, as the prompt says).
   */
  private async suiteFor(spec: RunSpec, provider: AgentProvider): Promise<Pick<RunSpec, 'pluginDirs'>> {
    const goalId = spec.meta?.goalId;
    const goal = goalId ? getGoal(this.store.db, goalId) : null;
    if (provider === 'agy') await this.linkAgySkills(spec.cwd).catch((e) => this.config.log(`[skills] skill links in ${spec.cwd}: ${String((e as Error).message ?? e)}`));
    if (!goal || this.workflowProfileOf(goal) !== 'pstack') return {};
    const skills = this.providerSkills[provider];
    const suite = skills.installedSuite('pstack');
    if (!suite) return {};
    if (provider === 'claude') return { pluginDirs: [...(spec.pluginDirs ?? []), suite.dir] };
    const wanted = skills.catalog().entries.filter((e) => e.source.type === 'suite' && e.source.suite === 'pstack').map((e) => e.name);
    // only a workspace or worktree takes links (a housekeeping session's cwd is the data dir)
    if (existsSync(join(spec.cwd, '.git'))) await linkSuiteSkills(spec.cwd, suite, wanted, this.config.log).catch((e) => this.config.log(`[skills] suite links in ${spec.cwd}: ${String((e as Error).message ?? e)}`));
    return {};
  }

  /**
   * Antigravity reads skills from a workspace's `.agents/skills` only, not from ~/.agents/skills (agy 1.4.4): the catalog
   * skills installed there, the ones a session may be told to follow, are linked into the session's workspace (git-excluded).
   */
  private async linkAgySkills(cwd: string): Promise<void> {
    if (!existsSync(join(cwd, '.git'))) return;
    const skills = this.providerSkills.agy;
    const wanted = new Set((await skills.status()).filter((s) => SATISFIED.includes(s.status) && s.entry.source.type !== 'suite').map((s) => (s.installedInvoke ?? `/${s.entry.name}`).replace(/^\//, '')));
    const rows = skills.scan().installed.filter((r) => r.scope === 'user' && wanted.has(r.name));
    await linkSkillDirs(cwd, rows.map((r) => ({ name: r.name, dir: r.dir })), this.config.log);
  }

  // ---------- commands ----------

  async createGoal(input: CreateGoalInput): Promise<Goal> {
    const provider = input.provider ?? this.config.provider;
    if (!AgentProvider.safeParse(provider).success) throw new Error('Unknown coding agent');
    // the investigation runs before Clarify: a goal that skips Clarify has nowhere to learn from a reference
    if ((input.autoBrief || input.brief) && input.references?.some((r) => r.target.trim())) throw new Error('A goal that skips Clarify cannot learn from a reference: the investigation runs before Clarify.');
    // a cad goal that skips Clarify skips the wait for text-to-cad too: refused here, not in paid attempts
    if (input.nature === 'cad' && (input.autoBrief || input.brief) && !(await this.cadAvailable({ provider, repoPath: input.repoPath }))) throw new Error('text-to-cad is not installed for this coding agent: install it on the Setup page (3D models) before creating a CAD goal with a ready Brief.');
    const codexModel = input.codexModel?.trim() || this.config.codexModel;
    const agyModel = input.agyModel?.trim() || this.config.agyModel;
    // an unknown preset would silently fall back to the Settings pick while the goal still shows the typo
    if (provider !== 'claude' && input.models) throw new Error(`${PROVIDER_NAME[provider]} uses its own model settings, not Claude tiers.`);
    if (provider === 'agy' && input.modelPreset) throw new Error('Antigravity has one model setting (Settings → Models & limits), no presets.');
    if (provider === 'claude' && input.effort != null && !Effort.safeParse(input.effort).success) throw new Error('This reasoning effort is only supported by Codex.');
    if (input.modelPreset) {
      const known = Object.keys(provider === 'codex' ? effectiveCodexPresets(this.config.codexPresets) : effectivePresets(this.config.modelPresets));
      if (!known.includes(input.modelPreset)) throw new Error(`unknown model preset "${input.modelPreset}"; use one of: ${known.join(', ')}`);
    }
    if (!(await isGitRepo(input.repoPath))) throw new Error(`${input.repoPath} is not a git repository`);
    // companion repositories (ADR-0063): each a repository of its own, not this one, named once, on a branch
    const companions: GoalCompanion[] = [];
    for (const c of input.companions ?? []) {
      const path = resolve(c.repoPath);
      if (path === resolve(input.repoPath) || companions.some((x) => x.repoPath === path)) throw new Error(`${c.repoPath} is the goal's own repository, or named twice`);
      if (!existsSync(path)) throw new Error(`the companion ${c.repoPath} does not exist`);
      if (!(await isGitRepo(path))) throw new Error(`the companion ${c.repoPath} is not a git repository`);
      const base = c.baseBranch ?? (await currentBranch(path));
      if (base === 'HEAD') throw new Error(`the companion ${c.repoPath} is in detached HEAD state; name its base branch`);
      companions.push({ repoPath: path, baseBranch: base });
    }
    if (companions.length && input.delegatedFrom) throw new Error('a delegated goal has no companion repositories of its own');
    const id = newId(IdPrefix.goal);
    // a Follow-up snapshots what it needs from the earlier goal now, and delivers to the same base branch
    const followUp = input.follows ? await prepareFollowUp(this, input.follows, input.repoPath, id, input.attachments?.length ?? 0) : null;
    // a Delegated goal reads the main goal's attachments too (copies, as a Follow-up does)
    const delegatedAttachments = input.delegatedFrom ? copyAttachments(this.config.dataDir, this.mustGoal(input.delegatedFrom.goalId), id, ATTACHMENT_LIMITS.maxPerGoal) : [];
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
    // anyone-facing default: prose and media goals open in the plain-language view; cad is code work with a geometry kernel and keeps the default
    const mode: GoalMode = input.mode ?? (nature !== 'auto' && nature !== 'code' && nature !== 'cad' ? 'simple' : this.config.defaultGoalMode);
    const issue = input.issue ? GoalIssue.parse(input.issue) : null;
    const title = input.title?.trim() || issue?.title.trim() || input.prompt.trim().split('\n')[0]!.slice(0, 80);
    const goal: Goal = {
      provider,
      id,
      title,
      prompt: input.prompt,
      repoPath: input.repoPath,
      companions,
      // the progress folder: next to the repository (or under Settings → workspaces root), named after the title
      workspaceDir: defaultWorkspaceDir(this.config.workspacesRoot, { id, title, repoPath: input.repoPath }),
      checkpoint: null,
      selfCheck: input.selfCheck ?? this.config.selfCheck,
      milestonePause: input.milestonePause ?? this.config.milestonePause,
      clarifyStage: null,
      references: (input.references ?? []).map((r) => ({ target: r.target.trim(), lookAt: (r.lookAt ?? '').trim() })).filter((r) => r.target),
      investigation: null,
      previewRef: null,
      previewPlace: 'auto',
      effort: input.effort === undefined ? this.config.effort : input.effort,
      modelPreset: presetId,
      ...(codexPreset ? { codexPreset, codexFallbacks: [...this.config.codexFallbacks], ...(input.codexModel?.trim() ? { codexModelOverride: input.codexModel.trim() } : {}) } : {}),
      modelSubstitutions: {},
      revise: null,
      interview: (() => {
        const depth = input.interviewDepth ?? (input.interview ? depthOfMode(input.interview) : (this.config.interviewDepth ?? depthOfMode(this.config.interview)));
        // from 4 on the Clarifier asks at least one round
        return depth <= 0 ? null : { mode: depth >= 4 ? ('always' as const) : ('auto' as const), depth: Math.min(5, depth), status: 'thinking' as const, sessionId: null, rounds: [] };
      })(),
      baseBranch,
      branch: `goal/${id}`,
      budgets: Budgets.parse({ ...BUDGET_PRESETS[input.budgetPreset ?? 'custom'].budgets, ...(input.budgets ?? {}), ...(!reportsDollars(provider) ? { maxCostUsd: null } : {}) }),
      budgetPreset: input.budgetPreset ?? 'custom',
      mode,
      nature,
      outputDir: input.outputDir ?? null,
      workflow: (() => {
        // media goals default to fast: their deliverables are judged by the human's eye, not by $5 review sessions
        const pace = input.workflow?.pace ?? (MEDIA_NATURES.includes(nature) ? 'fast' : this.config.workflowPace);
        // fast goals run only what the Brief asks for: no TDD mandate unless the caller insists
        // cad: geometry checks are the tests, written before the model — preferred, never forced
        // the workflow suite is fixed here: a Settings change later never moves a goal that is under way (ADR-0049)
        return { pace, tdd: input.workflow?.tdd ?? (pace === 'fast' ? ('off' as const) : mode === 'simple' || nature === 'cad' ? ('preferred' as const) : this.config.workflowTdd), ponytail: input.workflow?.ponytail ?? this.config.workflowPonytail, profile: input.workflow?.profile ?? this.config.workflowProfile };
      })(),
      models: provider === 'codex' ? { strong: codexPreset!.tables[natureKey(nature)].clarifier.model, cheap: codexPreset!.tables[natureKey(nature)].housekeeping.model, worker: codexPreset!.tables[natureKey(nature)].standard.model } : provider === 'agy' ? { strong: agyModel, cheap: agyModel, worker: agyModel } : { ...this.config.models, ...(input.models ?? {}) },
      state: 'draft',
      stateBeforeBlock: null,
      costUsd: 0,
      fixCycles: 0,
      delivery: { ...IDLE_DELIVERY, policy: DeliveryPolicy.parse({ ...(this.config.defaultDelivery ?? {}), ...(input.delivery ?? {}) }) },
      attachments: [...(input.attachments?.length ? claimStaged(this.config.dataDir, id, input.attachments.map((a) => this.latestStaged(a))) : []), ...(followUp?.attachments ?? []), ...delegatedAttachments],
      baseSync: null,
      autoskills: null,
      completion: { ...IDLE_COMPLETION },
      follows: followUp?.follows ?? null,
      issue,
      schedule: input.schedule ?? null,
      // one level: a Delegated goal never delegates, whatever the caller says
      // a goal with companions needs `goal` tasks for their parts: delegation is on for it (ADR-0063)
      delegation: { allow: input.delegatedFrom ? false : companions.length > 0 || !!input.delegation?.allow, autoApprove: !!input.delegation?.autoApprove },
      delegatedFrom: input.delegatedFrom ? { ...input.delegatedFrom, at: now } : null,
      runningSince: null,
      activeMs: 0,
      activeSince: null,
      by: input.by ?? null,
      approvedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.append({ type: 'goal.created', goalId: id, payload: { goal } });
    // a goal starting in the folder refreshes its exported Learnings skill (ADR-0050)
    void exportLearningsSkill(this, goal.repoPath);
    for (const a of goal.attachments) this.staged.delete(a.id);
    if (input.autoBrief || input.brief) {
      this.store.append({ type: 'goal.state_changed', goalId: id, payload: { from: 'draft', to: 'clarifying', reason: 'auto brief' } });
      const brief = input.brief ? BriefSchema.parse({ ...input.brief, goalId: id }) : autoBrief(goal, input.autoBrief!.mustChecks, input.autoBrief!.stretchChecks ?? []);
      this.store.append({ type: 'brief.proposed', goalId: id, payload: { brief } });
      this.store.append({ type: 'goal.state_changed', goalId: id, payload: { from: 'clarifying', to: 'awaiting_brief_approval', reason: 'auto brief' } });
      // Auto preset: no human sees the Brief here, so the engine adopts the proposed budget itself
      // an Auto budget comes from the estimate as earlier goals in this folder corrected it (ADR-0056)
      // approved by whoever asked for it (ADR-0061)
      await this.approveBrief(id, brief, goal.budgetPreset === 'auto' ? proposeBudgetFromEstimate(calibratedEstimate(brief, calibrationFor(this, goal))) : undefined, undefined, input.by ?? null);
    }
    return getGoal(this.store.db, id)!;
  }

  /** Read a GitHub issue for a new goal: its thread staged as an attachment, its title and body to start from (ADR-0052). */
  readIssue(i: { ref: string; repoPath?: string | null }): Promise<IssueRead> {
    return readIssue(this, i);
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

  async installTool(id: string, onLine: (l: string) => void, provider: AgentProvider = this.config.provider): Promise<{ ok: boolean; command: string; exitCode: number | null }> {
    if (id === 'playwright') {
      const r = await this.installPlaywright(onLine);
      return { ok: r.ok, command: r.command.join(' '), exitCode: r.exitCode };
    }
    if (id === 'markitdown') {
      const r = await this.installMarkitdown(onLine);
      return { ok: r.ok, command: r.command.join(' '), exitCode: r.exitCode };
    }
    if (id === 'code-server') {
      onLine(`$ ${CODE_SERVER_INSTALL}`);
      const r = await spawnStreaming(['sh', '-lc', CODE_SERVER_INSTALL], this.config.dataDir, onLine, { timeoutMs: 10 * 60_000 });
      const ok = r.code === 0 && this.codeServer.status().installed;
      onLine(ok ? `■ installed at ${this.codeServer.binary()}` : `■ failed (exit ${r.code})`);
      this.store.append({ type: 'engine.note', goalId: null, payload: { level: ok ? 'info' : 'warn', message: `code-server install exited ${r.code}` } });
      return { ok, command: CODE_SERVER_INSTALL, exitCode: r.code };
    }
    // a coding agent's own CLI (Setup's Claude Code / Codex check), else a CLI tool from the skills catalog
    const agentCli = AGENT_CLI_IDS.includes(id as AgentCliId) ? agentCliInstall(id === 'codex-cli' ? 'codex' : id === 'antigravity-cli' ? 'agy' : 'claude') : null;
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

  /** the doctor run under way for a coding agent: the app shell and the Setup banner ask at the same moment, and one run answers both */
  private doctoring = new Map<AgentProvider, ReturnType<SkillsManager['doctor']>>();
  /** Doctor report including engine-level optional tools. */
  doctor(provider: AgentProvider = this.config.provider): ReturnType<SkillsManager['doctor']> {
    const running = this.doctoring.get(provider);
    if (running) return running;
    const run = this.runDoctor(provider).finally(() => this.doctoring.delete(provider));
    this.doctoring.set(provider, run);
    return run;
  }
  private async runDoctor(provider: AgentProvider) {
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
    const rea = await this.reaEnginesCheck(provider);
    const cad = await this.cadToolsCheck(provider);
    return this.skillsForProvider(provider).doctor([check, this.modelsCheck(provider), notif, ...(rea ? [rea] : []), cad, ...(provider === 'agy' ? [] : await this.mcpFor(provider).doctorChecks())]);
  }

  /**
   * text-to-cad's tools on this computer: uv, which runs cadgen (a problem only once the plugin is installed), and the
   * desktop apps its hand-offs would open, which stay behind Settings → Safety → Desktop apps & printers.
   */
  private async cadToolsCheck(provider: AgentProvider) {
    const statuses = await this.providerSkills[provider].status().catch(() => []);
    const installed = statuses.some(Engine.cadInstalled);
    const uv = Bun.which('uvx') ?? Bun.which('uv');
    const apps = [
      ...(['/Applications/OrcaSlicer.app', '/Applications/BambuStudio.app', '/Applications/Bambu Studio.app', '/Applications/Bambu Connect.app'].filter((p) => existsSync(p)).map((p) => basename(p, '.app'))),
      ...(Bun.which('orca-slicer') ? ['orca-slicer'] : []),
      ...(Bun.which('bambu-studio') ? ['bambu-studio'] : []),
    ];
    const appsNote = apps.length ? `${apps.join(', ')} found: hand-offs to them run only while Settings → Safety → Desktop apps & printers is on` : 'no slicer or printer app found (optional: OrcaSlicer, Bambu Studio, Bambu Connect)';
    const label = 'CAD tools — text-to-cad (optional)';
    if (uv) return { id: 'cad-tools', label, ok: true, severity: 'warn' as const, detail: `uv at ${uv} runs cadgen${installed ? '' : ' once text-to-cad is installed (Setup → 3D models)'}; ${appsNote}`, fix: null };
    return { id: 'cad-tools', label, ok: !installed, severity: 'warn' as const, detail: `uv not found: cadgen, the CAD kernel behind text-to-cad's skills and its cad server, runs through uv${installed ? ' — the installed plugin cannot work without it' : ''}; ${appsNote}`, fix: { command: 'curl -LsSf https://astral.sh/uv/install.sh | sh', url: 'https://docs.astral.sh/uv/getting-started/installation/' } };
  }

  /**
   * With REA installed: whether a native analysis engine is on this computer. Websites, JavaScript and Electron apps,
   * .NET and Android packages need none; native apps and binaries need Hopper, Ghidra or IDA.
   */
  private async reaEnginesCheck(provider: AgentProvider) {
    if (provider === 'agy') return null; // its MCP servers are agy's own
    const view = await this.mcpFor(provider).view();
    if (!view.catalog.some((c) => c.entry.id === 'rea' && c.installed)) return null;
    const env = process.env;
    const found = [
      env.GHIDRA_INSTALL_DIR && existsSync(env.GHIDRA_INSTALL_DIR) ? `Ghidra at ${env.GHIDRA_INSTALL_DIR}` : null,
      !env.GHIDRA_INSTALL_DIR && (Bun.which('ghidraRun') || Bun.which('ghidra')) ? 'Ghidra on PATH' : null,
      env.HOPPER_LAUNCHER_PATH && existsSync(env.HOPPER_LAUNCHER_PATH) ? 'Hopper (HOPPER_LAUNCHER_PATH)' : null,
      ['/Applications/Hopper Disassembler v5.app', '/Applications/Hopper Disassembler.app'].some((p) => existsSync(p)) ? 'Hopper in /Applications' : null,
      env.REA_IDA_MCP_CONFIG && existsSync(env.REA_IDA_MCP_CONFIG) ? 'IDA (REA_IDA_MCP_CONFIG)' : null,
    ].filter((x): x is string => !!x);
    return found.length
      ? { id: 'rea-native', label: 'REA native engines (optional)', ok: true, severity: 'warn' as const, detail: `${found.join(', ')} — REA can analyse native apps and binaries`, fix: null }
      : { id: 'rea-native', label: 'REA native engines (optional)', ok: false, severity: 'warn' as const, detail: 'no Hopper, Ghidra or IDA found — REA analyses websites, JavaScript/Electron apps, .NET and Android packages; native apps and binaries need one of them (Ghidra is free: install it and set GHIDRA_INSTALL_DIR)', fix: { url: 'https://github.com/morluto/rea/blob/main/docs/installation.md' } };
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

  /** the human answered the round a Revise asked: the proposal, or one more round */
  async answerRevise(goalId: string, ans: ReviseAnswer): Promise<DraftProposal> {
    return answerRevise(this, this.mustGoal(goalId), ans);
  }

  /** a second opinion on the Brief awaiting approval (ADR-0051): the proposal, also kept as an event for the page */
  secondOpinion(goalId: string): Promise<DraftProposal> {
    return secondOpinion(this, goalId);
  }

  /** the goal's last second opinion, against the Brief as it is now */
  secondOpinionOf(goalId: string): SecondOpinionView | null {
    return secondOpinionOf(this, goalId);
  }

  /** asked for from the page: checked now (the reasons it cannot start are thrown), written in the background; the goal detail carries it from here */
  startSecondOpinion(goalId: string): void {
    startSecondOpinion(this, goalId);
  }

  /** why the goal's last second opinion did not come in, until one does */
  secondOpinionFailureOf(goalId: string): SecondOpinionFailure | null {
    return secondOpinionFailureOf(this, goalId);
  }

  /** the human let an asking Revise go */
  cancelRevise(goalId: string): void {
    cancelRevise(this, this.mustGoal(goalId));
  }

  /**
   * The Brief page's edits. While the stored Brief is a skeleton (the planner still splitting the goal into tasks,
   * ADR-0046), only its skeleton fields are taken — title, understanding, Areas, assumptions, questions, goal-level
   * checks, how to run it, style directions — and the tasks, task-level checks and estimate stay as stored; `skeleton`
   * says the page was editing one, which protects a save that crosses the plan's arrival. Otherwise the whole Brief is
   * replaced.
   */
  editBrief(goalId: string, brief: Brief, opts: { skeleton?: boolean } = {}): Brief {
    const goal = this.mustGoal(goalId);
    const stored = getBrief(this.store.db, goalId);
    if (goal.state !== 'awaiting_brief_approval' && !(goal.state === 'clarifying' && stored?.skeleton)) throw new Error(`goal is ${goal.state}, brief cannot be edited`);
    const merged =
      stored && (opts.skeleton || stored.skeleton)
        ? { ...stored.brief, title: brief.title, understanding: brief.understanding, areas: brief.areas, assumptions: brief.assumptions, questions: brief.questions, run: brief.run, apps: brief.apps, styleOptions: brief.styleOptions, checks: [...brief.checks.filter((c) => c.taskKey === null), ...stored.brief.checks.filter((c) => c.taskKey !== null)] }
        : brief;
    // Subjects change only through their own events: a page's copy may predate pictures that arrived since
    const parsed = BriefSchema.parse({ ...merged, goalId, subjects: stored?.brief.subjects });
    this.store.append({ type: 'brief.edited', goalId, payload: { brief: parsed } });
    return parsed;
  }

  /**
   * Approve the Brief and materialise its tasks and checks.
   * `budgets` (optional) is applied first — this is how the Auto preset's proposed budget, confirmed or edited
   * by the human on the Brief page, becomes the goal's budget before any work starts.
   */
  async approveBrief(goalId: string, edited?: Brief, budgets?: Partial<Budgets>, completion?: { graphRefresh?: boolean; docs?: DocType[]; audit?: boolean; qa?: boolean }, by?: string | null): Promise<void> {
    const goal = this.mustGoal(goalId);
    if (goal.state !== 'awaiting_brief_approval') throw new Error(`goal is ${goal.state}, cannot approve`);
    // a Revise still waiting for answers is let go: the Brief as it stands is what runs
    cancelRevise(this, goal);
    // the report lands as an attachment and a commit on the goal branch: not under running tasks
    if (this.investigating.has(goalId)) throw new Error('the references are being investigated now; approve the Brief when the report is in');
    const searching = subjectSearchesFor(goalId);
    if (searching.length) throw new Error(`pictures of the Subjects (${searching.join(', ')}) are being found now; approve the Brief when they are in`);
    const stored = getBrief(this.store.db, goalId)?.brief;
    const brief = BriefSchema.parse({ ...(edited ?? stored), goalId, subjects: stored?.subjects });
    const unanswered = brief.questions.filter((q) => q.blocking && !q.answer?.trim());
    if (unanswered.length) throw new Error(`blocking questions unanswered: ${unanswered.map((q) => q.text).join(' | ')}`);
    topoSort(brief.tasks.map((t) => ({ id: t.key, dependsOn: t.dependsOnKeys })));
    if (!brief.tasks.length) throw new Error('brief has no tasks');

    const ws = await this.ensureSyncedWorkspace(goal);
    this.startAutoskills(goal, ws);
    // completion actions: what the UI sent, holes filled from the Brief (Simple mode and API callers send nothing)
    const inferred = inferCompletion(brief, ws, goal.workflow.pace, this.config.workflowAudit, this.config.workflowQa);
    // a Delegated goal has no completion actions of its own: the main goal documents, audits and refreshes the graph once everything landed
    const chosen = goal.delegatedFrom ? { graphRefresh: false, docs: [] as DocType[], audit: false, qa: false } : completion;
    this.store.append({
      type: 'goal.completion_set',
      goalId,
      payload: { graphRefresh: chosen?.graphRefresh ?? inferred.graphRefresh, docs: chosen?.docs ?? inferred.docs, audit: chosen?.audit ?? inferred.audit, qa: chosen?.qa ?? inferred.qa, reason: goal.delegatedFrom ? 'delegated goal: the main goal completes' : completion ? 'set at brief approval' : inferred.reason },
    });
    if (budgets && Object.keys(budgets).length) {
      const next = Budgets.parse({ ...goal.budgets, ...budgets, ...(!reportsDollars(goal.provider) ? { maxCostUsd: null } : {}) });
      this.store.append({ type: 'goal.budgets_changed', goalId, payload: { budgets: next, reason: goal.budgetPreset === 'auto' ? 'auto-from-brief' : 'set at brief approval' } });
    }
    const now = new Date().toISOString();
    const idByKey = new Map<string, string>();
    for (const t of brief.tasks) idByKey.set(t.key, newId(IdPrefix.task));
    this.store.append({ type: 'brief.approved', goalId, payload: { brief, by: by ?? null } });
    for (const t of brief.tasks) {
      const area = brief.areas.find((a) => a.key === t.areaKey) ?? null;
      const task: Task = {
        id: idByKey.get(t.key)!,
        goalId,
        title: t.title,
        spec: t.spec,
        // one level: a Delegated goal never delegates again
        kind: t.kind === 'goal' && goal.delegatedFrom ? 'feature' : t.kind,
        // the commit scope defaults to the Area's slug (Conventional Commits: feat(student-portal): …)
        scope: t.scope?.trim() || area?.slug || null,
        scenario: t.scenario ?? 'general',
        area: area?.name ?? null,
        // docs, infra, research and media work gets no TDD mandate regardless of the goal's discipline
        tdd: t.tdd === 'off' || ['docs', 'infra', 'research', 'image', 'video'].includes(t.scenario ?? 'general') ? 'off' : 'inherit',
        dependsOn: t.dependsOnKeys.map((k) => idByKey.get(k)!),
        relevantFiles: t.relevantFiles,
        delivers: cleanDeliverables(t.delivers),
        budgetUsd: t.kind === 'goal' && t.budgetUsd ? t.budgetUsd : null,
        // a companion's part (ADR-0063): only a path the goal named
        repo: t.kind === 'goal' && t.repo && (goal.companions ?? []).some((c) => c.repoPath === t.repo) ? t.repo : null,
        milestone: t.milestone ?? null,
        milestoneScript: t.milestone ? (t.milestoneScript ?? null) : null,
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
        delegatedGoalId: null,
        summary: null,
        createdAt: now,
        updatedAt: now,
      };
      this.store.append({ type: 'task.created', goalId, payload: { task } });
      // a feature milestone's script is its task's must check: the feature cannot land unless what it shows works
      const script = task.milestoneScript;
      if (script && !brief.checks.some((c) => c.taskKey === t.key && c.spec.type === 'command' && c.spec.cmd.includes(script) && /playwright/.test(c.spec.cmd))) {
        const check: Check = { id: newId(IdPrefix.check), goalId, taskId: task.id, name: `${MILESTONE_CHECK_PREFIX}${script}`, tier: 'must', spec: milestoneCheckSpec(script) };
        this.store.append({ type: 'check.created', goalId, payload: { check } });
      }
      // the files the task promises to the tasks after it are its must checks (a goal task's are its Delegated goal's, below)
      if (task.kind !== 'goal') {
        for (const path of task.delivers ?? []) {
          if (brief.checks.some((c) => c.taskKey === t.key && c.spec.type === 'command' && c.spec.cmd === deliversCheckSpec(path).cmd)) continue;
          const check: Check = { id: newId(IdPrefix.check), goalId, taskId: task.id, name: deliversCheckName(path), tier: 'must', spec: deliversCheckSpec(path) };
          this.store.append({ type: 'check.created', goalId, payload: { check } });
        }
      }
    }
    // a Delegated goal is held to what its main goal's task promised: those files are its goal-level must checks, so its review sees them
    if (goal.delegatedFrom) {
      for (const path of getTask(this.store.db, goal.delegatedFrom.taskId)?.delivers ?? []) {
        if (brief.checks.some((c) => !c.taskKey && c.spec.type === 'command' && c.spec.cmd === deliversCheckSpec(path).cmd)) continue;
        const check: Check = { id: newId(IdPrefix.check), goalId, taskId: null, name: deliversCheckName(path), tier: 'must', spec: deliversCheckSpec(path) };
        this.store.append({ type: 'check.created', goalId, payload: { check } });
      }
    }
    for (const c of brief.checks) {
      const taskId = c.taskKey ? idByKey.get(c.taskKey) : null;
      if (c.taskKey && !taskId) throw new Error(`check ${c.name} references unknown task ${c.taskKey}`);
      // the planner ran a task's milestone script itself: on free ports and Chromium, the way Foundry records it
      const script = brief.tasks.find((t) => t.key === c.taskKey && t.milestone)?.milestoneScript;
      const spec = script && c.spec.type === 'command' && c.spec.cmd.includes(script) && /playwright/.test(c.spec.cmd) ? { ...c.spec, ports: true, milestone: script } : c.spec;
      const check: Check = { id: newId(IdPrefix.check), goalId, taskId: taskId ?? null, name: c.name, tier: c.tier, spec };
      this.store.append({ type: 'check.created', goalId, payload: { check } });
    }
    ensureSelfCheck(this, getGoal(this.store.db, goalId)!);
    this.store.append({ type: 'goal.state_changed', goalId, payload: { from: 'awaiting_brief_approval', to: 'running', reason: 'brief approved' } });
  }

  async answerEscalation(id: string, answer: EscalationAnswer, by?: string | null): Promise<void> {
    await answerEsc(this, id, answer, by);
  }

  // ---------- delivery ----------

  /** Set (or change) the delivery policy; runs immediately when the goal is already finished. */
  async deliver(goalId: string, policyIn: Partial<DeliveryPolicy>, source: 'deliver' | 'retry' | 'resume' | 'review' = 'deliver'): Promise<Goal> {
    const goal = this.mustGoal(goalId);
    if (goal.delivery.status === 'running') throw new Error('delivery is already running');
    const policy = DeliveryPolicy.parse({ ...goal.delivery.policy, ...policyIn });
    this.refuseStructural(goal, policy);
    await this.checkDeliverable(goal, policy);
    this.store.append({ type: 'delivery.policy_set', goalId, payload: { policy, source } });
    // the companions' goals are delivered the same way, each in its repository (ADR-0063)
    await deliverCompanions(this, goal, policy, source);
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

  /** how far earlier goals ran from their estimate, for this goal's Brief (ADR-0056) */
  calibrationFor(goal: Pick<Goal, 'id' | 'repoPath' | 'nature'>): Calibration {
    return calibrationFor(this, goal);
  }

  // ---------- schedules (ADR-0054) ----------

  /** every Schedule with when it fires next and the goal of its last run */
  listSchedules(): (Schedule & { nextRunAt: string | null; lastGoal: { id: string; title: string; state: Goal['state'] } | null })[] {
    return listSchedules(this.store.db).map((s) => {
      const g = s.lastRun?.goalId ? getGoal(this.store.db, s.lastRun.goalId) : null;
      return { ...s, nextRunAt: nextRunAt(s)?.toISOString() ?? null, lastGoal: g ? { id: g.id, title: g.title, state: g.state } : null };
    });
  }
  schedule(id: string): Schedule | null {
    return getSchedule(this.store.db, id);
  }
  saveSchedule(input: ScheduleInput): Schedule {
    return saveSchedule(this, input);
  }
  setScheduleEnabled(id: string, enabled: boolean): Schedule {
    return setScheduleEnabled(this, id, enabled);
  }
  deleteSchedule(id: string): void {
    deleteSchedule(this, id);
  }
  /** "Run now": fire the schedule at once; refuses while its previous run is still going */
  async runSchedule(id: string): Promise<{ goalId: string | null; skipped: string | null }> {
    const s = getSchedule(this.store.db, id);
    if (!s) throw new Error(`schedule ${id} not found`);
    return fireSchedule(this, s, { manual: true });
  }

  /** a folder's Learnings (ADR-0040) */
  learnings(repoPath: string): Learning[] {
    return learningsOf(this, repoPath);
  }
  /** the person's edit of a folder's Learnings: the whole list, as they want it */
  setLearnings(repoPath: string, entries: { id?: string | null; kind: Learning['kind']; text: string }[]): Learning[] {
    return setLearnings(this, repoPath, entries);
  }
  /** learn from this goal now (it ended, or the person asks again); resolves when the folder's notebook is written */
  learnFrom(goalId: string): Promise<void> {
    const goal = this.mustGoal(goalId);
    if (!endedForLearning(goal.state)) throw new Error(`the goal is ${goal.state.replace(/_/g, ' ')}: it teaches its folder once it ended done, over-delivered or failed`);
    return learnFromGoal(this, goalId, { force: true });
  }

  /** Deploy the finished goal's web app (ADR-0041): what is wrong is thrown at once, the deploy runs in the background */
  deploy(goalId: string, req: DeployRequest): void {
    startDeploy(this, goalId, req);
  }
  /** Smoke again (ADR-0058): the goal's milestone scripts against a live deploy's address once more, in the background */
  smokeDeployment(goalId: string, deployedAt: string): void {
    smokeAgain(this, goalId, deployedAt);
  }
  /** Revert (ADR-0059): a pull request that undoes the goal's merged delivery; what is wrong is thrown at once, the rest runs in the background */
  revert(goalId: string, req: RevertRequest = {}): void {
    startRevert(this, goalId, req);
  }
  /** what a Revert would undo, and whether one can start now */
  revertInfo(goalId: string): RevertInfo {
    return revertInfo(this, this.mustGoal(goalId));
  }
  /** what Deploy can do for a goal now: whether its code is a web app, which hosts are set up and take it, the commands, the deploys so far */
  deployInfo(goalId: string, provider?: DeployProvider, production = false) {
    const goal = this.mustGoal(goalId);
    const app = goalDeployability(this, goal);
    const c = deployCredentials(this);
    return {
      app,
      finished: DEPLOYABLE_STATES.has(goal.state),
      running: deploying(goalId),
      smoking: smoking(goalId),
      // the smoke a deploy can have (ADR-0058): the goal's milestone scripts
      smoke: { scripts: smokeScripts(this, goalId).map((s) => s.script) },
      providers: DEPLOY_PROVIDERS.map((id) => ({ id, label: PROVIDER_LABEL[id], configured: configured(id, c), refused: unsupported(id, app) })),
      // the exact commands a deploy runs, tokens left out: nothing else runs
      plan: provider && app.ok ? deploySteps({ provider, cwd: `<deploy folder>/${app.app.dir}`.replace(/\/$/, ''), kind: app.app.kind, name: deployName(goal), production, branch: goal.branch.replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 28), productionBranch: goal.baseBranch, install: app.app.install, build: app.app.build, outputDir: app.app.outputDir, message: `${goal.title} (Foundry)`, credentials: c, cli: this.deployCli }).map((s) => ({ label: s.label, command: redact(s.argv.join(' '), c) })) : [],
      deployments: goal.deployments ?? [],
    };
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
  async restartGoal(goalId: string, opts: { fromTaskId?: string; fromTaskIds?: string[] } = {}): Promise<{ restarted: string[] }> {
    // not while the tidy-up after its merge removes its folders, and none starts removing them while this runs
    if (this.removingFolders.has(goalId)) throw new Error("the goal's folders are being removed (Clean up anyway); restart it once that has finished");
    this.restarting.add(goalId);
    try {
      return await this.restartNow(goalId, opts);
    } finally {
      this.restarting.delete(goalId);
    }
  }

  private async restartNow(goalId: string, opts: { fromTaskId?: string; fromTaskIds?: string[] }): Promise<{ restarted: string[] }> {
    const goal = this.mustGoal(goalId);
    if (!['failed', 'cancelled', 'done', 'over_delivered', 'blocked', 'running'].includes(goal.state)) throw new Error(`goal is ${goal.state}; restart applies to running or finished goals`);
    const tasks = listTasks(this.store.db, goalId);
    let targets: Task[];
    // the tasks to start from: one the person chose, or the failed ones a Delegated goal's main goal restarts together
    const roots = opts.fromTaskIds?.length ? opts.fromTaskIds : opts.fromTaskId ? [opts.fromTaskId] : [];
    if (roots.length) {
      const set = new Set<string>();
      for (const id of roots) {
        if (!tasks.some((t) => t.id === id)) throw new Error(`task ${id} not found`);
        set.add(id);
      }
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
    // a commit a merge attempt left that git would not take back goes before the escalation that names it closes (an
    // aborted goal's too): taken back now, or the restart is refused with what is left to do
    for (const stuck of stuckCommits(this, goalId, { all: true })) {
      const left = await takeBackStuck(this, goal, stuck);
      if (left) throw new Error(left);
    }
    // open escalations on these tasks are moot now
    for (const esc of listEscalations(this.store.db, { goalId, openOnly: true })) {
      if (esc.taskId && targets.some((t) => t.id === esc.taskId)) this.store.append({ type: 'escalation.answered', goalId, payload: { escalationId: esc.id, answer: { action: 'retry_with_hint' } } });
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
      const by = opts.fromTaskIds?.length ? 'the main goal' : 'user';
      this.store.append({ type: 'task.restarted', goalId, payload: { taskId: t.id, extraAttempts: over, reason: roots.length ? `restarted by ${by} from ${roots.includes(t.id) ? 'this task' : 'an upstream task'}` : 'restarted by user' } });
    }
    if (goal.state !== 'running') this.store.append({ type: 'goal.state_changed', goalId, payload: { from: goal.state, to: 'running', reason: roots.length ? `restarted from task${roots.length > 1 ? 's' : ''} ${roots.join(', ')}` : 'restarted' } });
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
    // an Imported Goal whose repository was never mapped has nothing here to clean up: its path may name another checkout
    const repoOk = repoHere(goal) && (await isGitRepo(goal.repoPath).catch(() => false));
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
    trashSubjects(this.config.dataDir, goalId);
    rmSync(transferGoalDir(this.config.dataDir, goalId), { recursive: true, force: true });
    this.store.append({ type: 'goal.deleted', goalId, payload: { title: goal.title, deletedBranch, reason: 'deleted by user' } });
    // a Delegated goal deleted while its main goal waits for it: the main goal's task is told at its next pass
    if (goal.delegatedFrom) this.tick(goal.delegatedFrom.goalId);
    return { deletedBranch };
  }

  /**
   * Called by the boundary hook (via the server) when a call was refused: a command that leaves the workspace, a command
   * that opens a desktop app or hands a file to a printer (`desktop`), or a skill that does (`skill`). A refused skill
   * is nothing a person could run on the agent's behalf: it is noted on the goal, not put in the Inbox.
   */
  handleBoundaryCallback(attemptId: string | null, payload: any, reason: string | null = null): void {
    const command = String(payload?.tool_input?.command ?? '');
    const skill = String(payload?.tool_input?.skill ?? '');
    const attempt = attemptId ? getAttempt(this.store.db, attemptId) : null;
    const goalId = attempt?.goalId ?? null;
    if (!goalId) {
      this.config.log(`[boundary] blocked ${reason === 'skill' ? `skill ${skill}` : `command ${command}`} outside a known attempt`);
      return;
    }
    const goal = getGoal(this.store.db, goalId)!;
    const task = attempt ? getTask(this.store.db, attempt.taskId) : null;
    const agent = PROVIDER_NAME[goal.provider ?? this.config.provider];
    this.store.append({ type: 'boundary.blocked', goalId, payload: { taskId: task?.id ?? null, attemptId, command, ...(reason ? { reason } : {}), ...(skill ? { skill } : {}) } });
    if (reason === 'skill') {
      this.store.append({ type: 'engine.note', goalId, payload: { level: 'warn', message: `${agent} asked for the skill ${skill}, which opens a desktop app or hands a file to a printer on this computer; it was refused and the work goes on without it. Settings → Safety → Desktop apps & printers opens it.` } });
      return;
    }
    const desktop = reason === 'desktop';
    raiseEscalation(this, {
      goal,
      task: null,
      attemptId,
      trigger: 'boundary_action',
      message: desktop
        ? `${agent} tried to open a desktop app or hand a file to a printer on this computer while working on "${task?.title ?? '?'}":\n\n    ${command}\n\nSettings → Safety → Desktop apps & printers is off, so it was blocked. Approve to run it once on your behalf (the app opens on this computer), or deny.`
        : `${agent} tried to run a command that leaves the local workspace while working on "${task?.title ?? '?'}":\n\n    ${command}\n\nIt was blocked. Approve to run it once on your behalf, or deny.`,
      payload: { command, cwd: attempt?.cwd ?? null, taskId: task?.id ?? null, ...(desktop ? { kind: 'desktop' } : {}) },
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
