/**
 * How one of Foundry's TypeScript hooks is started (ADR-0104). From a checkout the runtime is the Bun that runs Foundry:
 * `<bun> <hooks>/<name>.ts`. A compiled binary carries the hooks inside it and runs one as `<foundry> hook <name>`, since
 * nothing says a computer with the app has Bun. The shell hooks (boundary-guard.sh, canary.sh) need no runtime.
 */
import { join } from 'node:path';

export type TsHook = 'rm-guard' | 'readonly-bash' | 'codex-guard' | 'agy-guard';

/** true inside a `bun build --compile` executable: modules live in Bun's virtual file system */
export const isCompiledBinary = (): boolean => import.meta.dir.startsWith('/$bunfs') || import.meta.url.startsWith('file:///$bunfs');

export const shellQuote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'";

export function tsHookArgv(hooksDir: string, name: TsHook, args: string[] = [], opts: { compiled?: boolean; execPath?: string } = {}): string[] {
  const compiled = opts.compiled ?? isCompiledBinary();
  const exe = opts.execPath ?? process.execPath;
  return compiled ? [exe, 'hook', name, ...args] : [exe, join(hooksDir, `${name}.ts`), ...args];
}

/** the same, as one shell command line for a hooks setting */
export function tsHookCommand(hooksDir: string, name: TsHook, args: string[] = [], opts: { compiled?: boolean; execPath?: string } = {}): string {
  return tsHookArgv(hooksDir, name, args, opts).map(shellQuote).join(' ');
}
