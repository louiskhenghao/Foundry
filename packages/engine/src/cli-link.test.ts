import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INSTALLER_COMMAND_MARK, cliLinkState, linkCli, pathHint } from './cli-link.ts';

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
