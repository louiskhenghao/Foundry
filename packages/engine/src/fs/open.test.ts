import { describe, expect, test } from 'bun:test';
import { OpenError, detectOpenTargets, openPath } from './open.ts';

const mac = {
  platform: 'darwin',
  home: '/Users/me',
  which: (b: string) => (b === 'code' ? '/usr/local/bin/code' : null),
  exists: (p: string) => ['/Applications/Visual Studio Code.app', '/Applications/Cursor.app', '/Applications/iTerm.app', '/System/Applications/Utilities/Terminal.app', '/repo'].includes(p),
};

describe('open targets', () => {
  test('macOS: CLI preferred for editors, app bundles otherwise, Finder always', () => {
    const t = Object.fromEntries(detectOpenTargets(mac).map((x) => [x.id, x]));
    expect(t.vscode).toMatchObject({ available: true, via: '/usr/local/bin/code' });
    expect(t.cursor).toMatchObject({ available: true, via: 'open -a /Applications/Cursor.app' });
    expect(t.zed!.available).toBe(false);
    expect(t.finder!.available).toBe(true);
    expect(t.iterm!.available).toBe(true);
    expect(t.terminal!.available).toBe(true);
  });
  test('linux: xdg-open as file manager, terminals via --working-directory', () => {
    const t = Object.fromEntries(detectOpenTargets({ platform: 'linux', which: (b) => (['xdg-open', 'gnome-terminal'].includes(b) ? `/usr/bin/${b}` : null), exists: () => false }).map((x) => [x.id, x]));
    expect(t.finder).toMatchObject({ available: true, label: 'File manager' });
    expect(t.terminal!.available).toBe(true);
    expect(t.vscode!.available).toBe(false);
  });
  test('openPath builds argv, refuses unavailable targets and non-directories', async () => {
    const calls: string[][] = [];
    const exec = async (argv: string[]) => (calls.push(argv), { code: 0, stdout: '', stderr: '' });
    const deps = { ...mac, exec };
    expect((await openPath('vscode', '/repo', deps)).command).toEqual(['/usr/local/bin/code', '/repo']);
    expect((await openPath('cursor', '/repo', deps)).command).toEqual(['open', '-a', '/Applications/Cursor.app', '/repo']);
    expect((await openPath('finder', '/repo', deps)).command).toEqual(['open', '/repo']);
    await expect(openPath('zed', '/repo', deps)).rejects.toThrow(OpenError);
    await expect(openPath('vscode', '/nope', deps)).rejects.toThrow(/not a directory/);
    const failing = { ...deps, exec: async () => ({ code: 1, stdout: '', stderr: 'LSOpenURLsWithRole() failed' }) };
    await expect(openPath('iterm', '/repo', failing)).rejects.toThrow(/failed/);
  });
});
