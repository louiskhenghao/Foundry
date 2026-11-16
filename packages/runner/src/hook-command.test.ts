import { describe, expect, test } from 'bun:test';
import { isCompiledBinary, tsHookArgv, tsHookCommand } from './hook-command.ts';

describe('how a TypeScript hook is started (ADR-0101)', () => {
  test('a checkout runs the hook file with the Bun that runs Foundry', () => {
    expect(isCompiledBinary()).toBe(false);
    expect(tsHookArgv('/src/hooks', 'rm-guard')).toEqual([process.execPath, '/src/hooks/rm-guard.ts']);
    expect(tsHookArgv('/src/hooks', 'agy-guard', ['/tmp/policy.json'], { compiled: false, execPath: '/usr/bin/bun' })).toEqual(['/usr/bin/bun', '/src/hooks/agy-guard.ts', '/tmp/policy.json']);
  });

  test('a compiled binary runs the hook it carries', () => {
    expect(tsHookArgv('/unused', 'codex-guard', [], { compiled: true, execPath: '/Applications/Foundry.app/Contents/MacOS/foundry' })).toEqual(['/Applications/Foundry.app/Contents/MacOS/foundry', 'hook', 'codex-guard']);
  });

  test('the command line quotes every part for a shell', () => {
    expect(tsHookCommand("/Users/o'neil/hooks", 'readonly-bash', [], { compiled: false, execPath: '/usr/local/bin/bun' })).toBe("'/usr/local/bin/bun' '/Users/o'\\''neil/hooks/readonly-bash.ts'");
  });
});
