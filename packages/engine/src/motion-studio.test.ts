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
