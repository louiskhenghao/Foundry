/**
 * Browser-safe types for the skills manager (zod only, no node imports).
 * Exported as `@ai-engine/engine/skills-types`.
 */
import { z } from 'zod';

export const SkillTier = z.enum(['required', 'recommended', 'optional']);
export type SkillTier = z.infer<typeof SkillTier>;

export const SkillRole = z.enum(['clarifier', 'planner', 'worker', 'reviewer-task', 'reviewer-goal', 'merger']);
export type SkillRole = z.infer<typeof SkillRole>;

export const CatalogSource = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('git'),
    /** owner/name on GitHub */
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    /** clone URL override (tests use file://) */
    url: z.string().optional(),
    ref: z.string().optional(),
    /** path of the skill dir inside the repo; when missing we search **\/<name>/SKILL.md */
    path: z.string().optional(),
  }),
  z.object({
    type: z.literal('cli'),
    /** binary name to look for on PATH */
    detect: z.string(),
    /** copy-paste install command (we never run it ourselves) */
    install: z.string(),
    docs: z.string().url().optional(),
  }),
  z.object({
    type: z.literal('manual'),
    install: z.string(),
    docs: z.string().url().optional(),
    /** directory under ~/.claude/skills whose presence means "installed" */
    detectDir: z.string(),
  }),
  z.object({
    type: z.literal('plugin'),
    /** marketplace repo on GitHub (owner/name) */
    marketplace: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    /** marketplace name as registered in Claude Code (the part after @) */
    marketplaceId: z.string().min(1),
    /** plugin name inside that marketplace */
    plugin: z.string().min(1),
    docs: z.string().url().optional(),
  }),
]);
export type CatalogSource = z.infer<typeof CatalogSource>;

export const TaskKindForSkill = z.enum(['feature', 'bug', 'refactor', 'research', 'chore', 'any']);
export const SkillScenario = z.enum(['frontend', 'backend', 'fullstack', 'data', 'mobile', 'infra', 'docs', 'general']);
export type SkillScenario = z.infer<typeof SkillScenario>;

/** How a role must/should use a skill inside the engine's own workflow (see ADR-0004). */
export const WorkflowRule = z.object({
  role: SkillRole,
  mandate: z.enum(['must', 'prefer']),
  /** task kind this applies to (worker only); default any */
  when: TaskKindForSkill.default('any'),
  /** task scenarios this applies to; empty = any */
  scenarios: z.array(SkillScenario).default([]),
  /** one or two sentences shown to the session */
  instruction: z.string().min(1),
});
export type WorkflowRule = z.infer<typeof WorkflowRule>;

export const CatalogEntry = z.object({
  id: z.string().min(1),
  /** skill directory name (what Claude Code sees) */
  name: z.string().min(1),
  summary: z.string(),
  why: z.string(),
  tier: SkillTier,
  source: CatalogSource,
  roles: z.array(SkillRole).default([]),
  /** slash name; defaults to `/${name}` */
  invoke: z.string().optional(),
  tags: z.array(z.string()).default([]),
  homepage: z.string().url().optional(),
  /** former directory names upstream (e.g. diagnose → diagnosing-bugs) so old copies can be matched */
  aliases: z.array(z.string()).default([]),
  /** install/adopt group shown on the Setup page (e.g. "mattpocock") */
  bundle: z.string().optional(),
  /**
   * Mutually exclusive pack this entry belongs to (e.g. "design"): only the pack chosen in Settings takes
   * part in prompts; the others stay invisible to sessions even when installed.
   */
  pack: z.string().optional(),
  /** the option value (Settings) that selects this entry's pack member, e.g. "impeccable" */
  packOption: z.string().optional(),
  /** scenarios this entry is relevant to (filters the "other installed skills" tail); empty = any */
  scenarios: z.array(SkillScenario).default([]),
  workflow: z.array(WorkflowRule).default([]),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;

export const Catalog = z.object({ version: z.literal(1), entries: z.array(CatalogEntry) });
export type Catalog = z.infer<typeof Catalog>;

export const AiEngineMarker = z.object({
  catalogId: z.string(),
  repo: z.string(),
  url: z.string().optional(),
  ref: z.string().nullable(),
  commit: z.string().nullable(),
  path: z.string(),
  installedAt: z.string(),
  updatedAt: z.string().optional(),
});
export type AiEngineMarker = z.infer<typeof AiEngineMarker>;

export const SkillScope = z.enum(['user', 'plugin', 'project']);
export type SkillScope = z.infer<typeof SkillScope>;

export const ManagedBy = z.enum(['ai-engine', 'agents-cli', 'symlink', 'gstack', 'gstack-copy', 'manifest', 'plugin', 'project']);
export type ManagedBy = z.infer<typeof ManagedBy>;

/** One record of ~/.agents/.skill-lock.json (written by the community `skills` CLI). */
export const AgentsLockRecord = z.object({
  source: z.string().nullable(),
  sourceType: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  skillPath: z.string().nullable(),
  skillFolderHash: z.string().nullable(),
  installedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type AgentsLockRecord = z.infer<typeof AgentsLockRecord>;

export const PluginMeta = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string().nullable(),
  installPath: z.string(),
  /** marketplace name (the part after @) and what we know about it */
  marketplace: z.string().nullable().default(null),
  marketplaceRepo: z.string().nullable().default(null),
  marketplaceClone: z.string().nullable().default(null),
  gitCommitSha: z.string().nullable().default(null),
  installedAt: z.string().nullable().default(null),
  lastUpdated: z.string().nullable().default(null),
  /** skill dir relative to the plugin install root (== path inside the source repo) */
  skillPath: z.string().nullable().default(null),
});
export type PluginMeta = z.infer<typeof PluginMeta>;

export const InstalledSkill = z.object({
  name: z.string(),
  scope: SkillScope,
  /** `/name` or `/plugin:name` */
  invoke: z.string(),
  dir: z.string(),
  skillMd: z.string().nullable(),
  description: z.string(),
  version: z.string().nullable(),
  managedBy: ManagedBy.nullable(),
  marker: AiEngineMarker.nullable(),
  plugin: PluginMeta.nullable(),
  lock: AgentsLockRecord.nullable().default(null),
  symlink: z.object({ target: z.string(), broken: z.boolean() }).nullable(),
  manifest: z.object({ name: z.string().nullable(), version: z.string().nullable(), homepage: z.string().nullable() }).nullable(),
  /** invokes of other skills with the same name */
  duplicateOf: z.array(z.string()),
  canUninstall: z.boolean(),
  uninstallNote: z.string().nullable(),
  hint: z.string().nullable(),
  unparsable: z.boolean(),
});
export type InstalledSkill = z.infer<typeof InstalledSkill>;

export const CatalogStatusKind = z.enum(['installed', 'installed-unmanaged', 'installed-via-plugin', 'partial', 'missing']);
export type CatalogStatusKind = z.infer<typeof CatalogStatusKind>;

export const CatalogEntryStatus = z.object({
  entry: CatalogEntry,
  status: CatalogStatusKind,
  /** invoke name to use in prompts (user dir preferred over plugin) */
  installedInvoke: z.string().nullable(),
  commit: z.string().nullable(),
  detail: z.string(),
  /** for cli/manual: the command the human must run */
  manual: z.object({ command: z.string(), docs: z.string().nullable() }).nullable(),
});
export type CatalogEntryStatus = z.infer<typeof CatalogEntryStatus>;

export const ScanResult = z.object({
  installed: z.array(InstalledSkill),
  duplicates: z.array(z.string()),
  scannedAt: z.string(),
  skillsDir: z.string(),
});
export type ScanResult = z.infer<typeof ScanResult>;

export const DoctorCheck = z.object({
  id: z.string(),
  label: z.string(),
  ok: z.boolean(),
  severity: z.enum(['error', 'warn']),
  detail: z.string(),
  fix: z.object({ command: z.string().optional(), url: z.string().optional(), installId: z.string().optional(), action: z.enum(['trash-shadows', 'check-updates', 'install-markitdown', 'install-tool', 'install-pack', 'test-models']).optional(), names: z.array(z.string()).optional() }).nullable(),
});
export type DoctorCheck = z.infer<typeof DoctorCheck>;

export const DoctorReport = z.object({ ok: z.boolean(), at: z.string(), checks: z.array(DoctorCheck) });
export type DoctorReport = z.infer<typeof DoctorReport>;

export const TrashEntry = z.object({ name: z.string(), trashedAt: z.string(), path: z.string(), reason: z.string(), wasSymlink: z.boolean(), symlinkTarget: z.string().nullable() });
export type TrashEntry = z.infer<typeof TrashEntry>;

export const InstallResult = z.object({
  ok: z.boolean(),
  id: z.string(),
  name: z.string(),
  path: z.string().nullable(),
  commit: z.string().nullable(),
  /** set for cli/manual entries: nothing was installed, the human must run this */
  manual: z.object({ command: z.string(), docs: z.string().nullable() }).nullable(),
  error: z.string().nullable(),
});
export type InstallResult = z.infer<typeof InstallResult>;

export const SessionView = z.object({ at: z.string(), sessionId: z.string().nullable(), skills: z.array(z.string()), slashCommands: z.array(z.string()) });
export type SessionView = z.infer<typeof SessionView>;

// ---------- sources & updates ----------

export const SkillSourceKind = z.enum(['github', 'plugin', 'gstack', 'project', 'local', 'unknown']);
export type SkillSourceKind = z.infer<typeof SkillSourceKind>;
/** who installed / who updates */
export const SkillManager = z.enum(['ai-engine', 'agents-cli', 'plugin', 'gstack', 'hand', 'project']);
export type SkillManager = z.infer<typeof SkillManager>;
export const UpdaterKind = z.enum(['ai-engine', 'agents-cli', 'plugin', 'adopt', 'hint', 'none']);
export type UpdaterKind = z.infer<typeof UpdaterKind>;
export const SkillRowStatus = z.enum(['up-to-date', 'outdated', 'modified', 'unknown', 'broken']);
export type SkillRowStatus = z.infer<typeof SkillRowStatus>;

export const SkillSourceRow = z.object({
  name: z.string(),
  invoke: z.string(),
  description: z.string(),
  dir: z.string(),
  scope: SkillScope,
  managedBy: ManagedBy.nullable(),
  status: SkillRowStatus,
  local: z.object({ commit: z.string().nullable(), installedAt: z.string().nullable(), updatedAt: z.string().nullable(), version: z.string().nullable() }),
  /** path of this skill inside the source repo (null when unknown) */
  pathInRepo: z.string().nullable(),
  /** last upstream change of that path */
  upstream: z.object({ commit: z.string(), committedAt: z.string(), exact: z.boolean() }).nullable(),
  /** hand-installed copy matched to this source */
  match: z.object({ relation: z.enum(['identical', 'older', 'differs']), olderCommit: z.string().nullable(), olderAt: z.string().nullable() }).nullable(),
  /** invoke of the plugin skill with the same bare name that this user-level row hides */
  shadowedBy: z.string().nullable(),
  duplicateOf: z.array(z.string()),
  catalogId: z.string().nullable(),
  actions: z.array(z.enum(['update', 'adopt', 'uninstall', 'trash-shadow'])),
});
export type SkillSourceRow = z.infer<typeof SkillSourceRow>;

export const SkillSource = z.object({
  /** 'github:owner/name' | 'plugin:<id>' | 'gstack' | 'project:<repo>' | 'local' | 'unknown' */
  id: z.string(),
  kind: SkillSourceKind,
  label: z.string(),
  manager: SkillManager,
  repo: z.string().nullable(),
  homepage: z.string().nullable(),
  local: z.object({ commit: z.string().nullable(), version: z.string().nullable(), installedAt: z.string().nullable(), updatedAt: z.string().nullable() }),
  upstream: z.object({ commit: z.string(), committedAt: z.string(), checkedAt: z.string() }).nullable(),
  /** null = could not determine */
  updateAvailable: z.boolean().nullable(),
  updater: z.object({ kind: UpdaterKind, command: z.array(z.string()).nullable(), hint: z.string().nullable() }),
  error: z.string().nullable(),
  skills: z.array(SkillSourceRow),
});
export type SkillSource = z.infer<typeof SkillSource>;

export const SkillsUpdateReport = z.object({
  checkedAt: z.string(),
  /** true when served from a cache older than the TTL (a refresh is running or advisable) */
  stale: z.boolean(),
  sources: z.array(SkillSource),
  /** user-level names that hide a newer plugin skill */
  shadowed: z.array(z.string()),
});
export type SkillsUpdateReport = z.infer<typeof SkillsUpdateReport>;

/** One executed updater run (also the payload of the `skills.update_run` event). */
export const SkillUpdateRun = z.object({
  sourceId: z.string(),
  updater: UpdaterKind,
  command: z.array(z.string()),
  cwd: z.string(),
  exitCode: z.number().nullable(),
  durationMs: z.number(),
  outputTail: z.string(),
  changed: z.array(z.object({ name: z.string(), from: z.string().nullable(), to: z.string().nullable() })),
  error: z.string().nullable(),
  at: z.string(),
});
export type SkillUpdateRun = z.infer<typeof SkillUpdateRun>;

export const SkillsOverview = z.object({
  installed: z.array(InstalledSkill),
  catalog: z.array(CatalogEntryStatus),
  duplicates: z.array(z.string()),
  lastSession: SessionView.nullable(),
  scannedAt: z.string(),
  skillsDir: z.string(),
});
export type SkillsOverview = z.infer<typeof SkillsOverview>;
