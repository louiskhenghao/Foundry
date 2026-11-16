/**
 * Foundry's TypeScript hooks as callable entry points, for the compiled binary's `foundry hook <name>` (ADR-0101): a
 * checkout runs the files themselves with Bun. Each takes the arguments after the name and reads its event from stdin.
 */
import { run as agyGuard } from '../hooks/agy-guard.ts';
import { run as codexGuard } from '../hooks/codex-guard.ts';
import { run as readonlyBash } from '../hooks/readonly-bash.ts';
import { run as rmGuard } from '../hooks/rm-guard.ts';
import type { TsHook } from './hook-command.ts';

export const hookRuns: Record<TsHook, (args: string[]) => Promise<void>> = {
  'rm-guard': () => rmGuard(),
  'readonly-bash': () => readonlyBash(),
  'codex-guard': () => codexGuard(),
  'agy-guard': (args) => agyGuard(args),
};
