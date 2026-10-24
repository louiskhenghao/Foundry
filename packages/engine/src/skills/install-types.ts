import type { SkillsPaths } from './paths.ts';
import type { CatalogSuite } from './types.ts';

export class InstallError extends Error {
  constructor(
    message: string,
    public readonly code: 'conflict' | 'manual' | 'not-found' | 'git' | 'refused',
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface InstallContext {
  paths: SkillsPaths;
  log?: (m: string) => void;
  /** for plugin sources: the backend's binary (claude, or codex for paths.provider codex) and a streaming spawner (tests inject both) */
  claudeBin?: string;
  codexBin?: string;
  spawn?: (argv: string[], cwd: string, onLine: (l: string) => void, opts?: { timeoutMs?: number; env?: Record<string, string> }) => Promise<{ code: number | null; tail: string }>;
  onLine?: (l: string) => void;
  /** what the engine gives every session: a warm-up runs with its switches (CADGEN_*), never with its keys */
  env?: Record<string, string>;
  /** the catalog's workflow suites: a `suite` source installs the whole suite (ADR-0049) */
  suites?: CatalogSuite[];
  /** the folder of catalog/skills.json: a `bundled` source is copied from under it (ADR-0076) */
  catalogDir?: string;
}
