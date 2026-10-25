import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Goal } from '@foundry/core';
import type { Engine } from './engine.ts';
import { excludeFromGit } from './skills/autoskills.ts';
import type { DoctorCheck } from './skills/types.ts';
import { goalWorkspacePath } from './workspace.ts';

/** the video pack option of the motion-studio engine (ADR-0077) */
export const MOTION_STUDIO = 'motion-studio';
/** the project skill a film's house style becomes: what the next film for this product starts from */
export const HOUSE_STYLE_SKILL = 'motion-house-style';
const HOUSE_STYLE_DIRS = ['.claude/skills', '.agents/skills'] as const;
const HOUSE_STYLE_MARK = "Written by Foundry from a motion-studio goal's docs/motion/house-style.md";

/** the SKILL.md text of the house-style skill: the film's house style, as the person's own sessions read it */
export function renderHouseStyleSkill(houseStyle: string, film: string, at: string): string {
  return [
    '---',
    `name: ${HOUSE_STYLE_SKILL}`,
    `description: The house style of this product's motion films — brand colours and faces, the motif and its grammar, the sound, what went wrong last time. Read before making a film, a reel or any motion graphics for it. ${HOUSE_STYLE_MARK}.`,
    '---',
    '',
    `${HOUSE_STYLE_MARK} ("${film}", ${at.slice(0, 10)}). The next goal rewrites it from the newer film; edit docs/motion/house-style.md in the film's branch, not this copy.`,
    '',
    houseStyle.trim(),
    '',
  ].join('\n');
}

/**
 * Write the house style a motion-studio goal left (docs/motion/house-style.md in its workspace) as a project skill in the
 * repository, kept out of git like the Learnings skill. Never throws: a workspace without the file is left alone.
 */
export async function exportHouseStyle(engine: Engine, goal: Goal): Promise<'written' | 'skipped'> {
  try {
    const src = join(goalWorkspacePath(engine.config.dataDir, goal), 'docs', 'motion', 'house-style.md');
    if (!existsSync(src) || !existsSync(join(goal.repoPath, '.git'))) return 'skipped';
    const text = renderHouseStyleSkill(readFileSync(src, 'utf8'), goal.title, new Date().toISOString());
    for (const d of HOUSE_STYLE_DIRS) {
      const dir = join(goal.repoPath, d, HOUSE_STYLE_SKILL);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), text);
    }
    await excludeFromGit(goal.repoPath, HOUSE_STYLE_DIRS.map((d) => `${d}/${HOUSE_STYLE_SKILL}/`), engine.config.log);
    return 'written';
  } catch (err) {
    engine.config.log?.(`[motion-studio] house style not exported for ${goal.id}: ${String((err as Error).message ?? err)}`);
    return 'skipped';
  }
}

/** what the doctor found of the motion-studio engine's tools (ADR-0077): ffmpeg with ffprobe on PATH, Chromium for the engine's Playwright */
export interface MotionStudioTools {
  ffmpeg: string | null;
  ffprobe: string | null;
  /** the self-check's Playwright status: Chromium downloaded, and its detail line */
  browser: boolean;
  browserDetail: string;
  platform: NodeJS.Platform;
}

/**
 * The doctor's check for the motion-studio engine, shown only while the Beta is on. Both tools are optional for every
 * other goal, so a miss is a warning; the fix is the one-click Chromium install the self-check uses, or the ffmpeg
 * install command for this platform.
 */
export function motionStudioCheck(t: MotionStudioTools): DoctorCheck {
  const label = 'Motion studio — ffmpeg and Chromium (beta)';
  const ffmpegOk = !!t.ffmpeg && !!t.ffprobe;
  const parts = [ffmpegOk ? `ffmpeg at ${t.ffmpeg}` : t.ffmpeg ? 'ffmpeg found but ffprobe is not on PATH' : 'ffmpeg is not on PATH', t.browser ? t.browserDetail : `Chromium: ${t.browserDetail}`];
  if (ffmpegOk && t.browser) return { id: 'motion-studio', label, ok: true, severity: 'warn', detail: `${parts.join('; ')} — motion-studio goals can render and measure their films`, fix: null };
  const fix = ffmpegOk
    ? { installId: 'playwright', action: 'install-tool' as const, url: '/settings#preview' }
    : { command: t.platform === 'darwin' ? 'brew install ffmpeg' : 'sudo apt-get install -y ffmpeg', url: 'https://ffmpeg.org/download.html' };
  return { id: 'motion-studio', label, ok: false, severity: 'warn', detail: `${parts.join('; ')} — a motion-studio goal waits until both are there`, fix };
}
