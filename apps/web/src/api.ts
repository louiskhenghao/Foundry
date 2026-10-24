import type { FeedbackPlan, Learning, LearningKind, RepoLearnings, Deployment, DeliveryRevert, InterviewQuestion, MergeMethod } from '@foundry/core/browser';
import type { Attachment, Attempt, Brief, BriefApp, BriefCheck, BriefDiff, BriefRun, BriefStyleOption, BriefSubject, BriefTask, Budgets, Check, CheckResult, CodexEffort, DeliveryPlanStep, DeliveryPolicy, DeliveryState, DocType, EngineEvent, Escalation, EscalationAnswer, EscalationSuggestion, Goal, GoalMode, GoalNature, GoalState, GoalTimeline, SettingsPatch, SettingsView, SubjectPicture, Task, TaskUsage } from '@foundry/core/browser';
import type { IssueRead } from './pages/new-goal-issue.ts';
import type { Calibration, GoalRecipe, Schedule, ScheduleCadence, ThemeEntry, ThemeProblem } from '@foundry/core/browser';
import type { Conversation } from '@foundry/core/browser';
export type { Conversation, ConversationMessage } from '@foundry/core/browser';

/** a Schedule as the Schedules page lists it (ADR-0054): with its next run and the goal of its last run */
export type ScheduleRow = Schedule & { nextRunAt: string | null; lastGoal: { id: string; title: string; state: GoalState } | null };

/** Mirrors the engine's PreviewAppStatus (preview/manager.ts): one app of the goal's preview. */
export interface PreviewAppStatus {
  key: string;
  name: string;
  /** folder relative to the progress folder; '' = its root */
  dir: string;
  running: boolean;
  ready: boolean;
  port: number | null;
  url: string | null;
  command: string | null;
  startedAt: string | null;
  startedBy: 'human' | 'milestone' | 'integration' | null;
  lastVisitAt: string | null;
  log: string[];
  /** the live-log channel of this app's output */
  channel: string;
  run: BriefApp;
  error: string | null;
  /** the last lines the app printed before it failed */
  errorDetail: string[];
  /** it runs its mock command (fake data) for a milestone walkthrough */
  mock?: boolean;
  /** it did not answer in time, or its dependencies failed to install */
  warning: string | null;
  /** other servers its command started, found from the ports its processes listen on */
  discovered: { port: number; url: string; name: string; dir: string | null }[];
  /** why Foundry stopped it last time, when not a person */
  stopped: string | null;
  /** the port it listens on when run by hand, when Foundry could tell */
  nativePort: number | null;
  /** variables pointing at an app's usual port, moved to the port it got (names only) */
  rewrites: { key: string; from: number; to: number }[];
  /** its address on the person's tailnet (Tailscale); null = none */
  tailnetUrl: string | null;
}

/** Mirrors the engine's PreviewStatus (preview/manager.ts). The top-level fields describe the primary app (apps[0]). */
export interface PreviewStatus {
  running: boolean;
  ready: boolean;
  port: number | null;
  url: string | null;
  command: string | null;
  startedAt: string | null;
  startedBy: 'human' | 'milestone' | 'integration' | null;
  lastVisitAt: string | null;
  log: string[];
  run: BriefRun | null;
  source: 'brief' | 'detected' | null;
  error: string | null;
  apps: PreviewAppStatus[];
  /** where the apps run: the goal's progress folder, Foundry's preview folder on another branch, or the person's checkout */
  workspace: PreviewSource | null;
}

export type PreviewPlace = 'auto' | 'checkout' | 'foundry';
/** Mirrors the engine's PreviewSource: `goal` = the progress folder; `branch` = Foundry's preview folder at `branch`; `checkout` = the person's checkout */
export interface PreviewSource {
  kind: 'goal' | 'branch' | 'checkout';
  path: string;
  branch: string;
  preparing: boolean;
  fallback: string | null;
  place: PreviewPlace;
  checkoutBranch: string | null;
}
export interface PreviewSources {
  current: PreviewSource;
  options: { ref: string; label: string; note: string; available: boolean }[];
  /** only a finished goal's preview can run another branch */
  selectable: boolean;
}

/** Mirrors the engine's ServicesStatus (preview/services.ts): the Docker services from the repository's compose file. */
/** Mirrors PreviewManager.envView: the names (never values) of the repository's preview variables, and what its files provide or ask for. */
export interface PreviewEnv {
  repo: string;
  /** revision of the saved set; a save from an older one is refused (409) */
  rev: number;
  keys: string[];
  checkout: { files: string[]; keys: string[] };
  example: { key: string; example: string; file: string; comment: string | null }[];
  missing: string[];
  /** what each name is: its example file comment, the files that read it, and a note for names many projects use */
  notes: Record<string, { comment: string | null; example: string | null; file: string | null; usedIn: string[]; hint: string | null; generate: 'secret' | null }>;
}

export interface ServicesStatus {
  /** the compose file, relative to the progress folder */
  file: string;
  /** the compose project shared by every goal of this repository */
  project: string;
  docker: 'available' | 'unavailable' | 'in-container';
  services: { name: string; image: string; ports: number[]; state: 'running' | 'stopped' | 'external' | 'unknown'; health: string | null }[];
  /** the command to start the services by hand */
  command: string;
  error: string | null;
}

/** A Skills page operation (mirrors the server's skill-ops.ts): its own live channel and how it ended. */
export interface SkillOp {
  id: string;
  channel: string;
  kind: 'install' | 'install-tier' | 'install-bundle' | 'update' | 'adopt' | 'uninstall' | 'tool-install';
  label: string;
  status: 'running' | 'ok' | 'failed';
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
}

/** Manual merge resolution (mirrors engine's merge-resolve.ts). */
export interface ResolveFile {
  path: string;
  conflicted: boolean;
  current: string;
  ours: string | null;
  theirs: string | null;
  base: string | null;
  binary: boolean;
}
export interface ResolveState {
  taskId: string;
  path: string;
  branch: string;
  into: string;
  files: ResolveFile[];
  remaining: number;
}
export interface FinishResult {
  ok: boolean;
  ref: string | null;
  checks: { name: string; status: string; summary: string }[];
  reason: string | null;
}

/** Draft with AI on the Brief page (mirrors engine's DraftRequest / DraftProposal). */
export interface DraftRequest {
  mode: 'task' | 'acceptance' | 'area' | 'revise';
  brief: Omit<Brief, 'goalId'>;
  taskKey?: string | null;
  areaKey?: string | null;
  notes?: string;
}
export interface DraftProposal {
  costAvailable?: boolean;
  mode: DraftRequest['mode'];
  taskKey: string | null;
  task: Partial<Pick<BriefTask, 'spec' | 'kind' | 'scope' | 'scenario' | 'areaKey' | 'dependsOnKeys' | 'relevantFiles' | 'delivers'>> | null;
  tasks: BriefTask[];
  checks: BriefCheck[];
  rationale: string;
  costUsd: number;
  revision?: { diff: BriefDiff; revised: Omit<Brief, 'goalId'>; changeSummary: string };
  /** mode revise: no proposal yet — the Clarifier asks these first; answer them with reviseAnswer */
  round?: { round: number; questions: InterviewQuestion[] };
}
/** the goal's last second opinion on its Brief (ADR-0051), its diff against the Brief as it is now */
export interface SecondOpinionView {
  at: string;
  auto: boolean;
  costUsd: number;
  costAvailable?: boolean;
  stale: boolean;
  proposal: DraftProposal;
}
/** why the goal's last second opinion did not come in (the reviewer ran out, or returned no usable proposal), until one does */
export interface SecondOpinionFailure {
  at: string;
  auto: boolean;
  costUsd: number;
  reason: string;
}

export interface BaseSync {
  remote: string | null;
  base: string;
  localRef: string | null;
  remoteRef: string | null;
  ahead: number;
  behind: number;
  fetched: boolean;
  error: string | null;
}
export interface ModelRecordView {
  name: string;
  resolvedId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastOkAt: string | null;
  lastFailAt: string | null;
  lastError: string | null;
  sessions: number;
  seed: boolean;
  label: string | null;
  note: string | null;
  pinned: boolean;
  /** where the presets in use run this model, e.g. "Code: Standard tasks" */
  inUse: string[];
  /** found in the Claude Code binary by a model sync */
  discovered?: { family: string; newest: boolean; at: string } | null;
  /** Advertised by the local Codex CLI; discovery does not verify account access. */
  codex?: { displayName: string | null; description: string | null; reasoningEfforts: string[]; defaultReasoningEffort: string | null; isDefault: boolean; available: boolean } | null;
}
export interface PackEntry {
  id: string;
  name: string;
  invoke: string;
  status: 'installed' | 'installed-unmanaged' | 'installed-via-plugin' | 'partial' | 'missing';
  detail: string;
  manual: { command: string; docs: string | null } | null;
  sourceType: 'git' | 'cli' | 'manual' | 'plugin';
  /** keys sessions lack for this skill ("A|B" = any one of them) */
  missingEnv: string[];
  /** what the skill loses without them; null = its whole API/generation mode */
  envFor: string | null;
}
export interface PackOptionView {
  id: string;
  label: string;
  summary: string;
  homepage: string | null;
  entries: PackEntry[];
}
export interface PackGroupView {
  chosen: string;
  options: PackOptionView[];
}
export interface PacksView {
  design: PackGroupView;
  image: PackGroupView;
  video: PackGroupView;
  /** the Figure pack (ADR-0076) */
  figure: PackGroupView;
}

export interface LastGoalWorkflow {
  goalId: string;
  title: string;
  createdAt: string;
  workflow: { profile: 'mattpocock' | 'pstack' | 'plain'; tdd: 'required' | 'preferred' | 'off'; ponytail: 'on' | 'off' };
}

export interface RepoInfo {
  lastGoal: LastGoalWorkflow | null;
  ok: boolean;
  branch: string;
  dirty: boolean;
  error: string | null;
  path: string;
  exists: boolean;
  isDir: boolean;
  isGitRepo: boolean;
  insideRepoAt: string | null;
  hasCommits: boolean;
  remotes: { name: string; url: string }[];
  identity: { name: string; email: string } | null;
  commitCount: number;
  lastCommit: { sha: string; date: string; subject: string } | null;
  dirtyCount: number;
}
export interface DirListing {
  path: string;
  parent: string | null;
  entries: { name: string; path: string; isGitRepo: boolean }[];
  truncated: boolean;
}
export interface FsRecent {
  recent: string[];
  roots: { label: string; path: string }[];
  nativePicker: boolean;
}
import type { AgentLogChunk, AgentsList, AgentsSummary } from '@foundry/engine/agents-types';
import type { DoctorReport, InstallResult, ReleaseForecast, SkillTier, SkillUpdateRun, SkillsOverview, SkillsUpdateReport, SuiteReleaseView, TrashEntry } from '@foundry/engine/skills-types';
import type { MinimaxQuota, Report, UsageSummary } from '@foundry/engine/usage-types';

export type Usage = UsageSummary & { pausedUntil: string | null };

/** Access (ADR-0061): a person who may use this Foundry, with a token of their own */
export interface Person {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}
/** whether Access is on, and who this browser is signed in as */
export interface AccessMe {
  enabled: boolean;
  person: Person | null;
}

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  authMethod: string | null;
  apiProvider: string | null;
  email: string | null;
  orgName: string | null;
  subscriptionType: string | null;
  checkedAt: string;
  error: string | null;
}
/** the GitHub sign-in a page started: gh's one-time code, where to enter it, and how it ended */
export interface GhLoginSession {
  id: string;
  startedAt: string;
  code: string | null;
  url: string | null;
  lines: string[];
  done: boolean;
  ok: boolean;
  login: string | null;
  error: string | null;
}

export interface LoginSession {
  id: string;
  startedAt: string;
  url: string | null;
  lines: string[];
  done: boolean;
  ok: boolean | null;
  error: string | null;
  finishedAt: string | null;
  /** the CLI is waiting for the code shown in the browser (no browser on the engine's machine) */
  needsCode: boolean;
  /** Codex device sign-in: the one-time code to enter on `url` */
  deviceCode?: string | null;
}
import type { AgentProvider } from '@foundry/core/browser';
export type { AgentProvider } from '@foundry/core/browser';
/** one sign-in of a coding agent (ADR-0065): this computer's own (`native`) or one added in Foundry */
export interface PoolAccount { id: string; email: string | null; orgName: string | null; plan: string | null; addedAt: string; current: boolean; limitedUntil: string | null; status: ClaudeAuthStatus | null }
export interface AccountPoolInfo { autoSwitch: boolean; accounts: PoolAccount[] }
export interface AccountInfo { provider: AgentProvider; installed: boolean; status: ClaudeAuthStatus; capabilities: { dollarCosts: boolean; skillTelemetry: boolean; nativeSubagents: boolean; managedMcp: boolean; externalSessions: boolean }; pool?: AccountPoolInfo }
export interface AccountsInfo { defaultProvider: AgentProvider; accounts: AccountInfo[] }
export interface AuthInfo {
  provider: AgentProvider;
  status: ClaudeAuthStatus;
  login: LoginSession | null;
}

import type { CodexPluginsView } from '@foundry/engine/plugins-types';
import type { McpHealth, McpLoginSession, McpView } from '@foundry/engine/mcp-types';
import type { MemoryFolderStatus, MemoryGoalView, MemoryStatus } from '@foundry/engine/memory-types';
export type { McpHealth, McpLoginSession, McpView };
/** a server added by hand on the MCP tab */
export type McpCustomServer = { name: string; config: { type: 'stdio'; command: string; args?: string[] } | { type: 'http' | 'sse'; url: string } };

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: any,
  ) {
    super(message);
  }
}

/** an Escalation with the names of what it is about */
export type EscalationRow = Escalation & { provider: AgentProvider | null; goalTitle?: string; taskTitle?: string | null; taskState?: string | null };

export interface BudgetStatus {
  /** what the goal's Conversations cost (ADR-0073): in the goal's total, outside this budget and its `costUsd` */
  conversationUsd?: number;
  costUsd: number;
  maxCostUsd: number | null;
  elapsedMin: number;
  maxDurationMin: number | null;
  remainingUsd: number | null;
  exceeded: 'cost' | 'time' | null;
}
export type GoalRow = Goal & { budget: BudgetStatus; taskCounts: Record<string, number>; openEscalations: number };
export interface OpenTarget {
  id: 'vscode' | 'cursor' | 'zed' | 'windsurf' | 'finder' | 'terminal' | 'iterm' | 'warp';
  label: string;
  /** what it opens: an editor folders and files, a file manager or a terminal folders */
  kind: 'editor' | 'files' | 'terminal';
  available: boolean;
  via: string | null;
}
/** Mirrors the engine's PortRow (ports/ports.ts): one port in use, who holds it, and whether it can be released */
export interface PortRow {
  id: string;
  port: number;
  addresses: string[];
  category: 'foundry' | 'tailscale' | 'docker' | 'process' | 'unknown';
  kind: 'server' | 'preview' | 'editor' | 'task' | 'service' | 'serve-self' | 'serve-foundry' | 'serve-person' | 'container' | 'process' | 'unknown';
  label: string;
  detail: string | null;
  goalId: string | null;
  taskId: string | null;
  pid: number | null;
  process: string | null;
  cwd: string | null;
  container: string | null;
  url: string | null;
  relevant: boolean;
  release: { allowed: boolean; confirm: string | null; reason: string | null };
}
export interface PortsView {
  rows: PortRow[];
  inContainer: boolean;
  scannedAt: string;
  foundryPort: number;
  previewRange: { from: number; to: number };
}

export type WaitingKind = 'capacity' | 'serial' | 'overlap' | 'hard';

/** where a goal task's Delegated goal stands (the server's view; the goal may have been deleted since) */
export interface DelegatedView {
  goalId: string;
  exists: boolean;
  title: string | null;
  state: GoalState | null;
  taskCounts: Record<string, number>;
  /** why it waits for the person, or null while it works or is finished */
  needsYou: string | null;
}

/** Mirrors the engine's ConversationsView (conversation/conversations.ts, ADR-0073): a goal's Conversations and what is live in each */
export interface ConversationLive {
  /** the question being answered now */
  answering: string | null;
  /** the questions waiting their turn */
  queued: string[];
}
export interface ConversationsView {
  enabled: boolean;
  conversations: Conversation[];
  live: Record<string, ConversationLive>;
}

export interface GoalDetail {
  goal: Goal;
  /** how far earlier goals ran from their estimate (ADR-0056) */
  calibration?: Calibration;
  /** how many Learnings the goal's folder has (ADR-0040) */
  learningsCount?: number;
  /** what the folder's Memory told this goal's stages, and what the goal wrote back (ADR-0072) */
  memory?: MemoryGoalView;
  /** directories the Open menu can launch: the user's checkout and the goal branch worktree (when it exists) */
  paths: { repo: string; workspace: string | null };
  budget: BudgetStatus;
  /** live: a slot held / a session process alive; waiting: why a ready task is not running (null: nothing holds it back);
   * waitingKind: the scheduler's caution (slots, running alone, shared files), which Start now may override, or 'hard' */
  tasks: (Task & { depth: number; usage: TaskUsage | null; live?: { inFlight: boolean; session: boolean; since: string | null }; waiting?: string | null; waitingKind?: WaitingKind | null; delegated?: DelegatedView })[];
  attempts: Attempt[];
  checks: Check[];
  checkResults: CheckResult[];
  /** `skeleton`: the Clarifier's Brief without its tasks, the planner still at work — shown and editable meanwhile */
  brief: { brief: Brief; approved: boolean; skeleton?: boolean } | null;
  escalations: EscalationRow[];
  events: (EngineEvent & { seq: number })[];
  /** every milestone visit and walkthrough of the goal, oldest first, however far back */
  milestoneEvents: (EngineEvent & { seq: number })[];
  /** milestones being recorded or waiting their turn ('final' while the final walkthrough runs) */
  milestoneRuns?: string[];
  /** ponytail-audit is reading the finished branch */
  auditRunning?: boolean;
  /** the browser QA of the finished app is running (ADR-0057) */
  qaRunning?: boolean;
  /** REA is studying the goal's references */
  investigating?: boolean;
  secondOpinion?: SecondOpinionView | null;
  secondOpinionRunning?: boolean;
  secondOpinionFailed?: SecondOpinionFailure | null;
  /** the Subjects (keys) whose pictures Foundry is searching for now: the Brief waits for them */
  subjectSearches?: string[];
  /** the milestones (task ids) whose recording is being compared with the Subjects' pictures now */
  likenessRuns?: string[];
  /** the sessions cut before they reported a cost, each priced at its model's measured rate: shown as ≈, never in the budget */
  costEstimate?: { usd: number; sessions: number; estimated: number; bySession: Record<string, number> };
  /** Follows / Followed by (goal.follows holds the earlier goal; it may have been deleted since) */
  followUps: { followsExists: boolean; followedBy: { id: string; title: string; state: GoalState }[] };
  /** Delegated from / Delegated goals (goal.delegatedFrom holds the main goal; it may have been deleted since) */
  delegations?: { fromExists: boolean; goals: { id: string; title: string; state: GoalState; taskId: string; /** the repository it works in: a companion's when it differs from the goal's (ADR-0063) */ repoPath?: string; delivery?: { status: string; outcome: string | null; pr: { number: number; url: string } | null } }[] };
}

/** Mirrors the engine's FollowUpDraft (follow-up.ts): prefill and start point for a Follow-up of a goal. */
export interface FollowUpDraft {
  previous: { id: string; title: string; state: GoalState; repoPath: string; baseBranch: string; branch: string; branchExists: boolean };
  followable: boolean;
  reason: string | null;
  prefill: { provider: AgentProvider; codexModel?: string; agyModel?: string; repoPath: string; baseBranch: string; nature: GoalNature; modelPreset: string | null; effort: CodexEffort | null; pace: 'thorough' | 'fast'; profile: 'mattpocock' | 'pstack' | 'plain'; tdd: 'required' | 'preferred' | 'off'; ponytail: 'on' | 'off'; mode: GoalMode; delivery: DeliveryPolicy };
  start: { recommended: 'base' | 'previous'; onBase: boolean; detail: string; baseBranch: string; previousBranch: string | null };
  attachments: Attachment[];
  style: BriefStyleOption | null;
}

export interface UpdateReportView {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  changelog: { version: string; notes: string }[];
  error: string | null;
}
export interface UpdateStatusView extends UpdateReportView {
  capability: { mode: 'docker' | 'local' | 'unknown'; canSelfUpdate: boolean; method: 'watchtower' | 'git' | null; guided: string[] };
  checking: boolean;
  applying: boolean;
}

/**
 * A file the UI can open: an absolute path (the live log, the progress folder), or a task's file by its path in the
 * repository — read from the task's worktree while it runs and from its commit once its folders are gone.
 */
export type FileRef = string | { path: string } | { goal: string; task: string; rel: string };

/** A file as /api/files/stat describes it. */
export interface FileInfo {
  /** on disk, when read from a folder; null when read from a commit */
  path: string | null;
  name: string;
  rel: string;
  kind: 'image' | 'pdf' | 'video' | 'audio' | 'markdown' | 'json' | 'html' | 'text' | 'binary';
  size: number;
  /** the path named a task worktree that is gone; this is the same file where the task's work landed */
  landed?: boolean;
  /** read from this task commit (its folders were removed) */
  commit?: string | null;
}
/** one file a task made, as its panel lists it */
export interface TaskFile {
  name: string;
  rel: string;
  kind: FileInfo['kind'];
  size: number;
  open: FileRef;
}

const fileQuery = (ref: FileRef) => {
  const r = typeof ref === 'string' ? { path: ref } : ref;
  return new URLSearchParams(r as Record<string, string>).toString();
};
/** where the browser loads a file (served only inside a goal's folders or its task commits) */
export const fileUrl = (ref: FileRef) => `/api/files?${fileQuery(ref)}`;
/** a stable string for a FileRef (React keys, comparisons) */
export const fileKey = (ref: FileRef) => fileQuery(ref);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  // Access (ADR-0061): a request this Foundry wants a token for sends the person to the login page, back here afterwards
  if (res.status === 401 && (body as any)?.code === 'auth' && location.pathname !== '/login') location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
  if (!res.ok) throw new ApiError((body as any)?.error ?? text ?? res.statusText, res.status, body);
  return body as T;
}
const safeJson = (t: string) => {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};

/** wait for a background skills operation to end (its record is polled), for a page that wants the outcome where it started it */
export async function awaitSkillOp(client: { skillOp: (id: string) => Promise<SkillOp> }, op: SkillOp, everyMs = 2000): Promise<SkillOp> {
  let cur = op;
  while (cur.status === 'running') {
    await new Promise((r) => setTimeout(r, everyMs));
    cur = await client.skillOp(cur.id);
  }
  return cur;
}

/** An immutable client scope keeps in-flight extension operations on their selected provider. */
export function apiForProvider(provider?: AgentProvider) {
  const req = <T>(path: string, init?: RequestInit) => {
    const scoped = provider && /^\/api\/(skills|mcp|plugins|doctor|tools)(?:[/?]|$)/.test(path);
    return request<T>(scoped ? `${path}${path.includes('?') ? '&' : '?'}provider=${provider}` : path, init);
  };
  return {
  plugins: (refresh = false) => req<CodexPluginsView>(`/api/plugins${refresh ? '?refresh=1' : ''}`),
  changePlugin: (id: string, action: 'install' | 'remove', opId: string) => req<{ ok: boolean; op: SkillOp }>('/api/plugins/change', { method: 'POST', body: JSON.stringify({ id, action, opId }) }),
  agents: () => req<AgentsList>('/api/agents'),
  agentsSummary: () => req<AgentsSummary>('/api/agents/summary'),
  agentLog: (sessionId: string, offset = 0, agent?: string) => req<AgentLogChunk>(`/api/agents/${sessionId}/log?offset=${offset}${agent ? `&agent=${encodeURIComponent(agent)}` : ''}`),
  killAgent: (sessionId: string) => req<{ ok: true }>(`/api/agents/${sessionId}/kill`, { method: 'POST' }),
  goals: () => req<GoalRow[]>('/api/goals'),
  goal: (id: string) => req<GoalDetail>(`/api/goals/${id}`),
  createGoal: (body: unknown) => req<Goal>('/api/goals', { method: 'POST', body: JSON.stringify(body) }),
  followUpDraft: (id: string) => req<FollowUpDraft>(`/api/goals/${id}/follow-up-draft`),
  /** every folder with Learnings, or one folder's (ADR-0040) */
  learnings: () => req<{ repos: RepoLearnings[] }>('/api/learnings'),
  repoLearnings: (repoPath: string) => req<{ repoPath: string; learnings: Learning[] }>(`/api/learnings?repo=${encodeURIComponent(repoPath)}`),
  saveLearnings: (repoPath: string, learnings: { id?: string | null; kind: LearningKind; text: string }[]) => req<{ repoPath: string; learnings: Learning[] }>('/api/learnings', { method: 'PUT', body: JSON.stringify({ repoPath, learnings }) }),
  learnFrom: (goalId: string) => req<{ repoPath: string; learnings: Learning[] }>(`/api/goals/${goalId}/learn`, { method: 'POST' }),
  /** Deploy (ADR-0041): what a finished goal's web app is, the hosts, the exact commands, the deploys so far */
  deployInfo: (goalId: string, provider?: DeployHost | null, production = false) => req<DeployInfo>(`/api/goals/${goalId}/deploy?${provider ? `provider=${provider}&` : ''}production=${production ? 1 : 0}`),
  deploy: (goalId: string, provider: DeployHost, production: boolean, smoke: boolean) => req<{ started: boolean }>(`/api/goals/${goalId}/deploy`, { method: 'POST', body: JSON.stringify({ provider, production, smoke }) }),
  /** Smoke again (ADR-0058): the goal's milestone scripts against a live deploy's address once more */
  /** Revert (ADR-0059): what a revert of the goal would undo; and start one, with the reason and whether to merge it right away */
  revertInfo: (goalId: string) => req<RevertInfo>(`/api/goals/${goalId}/revert`),
  revert: (goalId: string, reason: string, merge: boolean) => req<{ started: boolean }>(`/api/goals/${goalId}/revert`, { method: 'POST', body: JSON.stringify({ reason, merge }) }),
  smokeDeployment: (goalId: string, deployedAt: string) => req<{ started: boolean }>(`/api/goals/${goalId}/deploy/smoke`, { method: 'POST', body: JSON.stringify({ deployedAt }) }),
  markFollowUp: (id: string, goalId: string) => req<Goal>(`/api/goals/${id}/follows`, { method: 'POST', body: JSON.stringify({ goalId }) }),
  validateRepo: (repoPath: string) => req<RepoInfo>('/api/validate-repo', { method: 'POST', body: JSON.stringify({ repoPath }) }),
  // schedules (ADR-0054): goals that run on their own
  schedules: () => req<{ schedules: ScheduleRow[] }>('/api/schedules'),
  saveSchedule: (body: { id?: string; name: string; cadence: ScheduleCadence; recipe: GoalRecipe; autoApprove?: boolean; enabled?: boolean }) => req<{ schedule: Schedule }>('/api/schedules', { method: 'PUT', body: JSON.stringify(body) }),
  setScheduleEnabled: (id: string, enabled: boolean) => req<{ schedule: Schedule }>(`/api/schedules/${id}/enable`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  runSchedule: (id: string) => req<{ goalId: string | null; skipped: string | null }>(`/api/schedules/${id}/run`, { method: 'POST' }),
  deleteSchedule: (id: string) => req<{ ok: true }>(`/api/schedules/${id}`, { method: 'DELETE' }),
  /** a goal from a GitHub issue (ADR-0052): read it with gh; its thread comes back staged as an attachment */
  readIssue: (ref: string, repoPath: string | null) => req<IssueRead>('/api/issues/read', { method: 'POST', body: JSON.stringify({ ref, repoPath }) }),
  /** Upload one file with progress; resolves to the staged Attachment. goalId → attach directly to that goal. */
  upload: (file: File, opts: { goalId?: string; onProgress?: (pct: number) => void } = {}) =>
    new Promise<Attachment>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', opts.goalId ? `/api/goals/${opts.goalId}/attachments` : '/api/uploads');
      xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300) resolve(body.attachments[0]);
          else reject(new ApiError(body.error ?? `upload failed (${xhr.status})`, xhr.status, body));
        } catch (e) {
          reject(e);
        }
      };
      xhr.onerror = () => reject(new Error('upload failed (network)'));
      const fd = new FormData();
      fd.append('file', file, file.name);
      xhr.send(fd);
    }),
  addLink: (url: string, opts: { goalId?: string; name?: string; note?: string } = {}) => req<{ attachments: Attachment[] }>(opts.goalId ? `/api/goals/${opts.goalId}/attachments` : '/api/uploads', { method: 'POST', body: JSON.stringify({ url, name: opts.name, note: opts.note }) }).then((r) => r.attachments[0]!),
  openTargets: () => req<{ targets: OpenTarget[] }>('/api/open/targets').then((r) => r.targets),
  // themes (ADR-0066): the built-in ones and the files in the data folder's themes/
  themes: () => req<{ dir: string; themes: ThemeEntry[]; problems: ThemeProblem[] }>('/api/themes'),
  copyTheme: (from: string, name?: string) => req<ThemeEntry>('/api/themes', { method: 'POST', body: JSON.stringify({ from, name }) }),
  /** a theme of your own: renamed (its id follows the name), deleted, or the address its file is saved from */
  renameTheme: (id: string, name: string) => req<ThemeEntry>(`/api/themes/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteTheme: (id: string) => req<{ ok: true }>(`/api/themes/${id}`, { method: 'DELETE' }),
  themeFileUrl: (id: string) => `/api/themes/${id}/file`,
  /** a theme file from elsewhere: its name and its text */
  importTheme: (file: string, text: string) => req<ThemeEntry>('/api/themes/import', { method: 'POST', body: JSON.stringify({ file, text }) }),
  /** the themes folder, or with `theme` that theme's own file (in an editor) */
  openThemes: (target: OpenTarget['id'], theme?: string) => req<{ ok: true; path: string; command: string[] }>('/api/themes/open', { method: 'POST', body: JSON.stringify({ target, theme }) }),
  openGoal: (goalId: string, target: OpenTarget['id'], which: 'repo' | 'workspace' | `task:${string}` | `resolve:${string}`) => req<{ ok: true; path: string; command: string[] }>(`/api/goals/${goalId}/open`, { method: 'POST', body: JSON.stringify({ target, which }) }),
  stagedAttachment: (attId: string) => req<Attachment>(`/api/uploads/${attId}`),
  reconvertAttachment: (goalId: string, attId: string) => req<{ markdown: Attachment['markdown'] }>(`/api/goals/${goalId}/attachments/${attId}/convert`, { method: 'POST' }),
  /** VS Code in the browser for one of a goal's places; starts code-server on first use */
  openInEditor: (id: string, which: string) => req<{ url: string; tailnetUrl: string | null; password: string }>(`/api/goals/${id}/editor`, { method: 'POST', body: JSON.stringify({ which }) }),
  editorStatus: () => req<{ installed: boolean; running: boolean; port: number | null }>('/api/editor'),
  installCodeServer: () => req<{ started: true; channel: string }>('/api/tools/code-server/install', { method: 'POST' }),
  installMarkitdown: () => req<{ started: true; channel: string }>('/api/tools/markitdown/install', { method: 'POST' }),
  removeAttachment: (goalId: string, attId: string) => req<{ ok: true }>(`/api/goals/${goalId}/attachments/${attId}`, { method: 'DELETE' }),
  attachmentUrl: (goalId: string, attId: string, download = false) => `/api/goals/${goalId}/attachments/${attId}${download ? '?download=1' : ''}`,
  /** the markdown rendition (markitdown / link snapshot) as text; staged uploads have no goal yet */
  attachmentMarkdown: (goalId: string | null, attId: string) => fetch(goalId ? `/api/goals/${goalId}/attachments/${attId}/markdown` : `/api/uploads/${attId}/markdown`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`markdown not available (${r.status})`)))),
  fsList: (path?: string, hidden = false) => req<DirListing>(`/api/fs/list?${new URLSearchParams({ ...(path ? { path } : {}), ...(hidden ? { hidden: '1' } : {}) })}`),
  fsRecent: () => req<FsRecent>('/api/fs/recent'),
  fsMkdir: (parent: string, name: string) => req<{ path: string }>('/api/fs/mkdir', { method: 'POST', body: JSON.stringify({ parent, name }) }),
  fsPick: (defaultDir?: string) => req<{ path: string | null; cancelled: boolean }>('/api/fs/pick', { method: 'POST', body: JSON.stringify({ defaultDir }) }),
  repoUpstream: (repoPath: string, branch: string) => req<BaseSync & { start: { ref: string; from: 'local' | 'remote'; reason: string }; fetchBeforeGoal: boolean }>('/api/repos/upstream', { method: 'POST', body: JSON.stringify({ repoPath, branch }) }),
  repoPull: (repoPath: string, branch: string) => req<{ ok: boolean; detail: string; before: string | null; after: string | null }>('/api/repos/pull', { method: 'POST', body: JSON.stringify({ repoPath, branch }) }),
  initRepo: (path: string, branch?: string) => req<{ branch: string; ref: string; filesCommitted: number; identity: 'user' | 'fallback'; gitignoreWritten: boolean }>('/api/repos/init', { method: 'POST', body: JSON.stringify({ path, branch }) }),
  githubStatus: () => req<{ installed: boolean; version: string | null; authenticated: boolean; login: string | null }>('/api/github/status'),
  githubOrgs: () => req<string[]>('/api/github/orgs'),
  githubLogin: () => req<{ started: boolean; session: GhLoginSession }>('/api/github/auth/login', { method: 'POST' }),
  githubLoginSession: () => req<{ session: GhLoginSession | null }>('/api/github/auth/login'),
  githubLoginCancel: () => req<{ session: GhLoginSession | null }>('/api/github/auth/login/cancel', { method: 'POST' }),
  deliver: (id: string, policy: Partial<DeliveryPolicy>) => req<{ ok: true; delivery: DeliveryState }>(`/api/goals/${id}/deliver`, { method: 'POST', body: JSON.stringify(policy) }),
  rerunCompletion: (id: string, what: 'docs' | 'graph') => req<{ ok: true }>(`/api/goals/${id}/completion/rerun`, { method: 'POST', body: JSON.stringify({ what }) }),
  saveDeliveryPolicy: (id: string, policy: Partial<DeliveryPolicy>) => req<{ ok: true; delivery: DeliveryState }>(`/api/goals/${id}/delivery/policy`, { method: 'PUT', body: JSON.stringify(policy) }),
  resumeDelivery: (id: string) => req<{ ok: true; delivery: DeliveryState }>(`/api/goals/${id}/delivery/resume`, { method: 'POST' }),
  startOverDelivery: (id: string, policy: Partial<DeliveryPolicy>) => req<{ ok: true; delivery: DeliveryState }>(`/api/goals/${id}/delivery/start-over`, { method: 'POST', body: JSON.stringify(policy) }),
  retryDelivery: (id: string) => req<{ ok: true; delivery: DeliveryState }>(`/api/goals/${id}/delivery/retry`, { method: 'POST' }),
  recheckPr: (id: string, n: number) => req<{ ok: true; delivery: DeliveryState }>(`/api/goals/${id}/delivery/prs/${n}/recheck`, { method: 'POST' }),
  markDelivered: (id: string) => req<{ ok: true; delivery: DeliveryState }>(`/api/goals/${id}/delivery/mark-delivered`, { method: 'POST' }),
  /** "Fix review comments" on one PR (ADR-0053): read it now, then address its waiting round whatever the budget */
  fixReviews: (id: string, n: number) => req<{ ok: true; delivery: DeliveryState }>(`/api/goals/${id}/delivery/prs/${n}/fix-reviews`, { method: 'POST' }),
  refreshDelivery: (id: string) => req<{ ok: true; delivery: DeliveryState }>(`/api/goals/${id}/delivery/refresh`, { method: 'POST' }),
  afterMerge: (id: string, opts: { pull?: boolean; force?: boolean }) => req<{ ok: true; delivery: DeliveryState }>(`/api/goals/${id}/delivery/after-merge`, { method: 'POST', body: JSON.stringify(opts) }),
  deliveryPlan: (id: string, q: Record<string, string>) => req<{ policy: DeliveryPolicy; probes: any; steps: DeliveryPlanStep[] }>(`/api/goals/${id}/delivery/plan?${new URLSearchParams(q)}`),
  cancelDelivery: (id: string) => req<{ ok: boolean }>(`/api/goals/${id}/delivery/cancel`, { method: 'POST' }),
  /** `skeleton`: the page was editing the Brief skeleton; the engine then takes its skeleton fields only and keeps the tasks it has */
  editBrief: (id: string, brief: Brief, skeleton = false) => req<Brief>(`/api/goals/${id}/brief`, { method: 'PATCH', body: JSON.stringify(skeleton ? { ...brief, skeleton: true } : brief) }),
  /** starts one (202): the goal detail carries it from here — secondOpinionRunning, then secondOpinion or secondOpinionFailed */
  secondOpinion: (id: string) => req<{ started: true }>(`/api/goals/${id}/brief/second-opinion`, { method: 'POST' }),
  /** Conversations on the goal's page (ADR-0073): the view; a question, kept at once (202) and answered in the background on `channel`; Stop */
  conversations: (id: string) => req<ConversationsView>(`/api/goals/${id}/conversations`),
  ask: (id: string, body: { text: string; conversationId?: string | null; fresh?: boolean; /** staged uploads going with the question */ attachments?: Attachment[] }) => req<{ conversationId: string; messageId: string; channel: string }>(`/api/goals/${id}/conversations/ask`, { method: 'POST', body: JSON.stringify(body) }),
  stopConversation: (id: string, conversationId: string) => req<{ stopped: boolean }>(`/api/goals/${id}/conversations/${encodeURIComponent(conversationId)}/stop`, { method: 'POST' }),
  draftBrief: (id: string, body: DraftRequest) => req<{ proposal: DraftProposal }>(`/api/goals/${id}/brief/draft`, { method: 'POST', body: JSON.stringify(body) }),
  /** the answers to the round a Revise asked: the proposal, or one more round */
  reviseAnswer: (id: string, body: { brief: Omit<Brief, 'goalId'>; answers: Record<string, string>; finish: boolean; note: string | null }) => req<{ proposal: DraftProposal }>(`/api/goals/${id}/brief/revise/answer`, { method: 'POST', body: JSON.stringify(body) }),
  reviseCancel: (id: string) => req<{ ok: true }>(`/api/goals/${id}/brief/revise/cancel`, { method: 'POST' }),
  approveBrief: (id: string, brief?: Brief, budgets?: Partial<Budgets>, completion?: { graphRefresh: boolean; docs: DocType[]; audit?: boolean }) => req<{ ok: true }>(`/api/goals/${id}/brief/approve`, { method: 'POST', body: brief || budgets || completion ? JSON.stringify({ ...(brief ?? {}), ...(budgets ? { budgets } : {}), ...(completion ? { completion } : {}) }) : '' }),
  cancelGoal: (id: string) => req<{ ok: true }>(`/api/goals/${id}/cancel`, { method: 'POST' }),
  styleSample: (id: string, styleKey: string) => req<{ started: true; channel: string; file: string }>(`/api/goals/${id}/brief/style-sample`, { method: 'POST', body: JSON.stringify({ styleKey }) }),
  styleSampleUrl: (id: string, file: string) => `/api/goals/${id}/brief/style-sample/${encodeURIComponent(file.split('/').pop()!)}`,
  addSubject: (id: string, body: { name: string; lookFor?: string; search?: boolean }) => req<BriefSubject>(`/api/goals/${id}/brief/subjects`, { method: 'POST', body: JSON.stringify(body) }),
  updateSubject: (id: string, key: string, body: { name?: string; lookFor?: string }) => req<{ ok: true }>(`/api/goals/${id}/brief/subjects/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeSubject: (id: string, key: string) => req<{ ok: true }>(`/api/goals/${id}/brief/subjects/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  /** search the web for (more) pictures of a Subject; the result arrives as a brief.subject_searched event */
  searchSubject: (id: string, key: string) => req<{ started: true }>(`/api/goals/${id}/brief/subjects/${encodeURIComponent(key)}/search`, { method: 'POST' }),
  /** the person's own pictures of a Subject (a multipart form: the browser sets its boundary) */
  addSubjectPictures: async (id: string, key: string, files: File[]): Promise<SubjectPicture[]> => {
    const fd = new FormData();
    for (const f of files) fd.append('file', f, f.name);
    const res = await fetch(`/api/goals/${id}/brief/subjects/${encodeURIComponent(key)}/pictures`, { method: 'POST', body: fd });
    const body = safeJson(await res.text()) as { pictures?: SubjectPicture[]; error?: string } | string;
    if (!res.ok) throw new ApiError((typeof body === 'object' && body?.error) || `upload failed (${res.status})`, res.status, body);
    return (body as { pictures: SubjectPicture[] }).pictures;
  },
  removeSubjectPicture: (id: string, key: string, file: string) => req<{ ok: true }>(`/api/goals/${id}/brief/subjects/${encodeURIComponent(key)}/pictures/${encodeURIComponent(file)}`, { method: 'DELETE' }),
  subjectPictureUrl: (id: string, file: string) => `/api/goals/${id}/subjects/${encodeURIComponent(file)}`,
  /** the goal's timeline with its Delegated goals: when each step ran and how long it took */
  timeline: (id: string) => req<GoalTimeline>(`/api/goals/${id}/timeline`),
  guide: () => req<{ pages: { slug: string; title: string; zh: string | null }[] }>('/api/guide'),
  guidePage: (slug: string, lang: 'en' | 'zh') => req<{ slug: string; markdown: string; lang: 'en' | 'zh' }>(`/api/guide/page/${encodeURIComponent(slug)}?lang=${lang}`),
  interviewAnswer: (id: string, answers: Record<string, string>, finish = false, note: string | null = null) => req<{ ok: true }>(`/api/goals/${id}/interview/answer`, { method: 'POST', body: JSON.stringify({ answers, finish, note }) }),
  preview: (id: string) => req<PreviewStatus>(`/api/goals/${id}/preview`),
  /** without `app`, starts every app that is not running (Docker services first) */
  previewSources: (id: string) => req<PreviewSources>(`/api/goals/${id}/preview/sources`),
  previewSetSource: (id: string, ref: string | null | undefined, place?: PreviewPlace) => req<PreviewSource>(`/api/goals/${id}/preview/source`, { method: 'PUT', body: JSON.stringify({ ref, place }) }),
  previewStart: (id: string, app?: string) => req<PreviewStatus>(`/api/goals/${id}/preview/start${app ? `?app=${encodeURIComponent(app)}` : ''}`, { method: 'POST' }),
  /** without `app`, stops every app; Docker services keep running */
  previewStop: (id: string, app?: string) => req<{ ok: true }>(`/api/goals/${id}/preview/stop${app ? `?app=${encodeURIComponent(app)}` : ''}`, { method: 'POST' }),
  /** null = the repository has no compose file with services the apps depend on */
  previewServices: (id: string) => req<ServicesStatus | null>(`/api/goals/${id}/preview/services`),
  previewServicesStart: (id: string, names?: string[]) => req<ServicesStatus | null>(`/api/goals/${id}/preview/services/start`, { method: 'POST', body: JSON.stringify(names ? { names } : {}) }),
  previewEnv: (id: string) => req<PreviewEnv>(`/api/goals/${id}/preview/env`),
  /** a null value keeps the saved value of that name; names left out are removed */
  previewSetEnv: (id: string, vars: Record<string, string | null>, rev: number) => req<PreviewEnv>(`/api/goals/${id}/preview/env`, { method: 'PUT', body: JSON.stringify({ vars, rev }) }),
  previewImportEnv: (id: string) => req<{ added: string[]; view: PreviewEnv }>(`/api/goals/${id}/preview/env/import`, { method: 'POST' }),
  previewServicesStop: (id: string, names?: string[]) => req<ServicesStatus | null>(`/api/goals/${id}/preview/services/stop`, { method: 'POST', body: JSON.stringify(names ? { names } : {}) }),
  previewVisit: (id: string) => req<{ ok: true }>(`/api/goals/${id}/preview/visit`, { method: 'POST' }),
  checkOutput: (id: string, resultId: string) => req<{ text: string; full: boolean }>(`/api/goals/${id}/check-results/${resultId}/output`),
  investigate: (id: string) => req<{ ok: true }>(`/api/goals/${id}/investigate`, { method: 'POST' }),
  setPonytail: (id: string, on: boolean) => req<{ ok: true }>(`/api/goals/${id}/ponytail`, { method: 'POST', body: JSON.stringify({ on }) }),
  setMilestonePause: (id: string, on: boolean) => req<{ ok: true }>(`/api/goals/${id}/milestone-pause`, { method: 'POST', body: JSON.stringify({ on }) }),
  setSelfCheck: (id: string, on: boolean) => req<{ ok: true }>(`/api/goals/${id}/selfcheck`, { method: 'POST', body: JSON.stringify({ on }) }),
  feedbackClassify: (id: string, text: string) => req<{ plan: FeedbackPlan }>(`/api/goals/${id}/feedback/classify`, { method: 'POST', body: JSON.stringify({ text }) }),
  screenshots: (id: string) => req<{ screenshots: { at: string; taskId: string | null; status: string; url: string | null; screenshot: string | null; errors: string[]; summary: string }[] }>(`/api/goals/${id}/screenshots`),
  screenshotUrl: (id: string, file: string) => `/api/goals/${id}/screenshots/${encodeURIComponent(file)}`,
  artifacts: (id: string) => req<{ files: string[] }>(`/api/goals/${id}/artifacts`),
  artifactUrl: (id: string, path: string) => `/api/goals/${id}/artifacts/${path.split('/').map(encodeURIComponent).join('/')}`,
  playwright: () => req<{ installed: boolean; browser: boolean; detail: string }>('/api/tools/playwright'),
  installPlaywright: () => req<{ started: true; channel: string; id: string }>('/api/tools/playwright/install', { method: 'POST' }),
  reclarify: (id: string, reason?: string) => req<{ ok: true }>(`/api/goals/${id}/reclarify`, { method: 'POST', body: JSON.stringify({ reason }) }),
  streamHistory: (id: string) => req<{ events: any[] }>(`/api/stream/${encodeURIComponent(id)}/history`),
  /** one live-log event in full, read back from the transcript line its `ref` names */
  fileStat: (ref: FileRef) => req<FileInfo>(`/api/files/stat?${fileQuery(ref)}`),
  taskFiles: (goalId: string, taskId: string) => req<{ files: TaskFile[]; relevant: { rel: string; open: FileRef | null }[]; delivers?: { rel: string; open: FileRef | null }[] }>(`/api/goals/${goalId}/tasks/${taskId}/files`),
  streamEvent: (ref: { file: string; line: number; block: number }) => req<{ event: any }>(`/api/transcripts/${encodeURIComponent(ref.file)}/event?line=${ref.line}&block=${ref.block}`),
  workspace: (id: string) => req<{ path: string; exists: boolean; branch: string; head: string | null; packageManager: string | null; install: string | null; scripts: { name: string; command: string }[]; baseSync: Goal['baseSync']; upstream: BaseSync | null; tasks: { id: string; title: string; path: string; branch: string | null }[] }>(`/api/goals/${id}/workspace`),
  restartGoal: (id: string, fromTaskId?: string) => req<{ restarted: string[] }>(`/api/goals/${id}/restart`, { method: 'POST', body: JSON.stringify({ fromTaskId }) }),
  ports: () => req<PortsView>('/api/ports'),
  releasePort: (id: string) => req<{ released: PortRow }>('/api/ports/release', { method: 'POST', body: JSON.stringify({ id }) }),
  rerunMilestone: (id: string, taskId: string) => req<{ started: string[] }>(`/api/goals/${id}/milestones/${taskId}/rerun`, { method: 'POST' }),
  unstickTask: (id: string, taskId: string, force = false) => req<{ action: 'scheduled' | 'stopped' }>(`/api/goals/${id}/tasks/${taskId}/unstick`, { method: 'POST', body: JSON.stringify({ force }) }),
  deleteGoal: (id: string, deleteBranch: boolean) => req<{ ok: true; deletedBranch: string | null }>(`/api/goals/${id}${deleteBranch ? '?deleteBranch=1' : ''}`, { method: 'DELETE' }),
  viewSkill: (dir: string) => req<{ name: string; dir: string; invoke: string; skillMd: string | null; files: { path: string; size: number }[] }>(`/api/skills/view?dir=${encodeURIComponent(dir)}`),
  uninstallMany: (names: string[], force = true, opId?: string) => req<{ results: { name: string; ok: boolean; error: string | null; note: string | null }[]; op: SkillOp }>('/api/skills/uninstall-many', { method: 'POST', body: JSON.stringify({ names, force, opId }) }),
  /** `opId`: run it as the caller's own Skills operation (its own channel) instead of on the shared tool-install log */
  installTool: (id: string, opId?: string) => req<{ started: true; channel: string; id: string; op: SkillOp }>('/api/tools/install', { method: 'POST', body: JSON.stringify({ id, opId }) }),
  diff: (id: string) => fetch(`/api/goals/${id}/diff`).then((r) => r.text()),
  push: (id: string, remote = 'origin') => req<{ ok: boolean; output: string }>(`/api/goals/${id}/push`, { method: 'POST', body: JSON.stringify({ remote }) }),
  transcript: (attemptId: string) => fetch(`/api/attempts/${attemptId}/transcript`).then((r) => r.text()),
  prompt: (attemptId: string) => fetch(`/api/attempts/${attemptId}/prompt`).then((r) => r.text()),
  resolve: {
    get: (goalId: string, taskId: string) => req<{ can: { ok: boolean; reason: string | null }; state: ResolveState | null }>(`/api/goals/${goalId}/tasks/${taskId}/resolve`),
    start: (goalId: string, taskId: string, fresh = false) => req<ResolveState>(`/api/goals/${goalId}/tasks/${taskId}/resolve/start`, { method: 'POST', body: JSON.stringify({ fresh }) }),
    file: (goalId: string, taskId: string, path: string, content: string) => req<ResolveState>(`/api/goals/${goalId}/tasks/${taskId}/resolve/file`, { method: 'PUT', body: JSON.stringify({ path, content }) }),
    take: (goalId: string, taskId: string, path: string, side: 'ours' | 'theirs' | 'both') => req<ResolveState>(`/api/goals/${goalId}/tasks/${taskId}/resolve/take`, { method: 'POST', body: JSON.stringify({ path, side }) }),
    unresolve: (goalId: string, taskId: string, path: string) => req<ResolveState>(`/api/goals/${goalId}/tasks/${taskId}/resolve/unresolve`, { method: 'POST', body: JSON.stringify({ path }) }),
    finish: (goalId: string, taskId: string, force = false) => req<FinishResult>(`/api/goals/${goalId}/tasks/${taskId}/resolve/finish`, { method: 'POST', body: JSON.stringify({ force }) }),
    abort: (goalId: string, taskId: string) => req<{ ok: true }>(`/api/goals/${goalId}/tasks/${taskId}/resolve/abort`, { method: 'POST', body: '{}' }),
  },
  escalations: (openOnly = true) => req<EscalationRow[]>(`/api/escalations${openOnly ? '?open=1' : ''}`),
  answer: (id: string, answer: EscalationAnswer) => req<{ ok: true }>(`/api/escalations/${id}/answer`, { method: 'POST', body: JSON.stringify(answer) }),
  /** a material the person promised in the Brief arrives (ADR-0074): staged uploads and links with a word, or none (waived) */
  receiveMaterial: (goalId: string, key: string, body: { attachments?: Attachment[]; note?: string | null; waived?: boolean }) => req<{ ok: true }>(`/api/goals/${goalId}/materials/${encodeURIComponent(key)}`, { method: 'POST', body: JSON.stringify(body) }),
  /** AI analyses a blocked task; `apply` = answer retry_with_hint right away when that is the suggestion */
  suggest: (id: string, apply = false) => req<{ suggestion: EscalationSuggestion; applied: boolean }>(`/api/escalations/${id}/suggest`, { method: 'POST', body: JSON.stringify({ apply }) }),
  // skills & setup
  skills: (repo?: string) => req<SkillsOverview>(`/api/skills${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`),
  installSkill: (id: string, force = false, opId?: string) => req<InstallResult & { op: SkillOp }>('/api/skills/install', { method: 'POST', body: JSON.stringify({ id, force, opId }) }),
  installTier: (tiers: SkillTier[], opId?: string) => req<{ results: (InstallResult & { conflict?: boolean })[]; op: SkillOp }>('/api/skills/install-tier', { method: 'POST', body: JSON.stringify({ tiers, opId }) }),
  uninstallSkill: (name: string, force = false) => req<{ ok: true; trash: TrashEntry; note: string | null }>(`/api/skills/${encodeURIComponent(name)}/uninstall`, { method: 'POST', body: JSON.stringify({ force }) }),
  restoreSkill: (name: string, trashPath?: string) => req<{ ok: true; path: string }>(`/api/skills/${encodeURIComponent(name)}/restore`, { method: 'POST', body: JSON.stringify({ trashPath }) }),
  updateSkills: (name?: string) => req<{ updated: { name: string; from: string | null; to: string | null }[]; unchanged: string[]; errors: { name: string; error: string }[] }>('/api/skills/update', { method: 'POST', body: JSON.stringify({ name }) }),
  trash: () => req<TrashEntry[]>('/api/skills/trash'),
  skillsUpdates: (refresh = false, repo?: string) => req<SkillsUpdateReport & { updating: string | null; refreshing: boolean }>(`/api/skills/updates?${new URLSearchParams({ ...(refresh ? { refresh: '1' } : {}), ...(repo ? { repo } : {}) })}`),
  updateSource: (id: string, names?: string[], opId?: string) => req<{ started: true; channel: string; op: SkillOp }>(`/api/skills/sources/${encodeURIComponent(id)}/update`, { method: 'POST', body: JSON.stringify({ names, opId }) }),
  // workflow suite releases (ADR-0068)
  suiteReleases: (refresh = false) => req<{ releases: SuiteReleaseView[] }>(`/api/skills/releases${refresh ? '?refresh=1' : ''}`),
  releaseForecast: (id: string, to: string) => req<ReleaseForecast>(`/api/skills/releases/${encodeURIComponent(id)}/forecast?to=${encodeURIComponent(to)}`),
  moveRelease: (id: string, to: string, opId?: string) => req<{ started: true; channel: string; op: SkillOp }>(`/api/skills/releases/${encodeURIComponent(id)}/move`, { method: 'POST', body: JSON.stringify({ to, opId }) }),
  adoptSkills: (names: string[], opId?: string) => req<{ runs: SkillUpdateRun[]; op: SkillOp }>('/api/skills/adopt', { method: 'POST', body: JSON.stringify({ names, opId }) }),
  skillOp: (id: string) => req<SkillOp>(`/api/skills/ops/${encodeURIComponent(id)}`),
  skillOps: () => req<{ ops: SkillOp[] }>('/api/skills/ops'),
  mcp: () => req<McpView>('/api/mcp'),
  mcpCheck: () => req<{ health: McpHealth[] }>('/api/mcp/check', { method: 'POST' }),
  mcpAllow: (prefix: string, on: boolean) => req<{ allowed: string[] }>('/api/mcp/allowed', { method: 'PUT', body: JSON.stringify({ prefix, on }) }),
  mcpInstall: (what: { catalogId: string } | { custom: McpCustomServer }, keys: Record<string, string>, opId?: string, replace = false) => req<{ ok: boolean; error: string | null; op: SkillOp }>('/api/mcp/install', { method: 'POST', body: JSON.stringify({ ...what, keys, opId, replace }) }),
  mcpLogin: (name: string) => req<McpLoginSession>('/api/mcp/login', { method: 'POST', body: JSON.stringify({ name }) }),
  mcpLoginSession: () => req<McpLoginSession | null>('/api/mcp/login'),
  mcpLoginSubmit: (url: string) => req<McpLoginSession>('/api/mcp/login/code', { method: 'POST', body: JSON.stringify({ url }) }),
  mcpLoginCancel: () => req<{ ok: boolean }>('/api/mcp/login/cancel', { method: 'POST' }),
  mcpRemove: (name: string, opId?: string) => req<{ ok: boolean; error: string | null; op: SkillOp }>('/api/mcp/remove', { method: 'POST', body: JSON.stringify({ name, opId }) }),
  // Memory (ADR-0072): the Hindsight card on the MCP tab, and a folder's switch on the Learnings page
  memoryStatus: () => req<MemoryStatus>('/api/memory'),
  memoryTest: (url: string, token?: string | null) => req<{ ok: boolean; version: string | null; error: string | null }>('/api/memory/test', { method: 'POST', body: JSON.stringify({ url, token }) }),
  memorySave: (body: { url: string | null; token?: string | null; retainTranscripts?: boolean; reflectSec?: number; seedCommits?: number }) => req<MemoryStatus>('/api/memory', { method: 'PUT', body: JSON.stringify(body) }),
  memoryMcp: (provider: AgentProvider, opId: string, remove = false) => req<{ ok: boolean; error: string | null; op: SkillOp }>('/api/memory/mcp', { method: 'POST', body: JSON.stringify({ provider, opId, remove }) }),
  memoryFolder: (repoPath: string) => req<MemoryFolderStatus>(`/api/memory/folder?repo=${encodeURIComponent(repoPath)}`),
  setMemoryFolder: (repoPath: string, on: boolean) => req<MemoryFolderStatus>('/api/memory/folder', { method: 'PUT', body: JSON.stringify({ repoPath, on }) }),
  uninstallPlugin: (sourceId: string, opId?: string) => req<{ ok: boolean; error: string | null; op: SkillOp }>('/api/skills/plugins/uninstall', { method: 'POST', body: JSON.stringify({ sourceId, opId }) }),
  cleanupShadows: (names: string[]) => req<{ trashed: TrashEntry[]; skipped: { name: string; reason: string }[] }>('/api/skills/cleanup-shadows', { method: 'POST', body: JSON.stringify({ names }) }),
  /** starts the install in the background: follow its channel, or awaitSkillOp(op) for the outcome */
  installBundle: (bundle: string, opId?: string) => req<{ started: true; channel: string; op: SkillOp }>('/api/skills/install-bundle', { method: 'POST', body: JSON.stringify({ bundle, opId }) }),
  /** text-to-cad for this provider: installed, and uv (which runs cadgen) on this computer */
  cad: (provider?: AgentProvider) => req<{ installed: boolean; uv: boolean }>(`/api/cad${provider ? `?provider=${provider}` : ''}`),
  updateRuns: () => req<(EngineEvent & { seq: number })[]>('/api/skills/update-runs'),
  doctor: () => req<DoctorReport>('/api/doctor'),
  packs: () => req<PacksView>('/api/skills/packs'),
  models: (provider: AgentProvider = 'claude') => req<{ models: ModelRecordView[]; fallbacks: string[]; current: { strong: string; cheap: string; worker: string }; sync: { at: string | null; cliVersion: string | null; found: number } | null }>(`/api/models?provider=${provider}`),
  syncModels: (provider: AgentProvider = 'claude') => req<{ found: number; newest: string[]; resolved: Record<string, string | null>; cliVersion: string | null }>(`/api/models/sync?provider=${provider}`, { method: 'POST' }),
  probeModel: (name: string, provider: AgentProvider = 'claude', effort?: string) => req<{ ok: boolean; name: string; resolvedId: string | null; costUsd: number; costAvailable?: boolean; error: string | null }>(`/api/models/probe?provider=${provider}`, { method: 'POST', body: JSON.stringify({ name, effort }) }),
  installPack: (pack: string, option: string) => req<{ started: true; channel: string }>('/api/skills/install-pack', { method: 'POST', body: JSON.stringify({ pack, option }) }),
  settings: () => req<SettingsView>('/api/settings'),
  updateSettings: (patch: SettingsPatch) => req<SettingsView>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  resetSetting: (path: string) => req<SettingsView>(`/api/settings/${encodeURIComponent(path)}`, { method: 'DELETE' }),
  resetSettings: () => req<SettingsView>('/api/settings/reset', { method: 'POST' }),
  notifyTest: (override: { telegramBotToken?: string | null; telegramChatId?: string | null; discordWebhookUrl?: string | null; discordBotToken?: string | null }) => req<{ results: { channel: string; ok: boolean; error: string | null }[] }>('/api/notifications/test', { method: 'POST', body: JSON.stringify(override) }),
  telegramChatId: (token: string | null) => req<{ chatId: string; who: string }>('/api/notifications/telegram/chat-id', { method: 'POST', body: JSON.stringify({ token }) }),
  health: () => req<{ ok: boolean; active: number; events: number; pausedUntil: string | null; pausedUntilByProvider: Record<AgentProvider, string | null>; switchToByProvider?: Partial<Record<AgentProvider, string | null>>; currentAccountByProvider?: Partial<Record<AgentProvider, string | null>>; restartNeeded: string[]; version: string; webBuild?: string | null; updateAvailable: boolean; updating: boolean }>('/api/health'),
  updateStatus: () => req<UpdateStatusView>('/api/update'),
  updateCheck: () => req<UpdateReportView>('/api/update/check', { method: 'POST' }),
  updateApply: (force = false) => req<{ started: true; channel: string }>('/api/update/apply', { method: 'POST', body: JSON.stringify({ force }) }),
  accounts: (force = false) => req<AccountsInfo>(`/api/accounts?force=${force ? '1' : '0'}`),
  auth: (force = false, provider?: AgentProvider) => req<AuthInfo>(`/api/auth?force=${force ? '1' : '0'}${provider ? '&provider=' + provider : ''}`),
  startLogin: (body: { email?: string }, provider?: AgentProvider) => req<LoginSession>(`/api/auth/login${provider ? '?provider=' + provider : ''}`, { method: 'POST', body: JSON.stringify(body) }),
  loginSession: (provider?: AgentProvider) => req<LoginSession | null>(`/api/auth/login${provider ? '?provider=' + provider : ''}`),
  cancelLogin: (provider?: AgentProvider) => req<{ ok: true }>(`/api/auth/login/cancel${provider ? '?provider=' + provider : ''}`, { method: 'POST' }),
  submitLoginCode: (code: string, provider?: AgentProvider) => req<LoginSession>(`/api/auth/login/code${provider ? '?provider=' + provider : ''}`, { method: 'POST', body: JSON.stringify({ code }) }),
  logout: (provider?: AgentProvider) => req<ClaudeAuthStatus>(`/api/auth/logout${provider ? '?provider=' + provider : ''}`, { method: 'POST' }),
  // a coding agent's other accounts (ADR-0065)
  addAccount: (provider: AgentProvider, body: { email?: string }) => req<LoginSession>(`/api/accounts/${provider}/add`, { method: 'POST', body: JSON.stringify(body) }),
  addAccountSession: (provider: AgentProvider) => req<LoginSession | null>(`/api/accounts/${provider}/add`),
  addAccountCode: (provider: AgentProvider, code: string) => req<LoginSession>(`/api/accounts/${provider}/add/code`, { method: 'POST', body: JSON.stringify({ code }) }),
  addAccountCancel: (provider: AgentProvider) => req<{ ok: true }>(`/api/accounts/${provider}/add/cancel`, { method: 'POST' }),
  useAccount: (provider: AgentProvider, id: string) => req<{ ok: true }>(`/api/accounts/${provider}/${id}/use`, { method: 'POST' }),
  removeAccount: (provider: AgentProvider, id: string) => req<{ ok: true }>(`/api/accounts/${provider}/${id}`, { method: 'DELETE' }),
  orderAccounts: (provider: AgentProvider, order: string[]) => req<{ ok: true }>(`/api/accounts/${provider}/order`, { method: 'POST', body: JSON.stringify({ order }) }),
  setAutoSwitch: (provider: AgentProvider, on: boolean) => req<{ ok: true }>(`/api/accounts/${provider}/auto-switch`, { method: 'POST', body: JSON.stringify({ on }) }),
  usage: (provider?: AgentProvider) => req<Usage>(`/api/usage${provider ? '?provider=' + provider : ''}`),
  /** Reports (ADR-0060): the last `days`, or all time with null */
  report: (days: number | null) => req<Report>(`/api/reports?days=${days ?? 'all'}`),
  /** Access (ADR-0061) */
  accessMe: () => req<AccessMe>('/api/access/me'),
  accessLogin: (token: string) => req<{ person: Person }>('/api/access/login', { method: 'POST', body: JSON.stringify({ token }) }),
  accessLogout: () => req<{ ok: true }>('/api/access/logout', { method: 'POST' }),
  accessPeople: () => req<{ enabled: boolean; people: Person[] }>('/api/access/people'),
  accessAdd: (name: string) => req<{ person: Person; token: string }>('/api/access/people', { method: 'POST', body: JSON.stringify({ name }) }),
  accessRevoke: (id: string) => req<{ person: Person }>(`/api/access/people/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  resumeUsage: (provider?: AgentProvider) => req<{ resumed: boolean }>(`/api/usage/resume${provider ? `?provider=${provider}` : ''}`, { method: 'POST' }),
  /** Switch and continue: new sessions go to the next account whose limit is not holding, and the pause lifts */
  switchUsageAccount: (provider: AgentProvider) => req<{ to: string | null }>(`/api/usage/switch?provider=${provider}`, { method: 'POST' }),
  probeUsage: (provider?: AgentProvider) => req<Usage>(`/api/usage/probe${provider ? `?provider=${provider}` : ''}`, { method: 'POST' }),
  minimaxQuota: (refresh = false) => req<MinimaxQuota>(`/api/usage/minimax${refresh ? '?refresh=1' : ''}`),
  transferExport: (body: { categories: TransferCategories; goalIds: 'all' | string[]; password?: string }) => req<{ downloadId: string; bytes: number; goals: number; categories: TransferCategories }>('/api/transfer/export', { method: 'POST', body: JSON.stringify(body) }),
  /** the file itself is the body: the browser streams it */
  transferUpload: (file: Blob) => req<IncomingReport>('/api/transfer/incoming', { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' } }),
  transferSecrets: (uploadId: string, password: string) => req<SecretsPreview>(`/api/transfer/incoming/${uploadId}/secrets`, { method: 'POST', body: JSON.stringify({ password }) }),
  transferApply: (uploadId: string, choices: ImportChoices) => req<ImportReport>(`/api/transfer/incoming/${uploadId}/apply`, { method: 'POST', body: JSON.stringify(choices) }),
  transferDiscard: (uploadId: string) => req<{ ok: true }>(`/api/transfer/incoming/${uploadId}`, { method: 'DELETE' }),
  mapRepo: (goalId: string, path: string) => req<MapResult>(`/api/goals/${goalId}/map-repo`, { method: 'POST', body: JSON.stringify({ path }) }),
  reattach: (goalId: string) => req<Goal>(`/api/goals/${goalId}/reattach`, { method: 'POST' }),
};
}

/** where the browser downloads a Transfer file written by transferExport */
export const transferDownloadUrl = (downloadId: string) => `/api/transfer/download/${downloadId}`;

/** Transfer (ADR-0030) — mirrors packages/engine/src/transfer/import.ts and reattach.ts */
export interface TransferCategories {
  settings?: boolean;
  secrets?: boolean;
  goals?: boolean;
  transcripts?: boolean;
}
export interface IncomingGoal {
  id: string;
  title: string;
  state: GoalState;
  provider: AgentProvider | null;
  createdAt: string;
  costUsd: number;
  repoPath: string;
  remoteUrl: string | null;
  baseBranch: string;
  branch: string;
  unfinished: boolean;
  events: number;
  bundle: boolean;
  artifacts: boolean;
  status: 'new' | 'here' | 'deleted-here';
  follows: { goalId: string; title: string; inFile: boolean; here: boolean } | null;
}
export interface IncomingReport {
  uploadId: string;
  release: string;
  exportedAt: string;
  hostname: string;
  categories: TransferCategories;
  goals: IncomingGoal[];
  repos: { original: string; remoteUrl: string | null; goals: string[]; match: string | null }[];
  settings: { section: string; keys: string[] }[];
  secrets: boolean;
}
export interface SecretsPreview {
  settings: { key: string; imported: string; mine: string | null; same: boolean }[];
  previewEnv: { repo: string; keys: string[] }[];
}
export interface ImportChoices {
  goals?: string[];
  settings?: Record<string, 'imported' | 'mine'>;
  secrets?: { password: string; keepMine: string[] } | null;
  repos?: Record<string, string | null>;
}
export interface ImportReport {
  imported: { id: string; title: string }[];
  skipped: { id: string; title: string; reason: string }[];
  settings: string[];
  secrets: string[];
  previewEnv: { applied: string[]; waiting: string[] };
  repos: { original: string; to: string; error: string | null }[];
}
export interface MapResult {
  original: string;
  to: string;
  goals: string[];
  restored: string[];
  previewEnv: string[];
}

export const api = apiForProvider();

export type DeployHost = 'vercel' | 'netlify' | 'cloudflare';
/** what Deploy can do for a goal now (GET /api/goals/:id/deploy) */
/** Mirrors the engine's RevertInfo (delivery/revert.ts, ADR-0059): what a Revert would undo, and whether one can start now. */
export interface RevertInfo {
  ok: boolean;
  why: string | null;
  /** the merges it would undo, newest first */
  reverts: { prNumber: number | null; ref: string; title: string }[];
  base: string;
  remote: string;
  method: MergeMethod;
  running: boolean;
  open: DeliveryRevert | null;
}

export interface DeployInfo {
  app: { ok: true; app: { dir: string; framework: string; kind: 'static' | 'built' | 'ssr' }; notes: string[] } | { ok: false; reason: string };
  finished: boolean;
  running: boolean;
  /** a Smoke again runs (ADR-0058) */
  smoking: boolean;
  /** the milestone scripts a smoke tries against the address */
  smoke: { scripts: string[] };
  providers: { id: DeployHost; label: string; configured: boolean; refused: string | null }[];
  /** the exact commands, tokens left out */
  plan: { label: string; command: string }[];
  deployments: Deployment[];
}
