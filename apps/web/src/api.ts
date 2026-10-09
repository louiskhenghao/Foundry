import type { FeedbackPlan } from '@foundry/core/browser';
import type { Attachment, Attempt, Brief, BriefApp, BriefCheck, BriefDiff, BriefRun, BriefStyleOption, BriefTask, Budgets, Check, CheckResult, CodexEffort, DeliveryPlanStep, DeliveryPolicy, DeliveryState, DocType, EngineEvent, Escalation, EscalationAnswer, EscalationSuggestion, Goal, GoalMode, GoalNature, GoalState, SettingsPatch, SettingsView, Task, TaskUsage } from '@foundry/core/browser';

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
  kind: 'install' | 'install-tier' | 'update' | 'adopt' | 'uninstall' | 'tool-install';
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
  task: Partial<Pick<BriefTask, 'spec' | 'kind' | 'scope' | 'scenario' | 'areaKey' | 'dependsOnKeys' | 'relevantFiles'>> | null;
  tasks: BriefTask[];
  checks: BriefCheck[];
  rationale: string;
  costUsd: number;
  revision?: { diff: BriefDiff; revised: Omit<Brief, 'goalId'>; changeSummary: string };
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
}

export interface RepoInfo {
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
import type { DoctorReport, InstallResult, SkillTier, SkillUpdateRun, SkillsOverview, SkillsUpdateReport, TrashEntry } from '@foundry/engine/skills-types';
import type { MinimaxQuota, UsageSummary } from '@foundry/engine/usage-types';

export type Usage = UsageSummary & { pausedUntil: string | null };

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
export type AgentProvider = 'claude' | 'codex';
export interface AccountInfo { provider: AgentProvider; installed: boolean; status: ClaudeAuthStatus; capabilities: { dollarCosts: boolean; skillTelemetry: boolean; nativeSubagents: boolean; managedMcp: boolean; externalSessions: boolean } }
export interface AccountsInfo { defaultProvider: AgentProvider; accounts: AccountInfo[] }
export interface AuthInfo {
  provider: 'claude' | 'codex';
  status: ClaudeAuthStatus;
  login: LoginSession | null;
}

import type { CodexPluginsView } from '@foundry/engine/plugins-types';
import type { McpHealth, McpLoginSession, McpView } from '@foundry/engine/mcp-types';
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
  available: boolean;
  via: string | null;
}
export interface GoalDetail {
  goal: Goal;
  /** directories the Open menu can launch: the user's checkout and the goal branch worktree (when it exists) */
  paths: { repo: string; workspace: string | null };
  budget: BudgetStatus;
  /** live: a slot held / a session process alive; waiting: why a ready task is not running (null: nothing holds it back) */
  tasks: (Task & { depth: number; usage: TaskUsage | null; live?: { inFlight: boolean; session: boolean; since: string | null }; waiting?: string | null })[];
  attempts: Attempt[];
  checks: Check[];
  checkResults: CheckResult[];
  brief: { brief: Brief; approved: boolean } | null;
  escalations: EscalationRow[];
  events: (EngineEvent & { seq: number })[];
  /** every milestone visit and walkthrough of the goal, oldest first, however far back */
  milestoneEvents: (EngineEvent & { seq: number })[];
  /** Follows / Followed by (goal.follows holds the earlier goal; it may have been deleted since) */
  followUps: { followsExists: boolean; followedBy: { id: string; title: string; state: GoalState }[] };
}

/** Mirrors the engine's FollowUpDraft (follow-up.ts): prefill and start point for a Follow-up of a goal. */
export interface FollowUpDraft {
  previous: { id: string; title: string; state: GoalState; repoPath: string; baseBranch: string; branch: string; branchExists: boolean };
  followable: boolean;
  reason: string | null;
  prefill: { provider: 'claude' | 'codex'; codexModel?: string; repoPath: string; baseBranch: string; nature: GoalNature; modelPreset: string | null; effort: CodexEffort | null; pace: 'thorough' | 'fast'; mode: GoalMode; delivery: DeliveryPolicy };
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
  kind: 'image' | 'pdf' | 'video' | 'audio' | 'markdown' | 'json' | 'text' | 'binary';
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
  markFollowUp: (id: string, goalId: string) => req<Goal>(`/api/goals/${id}/follows`, { method: 'POST', body: JSON.stringify({ goalId }) }),
  validateRepo: (repoPath: string) => req<RepoInfo>('/api/validate-repo', { method: 'POST', body: JSON.stringify({ repoPath }) }),
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
  refreshDelivery: (id: string) => req<{ ok: true; delivery: DeliveryState }>(`/api/goals/${id}/delivery/refresh`, { method: 'POST' }),
  afterMerge: (id: string, opts: { pull?: boolean; force?: boolean }) => req<{ ok: true; delivery: DeliveryState }>(`/api/goals/${id}/delivery/after-merge`, { method: 'POST', body: JSON.stringify(opts) }),
  deliveryPlan: (id: string, q: Record<string, string>) => req<{ policy: DeliveryPolicy; probes: any; steps: DeliveryPlanStep[] }>(`/api/goals/${id}/delivery/plan?${new URLSearchParams(q)}`),
  cancelDelivery: (id: string) => req<{ ok: boolean }>(`/api/goals/${id}/delivery/cancel`, { method: 'POST' }),
  editBrief: (id: string, brief: Brief) => req<Brief>(`/api/goals/${id}/brief`, { method: 'PATCH', body: JSON.stringify(brief) }),
  draftBrief: (id: string, body: DraftRequest) => req<{ proposal: DraftProposal }>(`/api/goals/${id}/brief/draft`, { method: 'POST', body: JSON.stringify(body) }),
  approveBrief: (id: string, brief?: Brief, budgets?: Partial<Budgets>, completion?: { graphRefresh: boolean; docs: DocType[] }) => req<{ ok: true }>(`/api/goals/${id}/brief/approve`, { method: 'POST', body: brief || budgets || completion ? JSON.stringify({ ...(brief ?? {}), ...(budgets ? { budgets } : {}), ...(completion ? { completion } : {}) }) : '' }),
  cancelGoal: (id: string) => req<{ ok: true }>(`/api/goals/${id}/cancel`, { method: 'POST' }),
  styleSample: (id: string, styleKey: string) => req<{ started: true; channel: string; file: string }>(`/api/goals/${id}/brief/style-sample`, { method: 'POST', body: JSON.stringify({ styleKey }) }),
  styleSampleUrl: (id: string, file: string) => `/api/goals/${id}/brief/style-sample/${encodeURIComponent(file.split('/').pop()!)}`,
  guide: () => req<{ pages: { slug: string; title: string; zh: string | null }[] }>('/api/guide'),
  guidePage: (slug: string, lang: 'en' | 'zh') => req<{ slug: string; markdown: string; lang: 'en' | 'zh' }>(`/api/guide/page/${encodeURIComponent(slug)}?lang=${lang}`),
  interviewAnswer: (id: string, answers: Record<string, string>, finish = false) => req<{ ok: true }>(`/api/goals/${id}/interview/answer`, { method: 'POST', body: JSON.stringify({ answers, finish }) }),
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
  taskFiles: (goalId: string, taskId: string) => req<{ files: TaskFile[]; relevant: { rel: string; open: FileRef | null }[] }>(`/api/goals/${goalId}/tasks/${taskId}/files`),
  streamEvent: (ref: { file: string; line: number; block: number }) => req<{ event: any }>(`/api/transcripts/${encodeURIComponent(ref.file)}/event?line=${ref.line}&block=${ref.block}`),
  workspace: (id: string) => req<{ path: string; exists: boolean; branch: string; head: string | null; packageManager: string | null; install: string | null; scripts: { name: string; command: string }[]; baseSync: Goal['baseSync']; upstream: BaseSync | null; tasks: { id: string; title: string; path: string; branch: string | null }[] }>(`/api/goals/${id}/workspace`),
  restartGoal: (id: string, fromTaskId?: string) => req<{ restarted: string[] }>(`/api/goals/${id}/restart`, { method: 'POST', body: JSON.stringify({ fromTaskId }) }),
  unstickTask: (id: string, taskId: string) => req<{ action: 'scheduled' | 'stopped' }>(`/api/goals/${id}/tasks/${taskId}/unstick`, { method: 'POST' }),
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
  uninstallPlugin: (sourceId: string, opId?: string) => req<{ ok: boolean; error: string | null; op: SkillOp }>('/api/skills/plugins/uninstall', { method: 'POST', body: JSON.stringify({ sourceId, opId }) }),
  cleanupShadows: (names: string[]) => req<{ trashed: TrashEntry[]; skipped: { name: string; reason: string }[] }>('/api/skills/cleanup-shadows', { method: 'POST', body: JSON.stringify({ names }) }),
  installBundle: (bundle: string) => req<{ results: { id: string; name: string; action: 'plugin' | 'updated' | 'adopted' | 'installed' | 'kept' | 'failed'; detail: string }[] }>('/api/skills/install-bundle', { method: 'POST', body: JSON.stringify({ bundle }) }),
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
  notifyTest: (override: { telegramBotToken?: string | null; telegramChatId?: string | null; discordWebhookUrl?: string | null }) => req<{ results: { channel: string; ok: boolean; error: string | null }[] }>('/api/notifications/test', { method: 'POST', body: JSON.stringify(override) }),
  telegramChatId: (token: string | null) => req<{ chatId: string; who: string }>('/api/notifications/telegram/chat-id', { method: 'POST', body: JSON.stringify({ token }) }),
  health: () => req<{ ok: boolean; active: number; events: number; pausedUntil: string | null; pausedUntilByProvider: Record<AgentProvider, string | null>; restartNeeded: string[]; version: string; updateAvailable: boolean; updating: boolean }>('/api/health'),
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
  usage: (provider?: AgentProvider) => req<Usage>(`/api/usage${provider ? '?provider=' + provider : ''}`),
  resumeUsage: (provider?: AgentProvider) => req<{ resumed: boolean }>(`/api/usage/resume${provider ? `?provider=${provider}` : ''}`, { method: 'POST' }),
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
