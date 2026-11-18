import { expect, test } from 'bun:test';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { INSTALLER_COMMAND_MARK } from '../cli-link.ts';
import { parseInstallEnv } from '../migrate.ts';
import { adoptInstall } from './adopt.ts';
import { localProbe } from './probe.ts';
import { tmp } from './test-helpers.ts';

const REPO = resolve(import.meta.dir, '../../../..');

test('after a move the installer record and the foundry command name the app the goals are in (ADR-0107)', async () => {
  const home = tmp();
  try {
    // an earlier source install's record
    mkdirSync(join(home, '.config', 'foundry'), { recursive: true });
    writeFileSync(join(home, '.config', 'foundry', 'install.env'), 'MODE=source\nAGENT=claude\nDIR=/x/foundry\nREPOS=/x/Projects\nPORT=4111\n');
    // the app: its engine, and the release's install.sh in its Resources
    const app = join(home, 'Applications', 'Foundry.app');
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
    mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true });
    copyFileSync(join(REPO, 'install.sh'), join(app, 'Contents', 'Resources', 'install.sh'));
    const engine = join(app, 'Contents', 'MacOS', 'foundry-engine');
    writeFileSync(engine, '#!/bin/sh\necho "foundry 9.9.9"\n');
    chmodSync(engine, 0o755);
    const probe = localProbe({ HOME: home, PATH: process.env.PATH });
    const said: string[] = [];
    expect(await adoptInstall({ root: join(app, 'Contents', 'Resources'), kind: 'app', execPath: engine, log: (m) => said.push(m), probe })).toBe(true);
    expect(parseInstallEnv(readFileSync(join(home, '.config', 'foundry', 'install.env'), 'utf8'))).toMatchObject({ MODE: 'app', APP: app, SERVICE: 'app', AGENT: 'claude', PORT: '4111', REPOS: '/x/Projects' });
    const command = readFileSync(join(home, '.local', 'bin', 'foundry'), 'utf8');
    expect(command).toContain(INSTALLER_COMMAND_MARK);
    expect(command).toContain(`exec "${engine}" "$@"`);
    // the installer's own copy is the release's
    expect(readFileSync(join(home, '.local', 'share', 'foundry', 'install.sh'), 'utf8')).toBe(readFileSync(join(REPO, 'install.sh'), 'utf8'));
    // the record names the app now: a second move leaves it alone
    expect(await adoptInstall({ root: join(app, 'Contents', 'Resources'), kind: 'app', execPath: engine, log: () => {}, probe })).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
