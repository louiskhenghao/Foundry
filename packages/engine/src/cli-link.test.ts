import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INSTALLER_COMMAND_MARK, cliLinkState, linkCli, pathHint, refreshKeptInstaller } from './cli-link.ts';

describe('foundry in a terminal (ADR-0105)', () => {
  test('links ~/.local/bin/foundry to the binary, replaces an old link, leaves the installer and strangers alone', () => {
    const home = mkdtempSync(join(tmpdir(), 'foundry-link-'));
    try {
      const bin = join(home, 'Foundry.app', 'Contents', 'MacOS', 'foundry-engine');
      mkdirSync(join(home, 'Foundry.app', 'Contents', 'MacOS'), { recursive: true });
      writeFileSync(bin, '#!/bin/sh\n');
      const dir = join(home, '.local', 'bin');
      const link = join(dir, 'foundry');
      expect(cliLinkState({ target: bin, home, path: '/usr/bin' })).toMatchObject({ state: 'missing', onPath: false });
      const made = linkCli({ target: bin, home, path: `${dir}:/usr/bin` });
      expect(made).toMatchObject({ state: 'linked', changed: true, onPath: true });
      expect(realpathSync(readlinkSync(link))).toBe(realpathSync(bin));
      expect(linkCli({ target: bin, home }).changed).toBe(false);
      // an app moved since: the old link is replaced
      rmSync(link);
      symlinkSync(join(home, 'old', 'foundry-engine'), link);
      expect(cliLinkState({ target: bin, home }).state).toBe('elsewhere');
      expect(linkCli({ target: bin, home })).toMatchObject({ state: 'linked', changed: true });
      // the installer's command forwards to the binary itself
      rmSync(link);
      writeFileSync(link, `#!/usr/bin/env bash\n# ${INSTALLER_COMMAND_MARK}: foundry start | stop\n`);
      expect(linkCli({ target: bin, home })).toMatchObject({ state: 'installer', changed: false });
      // someone else's file
      writeFileSync(link, '#!/bin/sh\necho mine\n');
      expect(() => linkCli({ target: bin, home })).toThrow(/did not write/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('the PATH line for each shell', () => {
    expect(pathHint('/bin/zsh')).toEqual({ file: '~/.zshrc', line: 'export PATH="$HOME/.local/bin:$PATH"' });
    expect(pathHint('/opt/homebrew/bin/fish').line).toBe('fish_add_path ~/.local/bin');
  });
});

describe("the installer's foundry command follows the release", () => {
  const setup = (mode: string) => {
    const home = mkdtempSync(join(tmpdir(), 'foundry-kept-'));
    const root = join(home, 'Foundry.app', 'Contents', 'Resources');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'install.sh'), '# the release installer\n');
    mkdirSync(join(home, '.local', 'share', 'foundry'), { recursive: true });
    writeFileSync(join(home, '.local', 'share', 'foundry', 'install.sh'), '# an older installer\n');
    mkdirSync(join(home, '.config', 'foundry'), { recursive: true });
    writeFileSync(join(home, '.config', 'foundry', 'install.env'), `# written by the Foundry installer; \`foundry\` reads it\nMODE=${mode}\nAGENT=claude\n`);
    return { home, root, kept: join(home, '.local', 'share', 'foundry', 'install.sh') };
  };

  test('an app or binary start puts its own install.sh where the command runs it, once', () => {
    const { home, root, kept } = setup('app');
    try {
      expect(refreshKeptInstaller({ root, kind: 'app', home, env: {} })).toBe('updated');
      expect(readFileSync(kept, 'utf8')).toBe('# the release installer\n');
      expect(refreshKeptInstaller({ root, kind: 'app', home, env: {} })).toBe('same');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("another install's copy (a source install, the binary beside the app) and a missing one are left alone", () => {
    const { home, root, kept } = setup('source');
    try {
      expect(refreshKeptInstaller({ root, kind: 'app', home, env: {} })).toBe('skipped');
      writeFileSync(join(home, '.config', 'foundry', 'install.env'), 'MODE=binary\n');
      expect(refreshKeptInstaller({ root, kind: 'app', home, env: {} })).toBe('skipped');
      expect(readFileSync(kept, 'utf8')).toBe('# an older installer\n');
      rmSync(kept);
      writeFileSync(join(home, '.config', 'foundry', 'install.env'), 'MODE=app\n');
      expect(refreshKeptInstaller({ root, kind: 'app', home, env: {} })).toBe('skipped');
      expect(existsSync(kept)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('the folders the installer chose through XDG_DATA_HOME and XDG_CONFIG_HOME', () => {
    const { home, root } = setup('binary');
    try {
      const data = join(home, 'xdg-data');
      const config = join(home, 'xdg-config');
      mkdirSync(join(data, 'foundry'), { recursive: true });
      mkdirSync(join(config, 'foundry'), { recursive: true });
      writeFileSync(join(data, 'foundry', 'install.sh'), '# old\n');
      writeFileSync(join(config, 'foundry', 'install.env'), "MODE='binary'\n");
      expect(refreshKeptInstaller({ root, kind: 'binary', home, env: { XDG_DATA_HOME: data, XDG_CONFIG_HOME: config } })).toBe('updated');
      expect(readFileSync(join(data, 'foundry', 'install.sh'), 'utf8')).toBe('# the release installer\n');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
