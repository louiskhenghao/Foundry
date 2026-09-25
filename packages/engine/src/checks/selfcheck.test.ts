import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { playwrightInstallCommand } from './selfcheck.ts';

describe('playwrightInstallCommand', () => {
  test("runs the CLI of the playwright package the engine imports, never bunx's playwright@latest", () => {
    const [runtime, cli, ...args] = playwrightInstallCommand();
    expect(runtime).toBe(process.execPath);
    expect(args).toEqual(['install', 'chromium']);
    expect(cli).toMatch(/playwright[\\/]cli\.js$/);
    const installed = JSON.parse(readFileSync(join(dirname(cli!), 'package.json'), 'utf8')).version;
    const imported = JSON.parse(readFileSync(Bun.resolveSync('playwright/package.json', import.meta.dir), 'utf8')).version;
    expect(installed).toBe(imported);
  });
});
