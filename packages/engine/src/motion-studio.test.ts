import { describe, expect, test } from 'bun:test';
import { motionStudioCheck } from './motion-studio.ts';

const ready = { ffmpeg: '/opt/homebrew/bin/ffmpeg', ffprobe: '/opt/homebrew/bin/ffprobe', browser: true, browserDetail: 'Chromium at /x/chrome', platform: 'darwin' as const };

describe("the doctor's motion-studio check (ADR-0076)", () => {
  test('both tools there: green, naming both', () => {
    const c = motionStudioCheck(ready);
    expect(c.ok).toBe(true);
    expect(c.detail).toContain('ffmpeg at /opt/homebrew/bin/ffmpeg');
    expect(c.detail).toContain('Chromium at /x/chrome');
    expect(c.fix).toBeNull();
  });
  test('ffmpeg missing: the install command for the platform, before Chromium', () => {
    expect(motionStudioCheck({ ...ready, ffmpeg: null, ffprobe: null }).fix).toMatchObject({ command: 'brew install ffmpeg' });
    expect(motionStudioCheck({ ...ready, ffmpeg: null, ffprobe: null, platform: 'linux' }).fix).toMatchObject({ command: 'sudo apt-get install -y ffmpeg' });
    expect(motionStudioCheck({ ...ready, ffprobe: null }).detail).toContain('ffprobe is not on PATH');
  });
  test('Chromium missing: the one-click install the self-check uses', () => {
    const c = motionStudioCheck({ ...ready, browser: false, browserDetail: 'Chromium is not downloaded yet — run the install' });
    expect(c.ok).toBe(false);
    expect(c.fix).toMatchObject({ installId: 'playwright', action: 'install-tool' });
    expect(c.detail).toContain('a motion-studio goal waits');
  });
});

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOUSE_STYLE_SKILL, exportHouseStyle, renderHouseStyleSkill } from './motion-studio.ts';
import { goalWorkspacePath } from './workspace.ts';

describe("a film's house style becomes a project skill (ADR-0076)", () => {
  test('the skill text carries the house style under a frontmatter the person\'s sessions read', () => {
    const t = renderHouseStyleSkill('# House style\n\n## Brand\n\nink #F0EEE6, accent #D97757', 'Launch reel', '2026-10-25T10:00:00Z');
    expect(t.startsWith(`---\nname: ${HOUSE_STYLE_SKILL}\n`)).toBe(true);
    expect(t).toContain('"Launch reel", 2026-10-25');
    expect(t).toContain('accent #D97757');
  });
  test('exported into the repository under both skills folders and kept out of git; skipped when the film left none', async () => {
    const home = mkdtempSync(join(tmpdir(), 'house-'));
    const repo = join(home, 'repo');
    mkdirSync(repo, { recursive: true });
    Bun.spawnSync(['git', 'init', '-q'], { cwd: repo });
    const dataDir = join(home, 'data');
    const goal = { id: 'g_house1', title: 'Launch reel', repoPath: repo, workspaceDir: join(home, 'ws') } as any;
    mkdirSync(join(goalWorkspacePath(dataDir, goal), 'docs', 'motion'), { recursive: true });
    const engine = { config: { dataDir, log: () => {} } } as any;
    expect(await exportHouseStyle(engine, goal)).toBe('skipped');
    writeFileSync(join(goalWorkspacePath(dataDir, goal), 'docs', 'motion', 'house-style.md'), '# House style\n\n## Brand\n\nink #F0EEE6');
    expect(await exportHouseStyle(engine, goal)).toBe('written');
    for (const d of ['.claude/skills', '.agents/skills']) expect(readFileSync(join(repo, d, HOUSE_STYLE_SKILL, 'SKILL.md'), 'utf8')).toContain('ink #F0EEE6');
    expect(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')).toContain(`.claude/skills/${HOUSE_STYLE_SKILL}/`);
    rmSync(home, { recursive: true, force: true });
  });
});
