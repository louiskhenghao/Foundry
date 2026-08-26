import { join } from 'node:path';
import type { Attachment, Brief, BudgetPreset, DocType, Escalation, EscalationAnswer, EscalationSuggestion, Goal, GoalMode, GoalNature, GoalWorkflow, ModelConfig, Task, Check } from '@ai-engine/core';
import {
  BUDGET_PRESETS,
  Budgets,
  DeliveryPolicy,
  IDLE_DELIVERY,
  proposeBudgetFromEstimate,
  renderDecisions,
  IDLE_COMPLETION,
  EventStore,
  IdPrefix,
  getAttempt,
  getBrief,
  getGoal,
  getTask,
  listAttempts,
  listEscalations,
  listGoals,
  listRunningAttempts,
  listTasks,
  newId,
  openDatabase,
  topoSort,
  Brief as BriefSchema,
} from '@ai-engine/core';
import { ClaudeCliRunner, type ClaudeRunner, type RunHandle } from '@ai-engine/runner';
import { runClarify } from './clarify.ts';
import { type DraftProposal, type DraftRequest, runDraft } from './brief-draft.ts';
import { runSuggest } from './escalation-suggest.ts';
import type { EngineConfig } from './config.ts';
import { GrepContextProvider } from './context/grep-provider.ts';
import { GraphifyContextProvider } from './context/graphify-provider.ts';
import { summarizeOutput } from './distill/summarize.ts';
import type { ContextProvider } from './context/provider.ts';
import { answerEscalation as answerEsc, raiseEscalation } from './escalation.ts';
import { branchExists, currentBranch, git, isGitRepo } from './git/git.ts';
import { fetchBase, startRef } from './git/sync.ts';
import { mergeBranchInto } from './merge.ts';
import { runGoalReview } from './goal-review.ts';
import { Roles } from './roles.ts';
import { schedule } from './scheduler.ts';
import { SkillsManager } from './skills/manager.ts';
import { ClaudeAuth } from './auth/claude-auth.ts';
import { CliGh, type GhClient } from './delivery/gh.ts';
import { probeForPlan, runDelivery } from './delivery/pipeline.ts';
import { planDelivery } from './delivery/policy.ts';
import { usageSummary, type UsageSummary } from './usage/ledger.ts';
import type { RunResult } from '@ai-engine/runner';
import type { StreamEvent, StreamListener } from './types.ts';
import { deliveryWorkspacePath, dropTaskWorkspace, ensureGoalWorkspace, goalWorkspacePath, listStackBranches } from './workspace.ts';
import { attachmentDir, claimStaged, conversionTmpPath, markdownFileName, sweepStaging, trashAttachment } from './attachments.ts';
import { Markitdown } from './convert/markitdown.ts';
import { SettingsStore, applySettingsToConfig } from './settings.ts';
import { ModelFallbackRunner } from './models/fallback-runner.ts';
import { ModelRegistry, SEED_MODELS, isPinnedId, type ModelRecord } from './models/registry.ts';
import { copyProjectSkills, hasStackManifest, runAutoskills, type AutoskillsDeps } from './skills/autoskills.ts';
import { deliverArtifacts, inferCompletion, runGraphRefresh, shouldRunGraphRefresh, type GraphRefreshDeps } from './completion.ts';
import type { SettingsPatch, SettingsView } from '@ai-engine/core';
import { spawnStreaming } from './skills/updaters.ts';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { removeWorktree } from './git/git.ts';
import { BaselineChecks } from './checks/baseline.ts';
import { relative, resolve } from 'node:path';

export interface CreateGoalInput {
  title?: string;
  prompt: string;
  repoPath: string;
  baseBranch?: string;
  budgets?: Partial<Budgets>;
  /** Preset the budgets were derived from (default custom). `auto` = Brief proposes the budget. */
  budgetPreset?: BudgetPreset;
  models?: Partial<ModelConfig>;
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
  readonly auth: ClaudeAuth;
  readonly gh: GhClient;
  context: ContextProvider;
  private delivering = new Map<string, AbortController>();
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
  private rateLimitedUntil: number | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  readonly settings: SettingsStore;
  /** what this machine has learned about model names (requested → resolved id, last ok/fail) */
  readonly models: ModelRegistry;
  /** autoskills runs in progress, per goal (tasks wait for them before their first attempt) */
  private autoskillsRuns = new Map<string, Promise<void>>();
  /** test seam: deps handed to runAutoskills (fake npx / node version) */
  autoskillsDeps: AutoskillsDeps = {};
  /** test seam: deps handed to runGraphRefresh (fake which/exec) */
  graphRefreshDeps: GraphRefreshDeps = {};

  constructor(
    public readonly config: EngineConfig,
    runner?: ClaudeRunner,
    gh?: GhClient,
  ) {
    // settings file > env > defaults: only file-sourced leaves override the env-built config (code overrides stay)
    this.settings = new SettingsStore(config.dataDir, process.env, config.log);
    applySettingsToConfig(config, this.settings.values(), this.settings.fileLeaves());
    this.gh = gh ?? new CliGh({ onCommand: (cmd, cwd, r, ms) => config.log(`[gh] ${cmd.slice(0, 4).join(' ')} → ${r.code} (${ms}ms) ${cwd}`) });
    this.store = new EventStore(openDatabase(join(config.dataDir, 'engine.db')));
    const baseRunner =
      runner ??
      new ClaudeCliRunner({
        claudeBin: config.claudeBin,
        maxConcurrent: config.maxConcurrent,
        env: { AI_ENGINE_CALLBACK: `http://${config.host}:${config.port}` },
        log: config.log,
      });
    this.models = new ModelRegistry(config.dataDir);
    // every session goes through the fallback layer: unavailable model → next candidate, and the registry learns what resolves
    this.runner = new ModelFallbackRunner(baseRunner, {
      fallbacks: () => config.modelFallbacks,
      registry: this.models,
      log: config.log,
      onFallback: ({ spec, from, to, reason }) => {
        const goalId = spec.meta?.goalId ?? null;
        const tier = (spec.meta?.tier as 'strong' | 'cheap' | 'worker' | undefined) ?? null;
        this.store.append({ type: 'goal.models_changed', goalId, payload: { tier, from, to, reason } });
        this.store.append({ type: 'engine.note', goalId, payload: { level: 'warn', message: `model ${from} is unavailable (${reason}); ${tier ? `${tier} sessions of this goal` : 'this session'} now use ${to}` } });
      },
    });
    this.roles = new Roles(config.rolesDir);
    this.skills = new SkillsManager({
      claudeHome: config.claudeHome,
      dataDir: config.dataDir,
      catalogPath: config.catalogPath,
      claudeBin: config.claudeBin,
      log: config.log,
      // user skills only load when user settings are in scope
      hintsEnabled: () => !config.settingSources || config.settingSources.includes('user'),
      workflowProfile: () => config.workflowProfile ?? 'mattpocock',
      packs: () => ({ design: config.designPack, image: config.imagePack, video: config.videoPack }),
      // every updater run is an audit event (goalId null, informational)
      onRun: (run) => this.store.append({ type: 'skills.update_run', goalId: null, payload: { sourceId: run.sourceId, updater: run.updater, command: run.command, cwd: run.cwd, exitCode: run.exitCode, durationMs: run.durationMs, outputTail: run.outputTail, changed: run.changed, error: run.error } }),
    });
    this.auth = new ClaudeAuth({ claudeBin: config.claudeBin ?? Bun.which('claude'), log: config.log });
    this.markitdown = new Markitdown({ bin: config.markitdownBin, log: config.log });
    this.context = this.buildContext();
    config.log(`[engine] context provider: ${this.context.name}`);
    this.store.subscribe((e) => {
      if (e.goalId) this.tick(e.goalId);
    });
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
    const { changed, view } = this.settings.update(patch);
    this.applySettingsChange(changed);
    return view;
  }
  resetSettings(path?: string): SettingsView {
    const { changed, view } = this.settings.reset(path);
    this.applySettingsChange(changed);
    return view;
  }
  private applySettingsChange(changed: string[]): void {
    if (!changed.length) return;
    applySettingsToConfig(this.config, this.settings.values(), new Set(changed));
    if (changed.includes('engine.maxConcurrent')) this.runner.setMaxConcurrent?.(this.config.maxConcurrent);
    if (changed.includes('tools.useGraphify')) {
      this.context = this.buildContext();
      this.config.log(`[engine] context provider: ${this.context.name}`);
    }
    if (changed.includes('tools.markitdownBin')) this.markitdown = new Markitdown({ bin: this.config.markitdownBin, log: this.config.log });
    if (changed.some((k) => k.startsWith('workflow.'))) this.skills.hints.invalidate();
    const restartNeeded = this.settings.restartNeeded();
    this.store.append({ type: 'settings.changed', goalId: null, payload: { keys: changed, restartNeeded } });
    this.config.log(`[settings] changed ${changed.join(', ')}${restartNeeded.length ? ` (restart needed for ${restartNeeded.join(', ')})` : ''}`);
  }

  // ---------- base branch sync ----------

  /**
   * The goal worktree, created from the right tip: the base branch is fetched first (remote-tracking refs only,
   * the user's checkout is untouched) and, when the local base is behind, the goal branch starts from
   * `<remote>/<base>`. Records `goal.base_synced` once; later calls just return the existing worktree.
   */
  async ensureSyncedWorkspace(goal: Goal): Promise<string> {
    const path = goalWorkspacePath(this.config.dataDir, goal.id);
    if (goal.baseSync || existsSync(path) || (await branchExists(goal.branch, goal.repoPath).catch(() => false))) return ensureGoalWorkspace(this.config.dataDir, goal);
    const s = await fetchBase(goal.repoPath, goal.baseBranch, { fetch: this.config.sync.fetchBeforeGoal });
    const start = startRef(s, this.config.sync.startFrom);
    const ws = await ensureGoalWorkspace(this.config.dataDir, goal, { startRef: start.ref });
    const detail = `${start.reason}${s.error ? ` (${s.error})` : ''}`;
    this.store.append({ type: 'goal.base_synced', goalId: goal.id, payload: { remote: s.remote, base: s.base, localRef: s.localRef, remoteRef: s.remoteRef, ahead: s.ahead, behind: s.behind, fetched: s.fetched, startedFrom: start.from, detail } });
    if (start.from === 'remote' || s.error) this.config.log(`[sync] ${goal.id}: goal branch starts from ${start.ref} — ${detail}`);
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
    const ws = goalWorkspacePath(this.config.dataDir, goalId);
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
    const ws = goalWorkspacePath(this.config.dataDir, goal.id);
    const ref = `${s.remote}/${s.base}`;
    if ((await git(['merge-base', '--is-ancestor', ref, 'HEAD'], ws)).code === 0) return;
    const now = new Date().toISOString();
    const task: Task = { id: newId(IdPrefix.task), goalId: goal.id, title: `sync ${goal.branch} with ${ref}`, spec: `${ref} moved while this goal was running. Merge it into ${goal.branch} so the remaining tasks build on the current base.`, kind: 'chore', scope: 'sync', scenario: 'general', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: false, retryBudget: 2, origin: 'merge', state: 'merging', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, createdAt: now, updatedAt: now };
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
      const r = await runAutoskills(ws, { log: this.config.log, ...this.autoskillsDeps }, onLine);
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
    const ws = goalWorkspacePath(this.config.dataDir, goalId);
    if (!hasStackManifest(ws)) return;
    this.startAutoskills(goal, ws);
    void this.awaitAutoskills(goalId).then(() => {
      const fresh = getGoal(this.store.db, goalId);
      if (fresh?.autoskills?.status !== 'installed') return;
      for (const t of listTasks(this.store.db, goalId)) {
        if (t.worktreePath && existsSync(t.worktreePath)) {
          try {
            copyProjectSkills(ws, t.worktreePath);
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
    for (const g of listGoals(this.store.db)) this.tick(g.id);
  }

  /** set by stop(): no new ticks run, so nothing writes to the store after shutdown (tests delete it right after) */
  private stopped = false;

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    for (const [, f] of this.inFlight) f.handle?.kill('killed_manual');
    // reviews, clarify, merges and probes are not in `inFlight`: kill every child the runner still owns
    const n = (this.runner as { killAll?: () => number }).killAll?.() ?? 0;
    if (n) this.config.log(`[engine] stopped ${n} claude session(s) on shutdown`);
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
        cwd,
        onCost: (usd) => usd > 0 && this.store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: usd, source: 'distill' } }),
        onResult: (r) => this.recordSessionUsage(r, { goalId: goal.id, kind: 'distill', model: goal.models.cheap }),
      });
  }

  // ---------- usage & rate limits ----------

  /** Single funnel for every finished session: ledger event + rate-limit observation. */
  recordSessionUsage(result: RunResult, meta: { goalId: string | null; kind: string; model?: string | null }): void {
    const u: any = result.usage ?? {};
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    const modelFromUsage = result.modelUsage && typeof result.modelUsage === 'object' ? Object.keys(result.modelUsage as object)[0] ?? null : null;
    this.store.append({
      type: 'session.usage',
      goalId: meta.goalId,
      payload: {
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
    this.observeRateLimit(result);
  }

  private observeRateLimit(result: RunResult): void {
    const rl = result.rateLimit;
    const now = Date.now();
    const limitedByStatus = !!rl && !['allowed', 'allowed_warning'].includes(rl.status) && !!rl.resetsAt && rl.resetsAt * 1000 > now;
    const limitedByError = result.isError && /rate.?limit|usage limit|overloaded|too many requests|\b429\b/i.test(result.errorMessage ?? '');
    if (!limitedByStatus && !limitedByError) return;
    const until = limitedByStatus ? rl!.resetsAt! * 1000 : now + 5 * 60_000;
    this.pauseUntil(until, rl?.rateLimitType ?? null, limitedByStatus ? `rate_limit_event status=${rl!.status}` : `session error: ${(result.errorMessage ?? '').slice(0, 120)}`);
  }

  /** Stop spawning sessions until `until`; resume automatically. */
  pauseUntil(until: number, rateLimitType: string | null, reason: string): void {
    if (this.rateLimitedUntil && this.rateLimitedUntil >= until) return;
    this.rateLimitedUntil = until;
    this.store.append({ type: 'rate_limit.paused', goalId: null, payload: { rateLimitType, until: new Date(until).toISOString(), reason } });
    this.store.append({ type: 'engine.note', goalId: null, payload: { level: 'warn', message: `usage limit reached (${rateLimitType ?? '?'}): paused until ${new Date(until).toLocaleString()}; goals resume automatically` } });
    this.config.log(`[engine] rate limited (${rateLimitType ?? '?'}): pausing new sessions until ${new Date(until).toLocaleTimeString()} — ${reason}`);
    this.armResume(until);
  }
  /** (Re)arm the timer that lifts the pause and ticks every live goal. */
  private armResume(until: number): void {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.rateLimitedUntil = null;
      this.resumeTimer = null;
      this.store.append({ type: 'rate_limit.resumed', goalId: null, payload: { reason: 'reset time reached' } });
      this.store.append({ type: 'engine.note', goalId: null, payload: { level: 'info', message: 'usage limit reset — goals resume' } });
      for (const g of listGoals(this.store.db)) if (!['done', 'over_delivered', 'failed', 'cancelled'].includes(g.state)) this.tick(g.id);
    }, Math.max(0, until - Date.now()) + 1000);
  }
  /**
   * After a restart the pause lives only in the event log: if the last `rate_limit.paused` has no later
   * `rate_limit.resumed` and its reset time is still ahead, arm the timer again (no duplicate paused event);
   * a reset that passed while the engine was down is resumed immediately.
   */
  private restoreRateLimitPause(): void {
    const paused = this.store.listByType('rate_limit.paused', 1)[0];
    if (!paused) return;
    const resumed = this.store.listByType('rate_limit.resumed', 1)[0];
    if (resumed && resumed.seq > paused.seq) return;
    const until = Date.parse((paused.payload as { until: string }).until);
    if (!Number.isFinite(until)) return;
    if (until > Date.now()) {
      this.rateLimitedUntil = until;
      this.armResume(until);
      this.config.log(`[engine] restart during a usage pause: still paused until ${new Date(until).toLocaleTimeString()}`);
    } else {
      this.store.append({ type: 'rate_limit.resumed', goalId: null, payload: { reason: 'reset time passed while the engine was down' } });
    }
  }
  isRateLimited(): boolean {
    return this.rateLimitedUntil != null && this.rateLimitedUntil > Date.now();
  }
  rateLimitedUntilIso(): string | null {
    return this.isRateLimited() ? new Date(this.rateLimitedUntil!).toISOString() : null;
  }

  usage(): UsageSummary & { pausedUntil: string | null } {
    return { ...usageSummary(this.store.db), pausedUntil: this.rateLimitedUntilIso() };
  }

  // ---------- models ----------

  /** seed aliases ∪ names seen in sessions, with what they resolved to; what the Settings page lists */
  listModels(): (ModelRecord & { label: string | null; note: string | null; pinned: boolean; inUse: ('strong' | 'cheap' | 'worker')[] })[] {
    const m = this.config.models;
    return this.models.list().map((r) => {
      const seed = SEED_MODELS.find((s) => s.name === r.name);
      const inUse = (['strong', 'cheap', 'worker'] as const).filter((t) => m[t] === r.name);
      return { ...r, label: seed?.label ?? null, note: seed?.note ?? null, pinned: isPinnedId(r.name), inUse };
    });
  }
  /** One minimal session with `name` (user-triggered; costs one short call) to learn what it resolves to. */
  async probeModel(name: string): Promise<{ ok: boolean; name: string; resolvedId: string | null; costUsd: number; error: string | null }> {
    const handle = await this.runner.run({ prompt: 'Reply with the single word OK.', cwd: this.config.dataDir, model: name, meta: { tier: 'probe' }, maxTurns: 1, maxBudgetUsd: 0.5, permissionMode: 'dontAsk', allowedTools: [], timeoutMs: 90_000, label: `model probe ${name}` });
    let resolved: string | null = null;
    for await (const ev of handle.events) if (ev.kind === 'init') resolved = ev.model;
    const r = await handle.result;
    this.recordSessionUsage(r, { goalId: null, kind: 'probe', model: name });
    const ok = r.subtype === 'success' && !r.isError;
    const rec = this.models.get(name);
    return { ok, name, resolvedId: resolved ?? rec?.resolvedId ?? null, costUsd: r.costUsd, error: ok ? null : (r.errorMessage ?? r.subtype) };
  }
  /** Doctor check: are the configured tiers names this machine has seen resolve? */
  private modelsCheck() {
    const m = this.config.models;
    const issues: string[] = [];
    for (const t of ['strong', 'worker', 'cheap'] as const) {
      const name = m[t];
      const r = this.models.get(name);
      if (r?.lastFailAt && (!r.lastOkAt || r.lastFailAt > r.lastOkAt)) issues.push(`${t} = ${name}: last failed ${r.lastFailAt.slice(0, 16).replace('T', ' ')} (${r.lastError ?? 'model unavailable'})`);
      else if (!r || (!r.seed && !this.models.known(name))) issues.push(`${t} = ${name}: never seen resolving on this machine`);
    }
    const pinned = (['strong', 'worker', 'cheap'] as const).filter((t) => isPinnedId(m[t]));
    const detail = issues.length ? issues.join('; ') : `${m.strong} / ${m.worker} / ${m.cheap}${pinned.length ? ` — ${pinned.join(', ')} pinned to a full id (aliases follow the latest release automatically)` : ''}; fallbacks ${this.config.modelFallbacks.join(' → ')}`;
    return { id: 'models', label: 'Models (strong / worker / cheap)', ok: issues.length === 0, severity: 'warn' as const, detail, fix: issues.length ? { action: 'test-models' as const } : null };
  }

  /** One minimal cheap-model session purely to refresh the rate-limit signal (~$0.02). */
  async probeUsage(): Promise<UsageSummary & { pausedUntil: string | null }> {
    const handle = await this.runner.run({ prompt: 'Reply with the single word OK.', cwd: this.config.dataDir, model: this.config.models.cheap, maxTurns: 1, maxBudgetUsd: 0.05, permissionMode: 'dontAsk', allowedTools: [], timeoutMs: 60_000, label: 'usage probe' });
    for await (const _ of handle.events) {
      /* drain */
    }
    const r = await handle.result;
    this.recordSessionUsage(r, { goalId: null, kind: 'probe', model: this.config.models.cheap });
    return this.usage();
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
    if (this.isRateLimited()) return; // resume timer will tick again
    switch (goal.state) {
      case 'draft':
        this.store.append({ type: 'goal.state_changed', goalId, payload: { from: 'draft', to: 'clarifying', reason: 'start clarify' } });
        return;
      case 'clarifying':
        if (!this.clarifying.has(goalId)) void runClarify(this, goal);
        return;
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

  // ---------- commands ----------

  async createGoal(input: CreateGoalInput): Promise<Goal> {
    if (!(await isGitRepo(input.repoPath))) throw new Error(`${input.repoPath} is not a git repository`);
    const baseBranch = input.baseBranch ?? (await currentBranch(input.repoPath));
    if (baseBranch === 'HEAD') throw new Error('repository is in detached HEAD state; pass --base <branch>');
    const now = new Date().toISOString();
    const id = newId(IdPrefix.goal);
    const nature: GoalNature = input.nature ?? 'auto';
    // anyone-facing default: a goal that produces prose or media opens in the plain-language view
    const mode: GoalMode = input.mode ?? (nature !== 'auto' && nature !== 'code' ? 'simple' : this.config.defaultGoalMode);
    const goal: Goal = {
      id,
      title: input.title?.trim() || input.prompt.trim().split('\n')[0]!.slice(0, 80),
      prompt: input.prompt,
      repoPath: input.repoPath,
      baseBranch,
      branch: `goal/${id}`,
      budgets: Budgets.parse({ ...BUDGET_PRESETS[input.budgetPreset ?? 'custom'].budgets, ...(input.budgets ?? {}) }),
      budgetPreset: input.budgetPreset ?? 'custom',
      mode,
      nature,
      outputDir: input.outputDir ?? null,
      workflow: { tdd: input.workflow?.tdd ?? (mode === 'simple' ? 'preferred' : this.config.workflowTdd) },
      models: { ...this.config.models, ...(input.models ?? {}) },
      state: 'draft',
      stateBeforeBlock: null,
      costUsd: 0,
      fixCycles: 0,
      delivery: { ...IDLE_DELIVERY, policy: DeliveryPolicy.parse({ ...(this.config.defaultDelivery ?? {}), ...(input.delivery ?? {}) }) },
      attachments: input.attachments?.length ? claimStaged(this.config.dataDir, id, input.attachments.map((a) => this.latestStaged(a))) : [],
      baseSync: null,
      autoskills: null,
      completion: { ...IDLE_COMPLETION },
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
  async installTool(id: string, onLine: (l: string) => void): Promise<{ ok: boolean; command: string; exitCode: number | null }> {
    if (id === 'markitdown') {
      const r = await this.installMarkitdown(onLine);
      return { ok: r.ok, command: r.command.join(' '), exitCode: r.exitCode };
    }
    const entry = this.skills.catalog().entries.find((e) => e.id === id);
    if (!entry || entry.source.type !== 'cli') throw new Error(`${id} is not a CLI tool in the catalog`);
    const command = entry.source.install;
    const first = command.trim().split(/\s+/)[0]!;
    if (!Bun.which(first)) throw new Error(`${first} is not installed — install it first (https://docs.astral.sh/uv/ for uv), then retry`);
    onLine(`$ ${command}`);
    const t0 = Date.now();
    const r = await spawnStreaming(['sh', '-lc', command], this.config.dataDir, onLine, { timeoutMs: 10 * 60_000 });
    const ok = r.code === 0;
    onLine(ok ? `■ done in ${Math.round((Date.now() - t0) / 1000)}s` : `■ failed (exit ${r.code})`);
    this.skills.hints.invalidate();
    this.store.append({ type: 'engine.note', goalId: null, payload: { level: ok ? 'info' : 'warn', message: `tool install ${id}: \`${command}\` exited ${r.code}` } });
    return { ok, command, exitCode: r.code };
  }

  /** Doctor report including engine-level optional tools. */
  async doctor() {
    const available = this.markitdown.available();
    const cmd = this.markitdown.installCommand();
    const check = available
      ? { id: 'markitdown', label: 'markitdown (optional)', ok: true, severity: 'warn' as const, detail: `${this.markitdown.binary()} — attachments and repository documents are converted to markdown before sessions read them`, fix: null }
      : { id: 'markitdown', label: 'markitdown (optional)', ok: false, severity: 'warn' as const, detail: 'not installed — PDFs, Office files and links are handed to sessions as-is (more tokens to read). Installing converts them to markdown first.', fix: { command: "uv tool install --python 3.12 'markitdown[all]'", url: 'https://github.com/microsoft/markitdown', ...(cmd ? { action: 'install-markitdown' as const } : {}) } };
    return this.skills.doctor([check, this.modelsCheck()]);
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
    return runSuggest(this, escalationId);
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
    const inferred = inferCompletion(brief, ws);
    this.store.append({
      type: 'goal.completion_set',
      goalId,
      payload: { graphRefresh: completion?.graphRefresh ?? inferred.graphRefresh, docs: completion?.docs ?? inferred.docs, reason: completion ? 'set at brief approval' : inferred.reason },
    });
    if (budgets && Object.keys(budgets).length) {
      const next = Budgets.parse({ ...goal.budgets, ...budgets });
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
    this.store.append({ type: 'goal.state_changed', goalId, payload: { from: 'awaiting_brief_approval', to: 'running', reason: 'brief approved' } });
  }

  async answerEscalation(id: string, answer: EscalationAnswer): Promise<void> {
    await answerEsc(this, id, answer);
  }

  // ---------- delivery ----------

  /** Set (or change) the delivery policy; runs immediately when the goal is already finished. */
  async deliver(goalId: string, policyIn: Partial<DeliveryPolicy>, source: 'deliver' | 'retry' = 'deliver'): Promise<Goal> {
    const goal = this.mustGoal(goalId);
    if (goal.delivery.status === 'running') throw new Error('delivery is already running');
    const policy = DeliveryPolicy.parse({ ...goal.delivery.policy, ...policyIn });
    if (policy.mode !== 'local') {
      const probes = await probeForPlan(this, goal, policy);
      if (!probes.remoteExists && !policy.remoteUrl && !policy.createRepo) throw new Error(`remote "${policy.remote}" does not exist: provide remoteUrl or createRepo`);
      if (policy.createRepo && !probes.gh?.authenticated) throw new Error('creating a GitHub repository needs the gh CLI, logged in: brew install gh && gh auth login --web');
    }
    this.store.append({ type: 'delivery.policy_set', goalId, payload: { policy, source } });
    return getGoal(this.store.db, goalId)!;
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
    const ws = goalWorkspacePath(this.config.dataDir, goalId);
    let deletedBranch: string | null = null;
    if (repoOk) {
      await removeWorktree(goal.repoPath, deliveryWorkspacePath(this.config.dataDir, goalId)).catch(() => {});
      await removeWorktree(goal.repoPath, ws, { deleteBranch: opts.deleteBranch ? goal.branch : undefined }).catch(() => {});
      if (opts.deleteBranch) deletedBranch = goal.branch;
      // stacked delivery branches (goal/<id>/<n>-<slug>) belong to the goal and go with it
      for (const b of await listStackBranches(goal.repoPath, goal.branch)) await git(['branch', '-D', b], goal.repoPath).catch(() => {});
    }
    rmSync(join(this.config.dataDir, 'worktrees', goalId), { recursive: true, force: true });
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
    tasks: [{ key: 'T1', title: goal.title, spec: goal.prompt, kind: 'feature', scope: null, scenario: 'general', areaKey: null, tdd: 'inherit', dependsOnKeys: [], parallelizable: false, relevantFiles: [] }],
    costEstimateUsd: 1,
    timeEstimateMin: 15,
    questions: [],
  };
}
