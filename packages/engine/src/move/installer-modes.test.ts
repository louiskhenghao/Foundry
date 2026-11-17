import { expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmp } from './test-helpers.ts';

const REPO = resolve(import.meta.dir, '../../../..');

/** install.sh run in a home of its own, against a release list in a folder (no network) */
function installer(home: string, args: string[], env: Record<string, string> = {}) {
  const r = Bun.spawnSync(['bash', join(REPO, 'install.sh'), ...args], {
    env: { HOME: home, PATH: process.env.PATH ?? '', SHELL: '/bin/bash', FOUNDRY_RELEASES_API: `file://${join(home, 'api')}`, ...env },
    stdin: 'ignore',
  });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

test('3.0 installs only the app or the binary: a source or Docker mode is refused with the command that installs 3.0 (ADR-0108)', () => {
  const home = tmp();
  try {
    for (const run of [
      installer(home, ['--mode', 'source', '--yes', '--dry-run']),
      // `foundry update` in a 2.x install older than 2.36 runs the newest installer with its own mode
      installer(home, ['install', '--yes'], { FOUNDRY_MODE: 'docker' }),
    ]) {
      expect(run.code).toBe(1);
      expect(run.out).toContain('only as the app (macOS) or the binary (Linux) since 3.0');
      expect(run.out).toContain('install.sh | bash');
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('an install recorded by a 2.x source installer is not reinstalled: the binary is, and the move is offered (ADR-0108)', () => {
  const home = tmp();
  try {
    mkdirSync(join(home, '.config', 'foundry'), { recursive: true });
    writeFileSync(join(home, '.config', 'foundry', 'install.env'), 'MODE=source\nAGENT=claude\nDIR=/x/foundry\nREPOS=/x/Projects\nPORT=4111\nSERVICE=launchd\n');
    mkdirSync(join(home, 'api'), { recursive: true });
    writeFileSync(join(home, 'api', 'latest'), JSON.stringify({ tag_name: 'v3.0.0', assets: [] }));
    const run = installer(home, ['--mode', 'binary', '--yes', '--dry-run']);
    expect(run.code).toBe(0);
    expect(run.out).toContain('foundry 3.0.0');
    expect(run.out).toContain('move the goals of an earlier Foundry on this computer');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
