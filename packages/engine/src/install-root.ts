/**
 * Where this Foundry's own files are (ADR-0101): the roles, the catalog, the templates, the hooks, the guide, the built UI,
 * the root package.json that carries the version.
 *
 * A git checkout runs from its own tree (`bun apps/cli/src/main.ts serve`). A compiled binary (`bun build --compile`) has no
 * tree: `import.meta.dir` points into the executable's virtual file system (`/$bunfs/...`), so its files travel beside it in
 * a release layout that keeps the checkout's own relative paths:
 *   - a tarball: `<dir>/foundry` with `<dir>/resources/` beside it (Linux, and macOS without the app)
 *   - the macOS app: `Foundry.app/Contents/MacOS/foundry` with `Foundry.app/Contents/Resources/`
 * so everything that resolves `roles/`, `catalog/skills.json`, `apps/web/dist`… from the root is unchanged. FOUNDRY_ROOT
 * names the folder outright, for a layout of one's own.
 */
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export type InstallKind = 'checkout' | 'app' | 'binary';

export interface InstallRoot {
  kind: InstallKind;
  /** the folder the engine's rootDir points at */
  root: string;
  /** the folder of the executable, when compiled; null in a checkout */
  execDir: string | null;
}

/** true inside a `bun build --compile` executable: modules live in Bun's virtual file system */
export function isCompiledBinary(): boolean {
  return import.meta.dir.startsWith('/$bunfs') || import.meta.url.startsWith('file:///$bunfs');
}

export interface DetectOptions {
  env?: NodeJS.ProcessEnv;
  compiled?: boolean;
  execPath?: string;
  exists?: (p: string) => boolean;
  realpath?: (p: string) => string;
  /** the checkout root a non-compiled run uses */
  checkoutRoot?: string;
}

const CHECKOUT_ROOT = resolve(import.meta.dir, '../../..');
/** the file every layout carries at its root */
const MARKER = 'package.json';

export function detectInstallRoot(opts: DetectOptions = {}): InstallRoot {
  const env = opts.env ?? process.env;
  const compiled = opts.compiled ?? isCompiledBinary();
  const exists = opts.exists ?? existsSync;
  const realpath = opts.realpath ?? ((p: string) => { try { return realpathSync(p); } catch { return p; } });
  const execDir = compiled ? dirname(realpath(opts.execPath ?? process.execPath)) : null;
  const inBundle = !!execDir && basename(execDir) === 'MacOS' && basename(dirname(execDir)) === 'Contents';
  if (env.FOUNDRY_ROOT) return { kind: compiled ? (inBundle ? 'app' : 'binary') : 'checkout', root: resolve(env.FOUNDRY_ROOT), execDir };
  if (!compiled) return { kind: 'checkout', root: opts.checkoutRoot ?? CHECKOUT_ROOT, execDir: null };
  const candidate: InstallRoot = inBundle ? { kind: 'app', root: join(dirname(execDir!), 'Resources'), execDir } : { kind: 'binary', root: join(execDir!, 'resources'), execDir };
  if (exists(join(candidate.root, MARKER))) return candidate;
  throw new Error(`foundry cannot find its files: expected ${candidate.root} beside the executable (set FOUNDRY_ROOT to name the folder)`);
}

let cached: InstallRoot | null = null;
/** the install this process runs from, detected once */
export function installRoot(): InstallRoot {
  return (cached ??= detectInstallRoot());
}
