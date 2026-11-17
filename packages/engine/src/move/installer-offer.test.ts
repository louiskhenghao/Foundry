import { expect, test } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmp } from './test-helpers.ts';

const REPO = resolve(import.meta.dir, '../../../..');

/** install.sh's migrate_source, run with a stub foundry that records how it is called and answers the dry run with `dryCode` */
function offer(o: { dryCode: number; start?: 0 | 1; yes?: 0 | 1 }): string[] {
  const dir = tmp();
  try {
    // the installer's functions without its last line (main "$@")
    const lib = readFileSync(join(REPO, 'install.sh'), 'utf8').replace(/\nmain "\$@"\s*$/, '\n');
    writeFileSync(join(dir, 'lib.sh'), lib);
    const log = join(dir, 'calls');
    writeFileSync(join(dir, 'foundry'), `#!/bin/sh\necho "$@" >> "${log}"\ncase "$*" in *--dry-run*) exit ${o.dryCode};; esac\nexit 0\n`);
    chmodSync(join(dir, 'foundry'), 0o755);
    const r = Bun.spawnSync(['bash', '-c', `source "${dir}/lib.sh"; BIN="${dir}/foundry"; YES=${o.yes ?? 1}; START=${o.start ?? 1}; DRY=0; MIGRATE_FROM=""; TTY=""; migrate_source; echo "returned $?"`], { env: { HOME: dir, PATH: process.env.PATH ?? '' } });
    expect(r.stdout.toString()).toContain('returned 0');
    try {
      return readFileSync(log, 'utf8').trim().split('\n');
    } catch {
      return [];
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the installer asks the compiled foundry what there is to move, and moves only when it found exactly one (ADR-0107)", () => {
  // one earlier Foundry with goals: the dry run, then the move (the installer writes its own record, so no adopt)
  expect(offer({ dryCode: 0 })).toEqual(['migrate --offer --dry-run', 'migrate --offer --yes --no-adopt']);
  // none, or several (the person chooses in Foundry): the dry run only
  expect(offer({ dryCode: 3 })).toEqual(['migrate --offer --dry-run']);
  expect(offer({ dryCode: 4 })).toEqual(['migrate --offer --dry-run']);
  // 2.36.0's container steps run the installer with --no-start: containers are left to them
  expect(offer({ dryCode: 0, start: 0 })).toEqual(['migrate --offer --dry-run --no-docker', 'migrate --offer --yes --no-adopt --no-docker']);
});

test("the service the installer writes runs the launch profile a move kept: the goals were made with that coding agent (ADR-0107)", () => {
  const dir = tmp();
  try {
    const lib = readFileSync(join(REPO, 'install.sh'), 'utf8').replace(/\nmain "\$@"\s*$/, '\n');
    writeFileSync(join(dir, 'lib.sh'), lib);
    const profile = (agent: string) => Bun.spawnSync(['bash', '-c', `source "${dir}/lib.sh"; AGENT=${agent}; provider`], { env: { HOME: dir, PATH: process.env.PATH ?? '' } }).stdout.toString().trim();
    expect(profile('claude')).toBe('claude');
    expect(profile('codex')).toBe('codex');
    mkdirSync(join(dir, '.foundry'), { recursive: true });
    writeFileSync(join(dir, '.foundry', 'config.json'), JSON.stringify({ dataDirs: {}, recent: [], port: 4111, provider: 'codex' }, null, 2) + '\n');
    expect(profile('claude')).toBe('codex');
    expect(profile('claude,codex')).toBe('codex');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
