import type { FeedbackPlan } from '@foundry/core/browser';
import type { Attachment, Attempt, Brief, BriefCheck, BriefDiff, BriefStyleOption, BriefTask, Budgets, Check, CheckResult, DeliveryPlanStep, DeliveryPolicy, DeliveryState, DocType, Effort, EngineEvent, Escalation, EscalationAnswer, EscalationSuggestion, Goal, GoalMode, GoalNature, GoalState, SettingsPatch, SettingsView, Task, TaskUsage } from '@foundry/core/browser';

/** Mirrors the engine's PreviewStatus (preview/manager.ts). */
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
  run: { install: string | null; command: string | null; url: string | null; platform: 'web' | 'expo' | 'none' } | null;
  source: 'brief' | 'detected' | null;
  error: string | null;
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
}
export interface PackEntry {
  id: string;
  name: string;
  invoke: string;
  status: 'installed' | 'installed-unmanaged' | 'installed-via-plugin' | 'partial' | 'missing';
  detail: string;
  manual: { command: string; docs: string | null } | null;
  sourceType: 'git' | 'cli' | 'manual' | 'plugin';
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
import type { UsageSummary } from '@foundry/engine/usage-types';

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
export interface LoginSession {
  id: string;
  mode: 'claudeai' | 'console';
  startedAt: string;
  url: string | null;
  lines: string[];
  done: boolean;
  ok: boolean | null;
  error: string | null;
  finishedAt: string | null;
  /** the CLI is waiting for the code shown in the browser (no browser on the engine's machine) */
  needsCode: boolean;
}
export interface AuthInfo {
  status: ClaudeAuthStatus;
  login: LoginSession | null;
}

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
export type EscalationRow = Escalation & { goalTitle?: string; taskTitle?: string | null; taskState?: string | null };

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
  tasks: (Task & { depth: number; usage: TaskUsage | null })[];
  attempts: Attempt[];
  checks: Check[];
  checkResults: CheckResult[];
  brief: { brief: Brief; approved: boolean } | null;
  escalations: Escalation[];
  events: (EngineEvent & { seq: number })[];
  /** Follows / Followed by (goal.follows holds the earlier goal; it may have been deleted since) */
  followUps: { followsExists: boolean; followedBy: { id: string; title: string; state: GoalState }[] };
}

/** Mirrors the engine's FollowUpDraft (follow-up.ts): prefill and start point for a Follow-up of a goal. */
export interface FollowUpDraft {
  previous: { id: string; title: string; state: GoalState; repoPath: string; baseBranch: string; branch: string; branchExists: boolean };
  followable: boolean;
  reason: string | null;
  prefill: { repoPath: string; baseBranch: string; nature: GoalNature; modelPreset: string | null; effort: Effort | null; pace: 'thorough' | 'fast'; mode: GoalMode; delivery: DeliveryPolicy };
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

async function req<T>(path: string, init?: RequestInit): Promise<T> {
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

export const api = {
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
  githubLogin: () => req<{ started: boolean }>('/api/github/auth/login', { method: 'POST' }),
  deliver: (id: string, policy: Partial<DeliveryPolicy>) => req<{ ok: true; delivery: DeliveryState }>(`/api/goals/${id}/deliver`, { method: 'POST', body: JSON.stringify(policy) }),
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
  previewStart: (id: string) => req<PreviewStatus>(`/api/goals/${id}/preview/start`, { method: 'POST' }),
  previewStop: (id: string) => req<{ ok: true }>(`/api/goals/${id}/preview/stop`, { method: 'POST' }),
  previewVisit: (id: string) => req<{ ok: true }>(`/api/goals/${id}/preview/visit`, { method: 'POST' }),
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
  workspace: (id: string) => req<{ path: string; exists: boolean; branch: string; head: string | null; packageManager: string | null; install: string | null; scripts: { name: string; command: string }[]; baseSync: Goal['baseSync']; upstream: BaseSync | null; tasks: { id: string; title: string; path: string; branch: string | null }[] }>(`/api/goals/${id}/workspace`),
  restartGoal: (id: string, fromTaskId?: string) => req<{ restarted: string[] }>(`/api/goals/${id}/restart`, { method: 'POST', body: JSON.stringify({ fromTaskId }) }),
  deleteGoal: (id: string, deleteBranch: boolean) => req<{ ok: true; deletedBranch: string | null }>(`/api/goals/${id}${deleteBranch ? '?deleteBranch=1' : ''}`, { method: 'DELETE' }),
  viewSkill: (dir: string) => req<{ name: string; dir: string; invoke: string; skillMd: string | null; files: { path: string; size: number }[] }>(`/api/skills/view?dir=${encodeURIComponent(dir)}`),
  uninstallMany: (names: string[], force = true) => req<{ results: { name: string; ok: boolean; error: string | null; note: string | null }[] }>('/api/skills/uninstall-many', { method: 'POST', body: JSON.stringify({ names, force }) }),
  installTool: (id: string) => req<{ started: true; channel: string; id: string }>('/api/tools/install', { method: 'POST', body: JSON.stringify({ id }) }),
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
  installSkill: (id: string, force = false) => req<InstallResult>('/api/skills/install', { method: 'POST', body: JSON.stringify({ id, force }) }),
  installTier: (tiers: SkillTier[]) => req<{ results: (InstallResult & { conflict?: boolean })[] }>('/api/skills/install-tier', { method: 'POST', body: JSON.stringify({ tiers }) }),
  uninstallSkill: (name: string, force = false) => req<{ ok: true; trash: TrashEntry; note: string | null }>(`/api/skills/${encodeURIComponent(name)}/uninstall`, { method: 'POST', body: JSON.stringify({ force }) }),
  restoreSkill: (name: string, trashPath?: string) => req<{ ok: true; path: string }>(`/api/skills/${encodeURIComponent(name)}/restore`, { method: 'POST', body: JSON.stringify({ trashPath }) }),
  updateSkills: (name?: string) => req<{ updated: { name: string; from: string | null; to: string | null }[]; unchanged: string[]; errors: { name: string; error: string }[] }>('/api/skills/update', { method: 'POST', body: JSON.stringify({ name }) }),
  trash: () => req<TrashEntry[]>('/api/skills/trash'),
  skillsUpdates: (refresh = false, repo?: string) => req<SkillsUpdateReport & { updating: string | null; refreshing: boolean }>(`/api/skills/updates?${new URLSearchParams({ ...(refresh ? { refresh: '1' } : {}), ...(repo ? { repo } : {}) })}`),
  updateSource: (id: string, names?: string[]) => req<{ started: true; channel: string }>(`/api/skills/sources/${encodeURIComponent(id)}/update`, { method: 'POST', body: JSON.stringify({ names }) }),
  adoptSkills: (names: string[]) => req<{ runs: SkillUpdateRun[] }>('/api/skills/adopt', { method: 'POST', body: JSON.stringify({ names }) }),
  cleanupShadows: (names: string[]) => req<{ trashed: TrashEntry[]; skipped: { name: string; reason: string }[] }>('/api/skills/cleanup-shadows', { method: 'POST', body: JSON.stringify({ names }) }),
  installBundle: (bundle: string) => req<{ results: { id: string; name: string; action: 'plugin' | 'updated' | 'adopted' | 'installed' | 'kept' | 'failed'; detail: string }[] }>('/api/skills/install-bundle', { method: 'POST', body: JSON.stringify({ bundle }) }),
  updateRuns: () => req<(EngineEvent & { seq: number })[]>('/api/skills/update-runs'),
  doctor: () => req<DoctorReport>('/api/doctor'),
  packs: () => req<PacksView>('/api/skills/packs'),
  models: () => req<{ models: ModelRecordView[]; fallbacks: string[]; current: { strong: string; cheap: string; worker: string }; sync: { at: string | null; cliVersion: string | null; found: number } | null }>('/api/models'),
  syncModels: () => req<{ found: number; newest: string[]; resolved: Record<string, string | null>; cliVersion: string | null }>('/api/models/sync', { method: 'POST' }),
  probeModel: (name: string) => req<{ ok: boolean; name: string; resolvedId: string | null; costUsd: number; error: string | null }>('/api/models/probe', { method: 'POST', body: JSON.stringify({ name }) }),
  installPack: (pack: string, option: string) => req<{ started: true; channel: string }>('/api/skills/install-pack', { method: 'POST', body: JSON.stringify({ pack, option }) }),
  settings: () => req<SettingsView>('/api/settings'),
  updateSettings: (patch: SettingsPatch) => req<SettingsView>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  resetSetting: (path: string) => req<SettingsView>(`/api/settings/${encodeURIComponent(path)}`, { method: 'DELETE' }),
  resetSettings: () => req<SettingsView>('/api/settings/reset', { method: 'POST' }),
  notifyTest: (override: { telegramBotToken?: string | null; telegramChatId?: string | null; discordWebhookUrl?: string | null }) => req<{ results: { channel: string; ok: boolean; error: string | null }[] }>('/api/notifications/test', { method: 'POST', body: JSON.stringify(override) }),
  telegramChatId: (token: string | null) => req<{ chatId: string; who: string }>('/api/notifications/telegram/chat-id', { method: 'POST', body: JSON.stringify({ token }) }),
  health: () => req<{ ok: boolean; active: number; events: number; pausedUntil: string | null; restartNeeded: string[]; version: string; updateAvailable: boolean; updating: boolean }>('/api/health'),
  updateStatus: () => req<UpdateStatusView>('/api/update'),
  updateCheck: () => req<UpdateReportView>('/api/update/check', { method: 'POST' }),
  updateApply: (force = false) => req<{ started: true; channel: string }>('/api/update/apply', { method: 'POST', body: JSON.stringify({ force }) }),
  auth: (force = false) => req<AuthInfo>(`/api/auth${force ? '?force=1' : ''}`),
  startLogin: (body: { mode?: 'claudeai' | 'console'; email?: string }) => req<LoginSession>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  loginSession: () => req<LoginSession | null>('/api/auth/login'),
  cancelLogin: () => req<{ ok: true }>('/api/auth/login/cancel', { method: 'POST' }),
  submitLoginCode: (code: string) => req<LoginSession>('/api/auth/login/code', { method: 'POST', body: JSON.stringify({ code }) }),
  logout: () => req<ClaudeAuthStatus>('/api/auth/logout', { method: 'POST' }),
  usage: () => req<Usage>('/api/usage'),
  probeUsage: () => req<Usage>('/api/usage/probe', { method: 'POST' }),
};
