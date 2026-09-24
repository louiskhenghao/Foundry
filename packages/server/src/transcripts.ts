import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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
