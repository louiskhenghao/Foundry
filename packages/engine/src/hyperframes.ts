import type { DoctorCheck } from './skills/types.ts';

/** the video pack option of the HyperFrames engine (ADR-0087) */
export const HYPERFRAMES = 'hyperframes';
/** the release of Node.js the HyperFrames CLI needs */
export const HYPERFRAMES_NODE = 22;

/** what the doctor found of the HyperFrames engine's tools (ADR-0087): Node.js 22 or newer, ffmpeg with ffprobe on PATH; Chrome the CLI fetches itself */
export interface HyperframesTools {
  node: string | null;
  /** `node --version` as printed, e.g. v24.14.1; null when node is not on PATH */
  nodeVersion: string | null;
  ffmpeg: string | null;
  ffprobe: string | null;
  platform: NodeJS.Platform;
}

/** the major of a `node --version` line, NaN when it is not one */
export const nodeMajor = (v: string | null): number => Number(/^v?(\d+)/.exec(v ?? '')?.[1] ?? NaN);

/**
 * The doctor's check for the HyperFrames engine, shown while Settings → Video skills names it (or a goal picked it).
 * Both tools are optional for every other goal, so a miss is a warning; the fix is the install command for this
 * platform. The CLI fetches the Chrome it renders with on the first render, so no browser is checked here.
 */
export function hyperframesCheck(t: HyperframesTools): DoctorCheck {
  const label = 'HyperFrames — Node.js 22 and ffmpeg';
  const major = nodeMajor(t.nodeVersion);
  const nodeOk = !!t.node && major >= HYPERFRAMES_NODE;
  const ffmpegOk = !!t.ffmpeg && !!t.ffprobe;
  const parts = [nodeOk ? `node ${t.nodeVersion} at ${t.node}` : t.node ? `node ${t.nodeVersion ?? '?'} at ${t.node} — HyperFrames needs ${HYPERFRAMES_NODE} or newer` : 'node is not on PATH', ffmpegOk ? `ffmpeg at ${t.ffmpeg}` : t.ffmpeg ? 'ffmpeg found but ffprobe is not on PATH' : 'ffmpeg is not on PATH'];
  if (nodeOk && ffmpegOk) return { id: 'hyperframes', label, ok: true, severity: 'warn', detail: `${parts.join('; ')} — HyperFrames goals can render, measure and edit their films (the CLI fetches its own Chrome)`, fix: null };
  const fix = !nodeOk
    ? { command: t.platform === 'darwin' ? 'brew install node' : 'sudo apt-get install -y nodejs', url: 'https://nodejs.org/en/download' }
    : { command: t.platform === 'darwin' ? 'brew install ffmpeg' : 'sudo apt-get install -y ffmpeg', url: 'https://ffmpeg.org/download.html' };
  return { id: 'hyperframes', label, ok: false, severity: 'warn', detail: `${parts.join('; ')} — a HyperFrames goal's renders and the Editor's Re-render fail without them`, fix };
}
