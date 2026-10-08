import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Engine } from '../engine.ts';

/** preview variables for a repository not mapped yet wait here (owner-only) until it is */
const pendingEnvFile = (dataDir: string) => join(dataDir, 'transfer', 'pending-preview-env.json');

export function holdPreviewEnv(dataDir: string, original: string, vars: Record<string, string>): void {
  const p = pendingEnvFile(dataDir);
  const doc = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, Record<string, string>>) : {};
  doc[original] = { ...vars, ...(doc[original] ?? {}) };
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(doc, null, 2), { mode: 0o600 });
}

/** hand the waiting preview variables of a repository to the checkout it was mapped to; returns the keys added */
export function releasePreviewEnv(engine: Engine, original: string, to: string): string[] {
  const p = pendingEnvFile(engine.config.dataDir);
  if (!existsSync(p)) return [];
  const doc = JSON.parse(readFileSync(p, 'utf8')) as Record<string, Record<string, string>>;
  const vars = doc[original];
  if (!vars) return [];
  const added = engine.preview.env.merge(resolve(to), vars);
  delete doc[original];
  writeFileSync(p, JSON.stringify(doc, null, 2), { mode: 0o600 });
  return added;
}
