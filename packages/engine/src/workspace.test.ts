import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyStyleSamples } from './workspace.ts';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'foundry-ws-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('copyStyleSamples', () => {
  test('copies the Brief style samples into a task worktree, never overwriting, and is a no-op without samples', () => {
    const goalWs = tmp();
    const taskWs = tmp();
    expect(copyStyleSamples(goalWs, taskWs)).toBe(0);
    mkdirSync(join(goalWs, 'artifacts', 'samples'), { recursive: true });
    writeFileSync(join(goalWs, 'artifacts', 'samples', 'S1-1.png'), 'png-1');
    writeFileSync(join(goalWs, 'artifacts', 'samples', 'S1-2.png'), 'png-2');
    expect(copyStyleSamples(goalWs, taskWs)).toBe(2);
    expect(readFileSync(join(taskWs, 'artifacts', 'samples', 'S1-1.png'), 'utf8')).toBe('png-1');
    writeFileSync(join(taskWs, 'artifacts', 'samples', 'S1-1.png'), 'edited');
    expect(copyStyleSamples(goalWs, taskWs)).toBe(0);
    expect(readFileSync(join(taskWs, 'artifacts', 'samples', 'S1-1.png'), 'utf8')).toBe('edited');
    expect(existsSync(join(taskWs, 'artifacts', 'samples', 'S1-2.png'))).toBe(true);
  });
});

describe('progress folders', () => {
  test('folder name: the title up to its first sentence break, unsafe characters dropped, id suffix', async () => {
    const { workspaceFolderName } = await import('./workspace.ts');
    expect(workspaceFolderName('打造火柴人游戏，这些游戏具备兼容性，可运行在手机app', 'g_0mtlhlicg004znts6p7')).toBe('打造火柴人游戏-nts6p7');
    expect(workspaceFolderName("Fix login: users/admins can't sign in?", 'g_abcdef123456')).toBe('Fix login-123456');
    expect(workspaceFolderName('x'.repeat(60), 'g_1234567')).toBe(`${'x'.repeat(40)}-234567`);
    expect(workspaceFolderName('   ', 'g_1234567')).toBe('goal-234567');
  });

  test('default location: next to the repository, or under the configured root', async () => {
    const { defaultWorkspaceDir } = await import('./workspace.ts');
    const goal = { id: 'g_1234567', title: 'Add dark mode', repoPath: '/Users/me/Projects/app' };
    expect(defaultWorkspaceDir(null, goal)).toBe('/Users/me/Projects/app-foundry/Add dark mode-234567');
    expect(defaultWorkspaceDir('/Users/me/Foundry', goal)).toBe('/Users/me/Foundry/app/Add dark mode-234567');
  });

  test('layout: engine worktrees beside the folder under .foundry; legacy goals stay under dataDir', async () => {
    const { baselineWorkspacePath, deliveryWorkspacePath, goalWorkspacePath, internalWorkspaceDir, resolveWorkspacePath, taskWorkspacePath } = await import('./workspace.ts');
    const g = { id: 'g_1', workspaceDir: '/p/app-foundry/Add dark mode-234567' };
    expect(goalWorkspacePath('/data', g)).toBe(g.workspaceDir);
    expect(internalWorkspaceDir(g)).toBe('/p/app-foundry/.foundry/Add dark mode-234567');
    expect(taskWorkspacePath('/data', g, 't_1')).toBe('/p/app-foundry/.foundry/Add dark mode-234567/tasks/t_1');
    expect(deliveryWorkspacePath('/data', g)).toBe('/p/app-foundry/.foundry/Add dark mode-234567/delivery');
    expect(resolveWorkspacePath('/data', g, 't_1')).toBe('/p/app-foundry/.foundry/Add dark mode-234567/resolve/t_1');
    expect(baselineWorkspacePath('/data', g)).toBe('/p/app-foundry/.foundry/Add dark mode-234567/baseline');
    const legacy = { id: 'g_1', workspaceDir: null };
    expect(internalWorkspaceDir(legacy)).toBeNull();
    expect(goalWorkspacePath('/data', legacy)).toBe('/data/worktrees/g_1/_goal');
    expect(taskWorkspacePath('/data', legacy, 't_1')).toBe('/data/worktrees/g_1/t_1');
    expect(deliveryWorkspacePath('/data', legacy)).toBe('/data/worktrees/g_1/_delivery');
    expect(resolveWorkspacePath('/data', legacy, 't_1')).toBe('/data/worktrees/g_1/_resolve/t_1');
    expect(baselineWorkspacePath('/data', legacy)).toBe('/data/worktrees/g_1/_baseline');
  });
});
