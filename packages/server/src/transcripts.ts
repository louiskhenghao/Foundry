import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { decodeLine, type StreamEvent } from '@foundry/engine';

type LiveEvent = StreamEvent['event'];
/** a live-log event as sent to the browser: `truncated` says the feed shortened it and the full one is on the server */
export type SlimEvent = LiveEvent & { truncated?: true };

/** the live feed stays light: long thinking and tool output are shortened (the dialog reads the full event back) */
export const SLIM_LIMITS = { thinking: 300, tool_result: 1500 } as const;

/**
 * The transcript behind a live channel that is not an attempt. Most channels are saved under their own name
 * (clarify-<goal>, goal-review-<goal>-<n>); the Brief page's draft-<goal> channel carries every Draft and Revise
 * session, saved as draft-<goal>-<n> / revise-<goal>-<n>, so its history is the newest of those.
 */
export function channelTranscript(dataDir: string, channel: string): string | null {
  if (!/^[\w.-]+$/.test(channel)) return null;
  const dir = join(dataDir, 'transcripts');
  const exact = join(dir, `${channel}.jsonl`);
  if (existsSync(exact)) return exact;
  const draft = channel.match(/^draft-(.+)$/);
  if (!draft || !existsSync(dir)) return null;
  const goal = draft[1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(draft|revise)-${goal}-\\d+\\.jsonl$`);
  const files = readdirSync(dir).filter((f) => re.test(f)).map((f) => join(dir, f));
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}

/** the event as the live feed sends it: unknowns dropped, long thinking / tool output shortened and flagged */
export function slimEvent(ev: LiveEvent): SlimEvent | null {
  if (ev.kind === 'unknown') return null;
  if (ev.kind === 'thinking' && ev.text.length > SLIM_LIMITS.thinking) return { ...ev, text: ev.text.slice(0, SLIM_LIMITS.thinking), truncated: true };
  if (ev.kind === 'tool_result' && ev.content.length > SLIM_LIMITS.tool_result) return { ...ev, content: ev.content.slice(0, SLIM_LIMITS.tool_result), truncated: true };
  return ev;
}

/** The decoded history of a transcript for the Live log: the last `limit` events, slimmed like the live feed, each pointing at its line. */
export function readHistory(path: string, limit = 400): SlimEvent[] {
  if (!existsSync(path)) return [];
  const file = basename(path);
  const events: SlimEvent[] = [];
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const [block, ev] of decodeLine(line).entries()) {
        const slim = slimEvent({ ...ev, ref: { file, line: i, block } });
        if (slim) events.push(slim);
      }
    });
  return events.slice(-limit);
}

/**
 * One event in full, read back from the transcript a live-log line points at (file name inside the transcripts
 * folder, 0-based line, block within the line). Null when the file, line or block is not there.
 */
export function readTranscriptEvent(dataDir: string, file: string, line: number, block: number): LiveEvent | null {
  if (!/^[\w.-]+\.jsonl$/.test(file) || basename(file) !== file) return null;
  if (!Number.isInteger(line) || line < 0 || !Number.isInteger(block) || block < 0) return null;
  const path = join(dataDir, 'transcripts', file);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8').split('\n')[line];
  const ev = raw == null ? undefined : decodeLine(raw)[block];
  return ev ? { ...ev, ref: { file, line, block } } : null;
}
