import type { DoctorCheck } from './skills/types.ts';

/** what the doctor found of the motion-studio engine's tools (ADR-0076): ffmpeg with ffprobe on PATH, Chromium for the engine's Playwright */
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
