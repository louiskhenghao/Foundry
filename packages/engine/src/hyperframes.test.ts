import { describe, expect, test } from 'bun:test';
import { hyperframesCheck, nodeMajor } from './hyperframes.ts';

const ready = { node: '/opt/homebrew/bin/node', nodeVersion: 'v24.14.1', ffmpeg: '/opt/homebrew/bin/ffmpeg', ffprobe: '/opt/homebrew/bin/ffprobe', platform: 'darwin' as const };

describe("the doctor's HyperFrames check (ADR-0087)", () => {
  test('both there: green, naming both; no browser asked for', () => {
    const c = hyperframesCheck(ready);
    expect(c.ok).toBe(true);
    expect(c.detail).toContain('node v24.14.1 at /opt/homebrew/bin/node');
    expect(c.detail).toContain('ffmpeg at /opt/homebrew/bin/ffmpeg');
    expect(c.detail).toContain('fetches its own Chrome');
    expect(c.fix).toBeNull();
  });
  test('node too old or missing: the install for the platform, before ffmpeg', () => {
    const old = hyperframesCheck({ ...ready, nodeVersion: 'v18.20.0' });
    expect(old.ok).toBe(false);
    expect(old.detail).toContain('needs 22 or newer');
    expect(old.fix).toMatchObject({ command: 'brew install node' });
    expect(hyperframesCheck({ ...ready, node: null, nodeVersion: null, platform: 'linux' }).fix).toMatchObject({ command: 'sudo apt-get install -y nodejs' });
    expect(nodeMajor('v22.1.0')).toBe(22);
    expect(nodeMajor(null)).toBeNaN();
  });
  test('ffmpeg missing: the install command for the platform', () => {
    expect(hyperframesCheck({ ...ready, ffmpeg: null, ffprobe: null }).fix).toMatchObject({ command: 'brew install ffmpeg' });
    expect(hyperframesCheck({ ...ready, ffprobe: null }).detail).toContain('ffprobe is not on PATH');
    expect(hyperframesCheck({ ...ready, ffprobe: null, platform: 'linux' }).fix).toMatchObject({ command: 'sudo apt-get install -y ffmpeg' });
  });
});
