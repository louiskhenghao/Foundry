import { z } from 'zod';
import { GoalState } from './goal.ts';
import { SECRET_SETTINGS, SettingsPatch } from './settings.ts';

/**
 * The Transfer file (ADR-0030): one gzipped tar holding a manifest, the categories the person ticked and, per goal, its
 * events and the files that belong to it. Its format only moves forward: a newer Foundry reads every older version,
 * an older one refuses a newer file.
 */
export const TRANSFER_FORMAT = 'foundry-transfer';
export const TRANSFER_FORMAT_VERSION = 1;

export const TransferCategory = z.enum(['settings', 'secrets', 'goals', 'transcripts']);
export type TransferCategory = z.infer<typeof TransferCategory>;

export const TransferGoalEntry = z.object({
  id: z.string(),
  title: z.string(),
  state: GoalState,
  provider: z.enum(['claude', 'codex']).nullable().default(null),
  createdAt: z.string(),
  costUsd: z.number().default(0),
  /** the repository as the other computer knew it, and where its remote points (to find the same checkout here) */
  repoPath: z.string(),
  remoteUrl: z.string().nullable().default(null),
  baseBranch: z.string(),
  branch: z.string(),
  /** not finished when it was exported: it can be Reattached */
  unfinished: z.boolean(),
  /** the goal it follows, when that one is a goal of its own */
  follows: z.object({ goalId: z.string(), title: z.string() }).nullable().default(null),
  events: z.number().int().nonnegative(),
  /** the file carries its branch (commits the base branch lacks) as a git bundle */
  bundle: z.boolean().default(false),
  /** the file carries its progress folder's git-excluded files (media artifacts, style samples) */
  artifacts: z.boolean().default(false),
});
export type TransferGoalEntry = z.infer<typeof TransferGoalEntry>;

export const TransferManifest = z.object({
  format: z.literal(TRANSFER_FORMAT),
  formatVersion: z.number().int().positive(),
  /** the Release that wrote the file */
  release: z.string(),
  transferId: z.string(),
  exportedAt: z.string(),
  source: z.object({ hostname: z.string(), platform: z.string(), provider: z.enum(['claude', 'codex']), dataDir: z.string() }),
  categories: z.record(TransferCategory, z.boolean()).default({}),
  goals: z.array(TransferGoalEntry).default([]),
});
export type TransferManifest = z.infer<typeof TransferManifest>;

/** Keys & secrets, sealed with the person's password: scrypt derives the key, AES-256-GCM seals the JSON */
export const SealedSecrets = z.object({
  kdf: z.literal('scrypt'),
  N: z.number().int().positive(),
  r: z.number().int().positive(),
  p: z.number().int().positive(),
  salt: z.string(),
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
});
export type SealedSecrets = z.infer<typeof SealedSecrets>;

/** What a sealed secrets file holds once opened: credential settings, and preview variables per repository path */
export const TransferSecrets = z.object({
  settings: z.record(z.string(), z.string()).default({}),
  previewEnv: z.record(z.string(), z.record(z.string(), z.string())).default({}),
});
export type TransferSecrets = z.infer<typeof TransferSecrets>;

/**
 * Settings that only make sense on one computer and are never transferred: where the engine listens, where its programs
 * and Progress folders live (the whole engine section), which folders it may touch, which ports its Previews use, the
 * addresses in Notification links.
 */
export const LOCAL_SETTING_SECTIONS = ['engine'] as const;
export const LOCAL_SETTINGS = ['notifications.baseUrl', 'notifications.tailscaleHost', 'tools.markitdownBin', 'safety.allowedRoots', 'preview.portFrom', 'preview.portTo'] as const;

export const isLocalSetting = (path: string) => (LOCAL_SETTING_SECTIONS as readonly string[]).includes(path.split('.')[0]!) || (LOCAL_SETTINGS as readonly string[]).includes(path);
export const isSecretSetting = (path: string) => (SECRET_SETTINGS as readonly string[]).includes(path);

/** The leaves of a settings file a Transfer carries as "Settings": neither local to one computer nor a credential */
export function transferableSettings(file: SettingsPatch): SettingsPatch {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [section, leaves] of Object.entries(file)) {
    for (const [key, value] of Object.entries(leaves ?? {})) {
      const path = `${section}.${key}`;
      if (value === undefined || isLocalSetting(path) || isSecretSetting(path)) continue;
      (out[section] ??= {})[key] = value;
    }
  }
  return SettingsPatch.parse(out);
}

/** The credential leaves of a settings file that hold a value */
export function secretSettings(file: SettingsPatch): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of SECRET_SETTINGS) {
    const [section, key] = path.split('.') as [keyof SettingsPatch, string];
    const v = (file[section] as Record<string, unknown> | undefined)?.[key];
    if (typeof v === 'string' && v !== '') out[path] = v;
  }
  return out;
}
