import { describe, expect, test } from 'bun:test';
import { judge } from '../hooks/rm-guard.ts';

const CWD = '/Users/u/foundry/data/worktrees/g_1/_goal';

describe('rm-guard judge', () => {
  // the real denied commands from a live worker transcript, minimised
  test('allows rm on workspace paths behind a simple VAR assignment', () => {
    expect(judge(`ROOT=${CWD}/apps/demo-game; rm -rf "$ROOT/.git" "$ROOT/.claude"; ls -a "$ROOT"`, CWD).allow).toBe(true);
    expect(judge(`set -e\nROOT=${CWD}\nmkdir -p "$ROOT/apps"\nrm -rf /tmp/demo-game-tpl`, CWD).allow).toBe(true);
  });
  test('allows relative rm inside the workspace', () => {
    expect(judge('rm -rf node_modules dist', CWD).allow).toBe(true);
  });
  test('allows rm under temp dirs', () => {
    expect(judge('rm -rf /tmp/scratch-1 /private/tmp/x', CWD).allow).toBe(true);
  });

  test('stays silent for paths outside the workspace', () => {
    expect(judge('rm -rf /Users/u/Documents/stuff', CWD).allow).toBe(false);
  });
  test('stays silent for anything that could escape: $HOME, .., ~, cd, sudo, command substitution', () => {
    expect(judge('rm -rf $HOME/x', CWD).allow).toBe(false);
    expect(judge('rm -rf ../sibling', CWD).allow).toBe(false);
    expect(judge('rm -rf ~/x', CWD).allow).toBe(false);
    expect(judge('cd / && rm -rf tmp', CWD).allow).toBe(false);
    expect(judge('sudo rm -rf /tmp/x', CWD).allow).toBe(false);
    expect(judge('rm -rf "$(pwd)/x"', CWD).allow).toBe(false);
    expect(judge('rm -rf `pwd`/x', CWD).allow).toBe(false);
  });
  test('stays silent for non-rm commands', () => {
    expect(judge('git status', CWD).allow).toBe(false);
    expect(judge('echo done', CWD).allow).toBe(false);
  });
  test('a workspace-prefix lookalike does not pass', () => {
    expect(judge(`rm -rf ${CWD}-evil/x`, CWD).allow).toBe(false);
  });
});
