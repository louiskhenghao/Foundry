import type { AgentProvider } from '@foundry/core';
import { decodeAgyLines, decodeLine, type RunnerEvent } from '@foundry/runner';

/**
 * A transcript in the shape Hindsight's own integration writes back (ADR-0071): one turn per line, `{role, content}`.
 * `action` names a tool call and its target with no arguments or outputs; `tool_error` keeps what a failed call
 * said, since that is where a pitfall shows. Successful tool output and the agent's thinking are left out: they are
 * the bulk of a transcript and teach a bank nothing it cannot read from the repository.
 */
export interface CompactTurn {
  role: 'user' | 'assistant' | 'action' | 'tool_error' | 'result';
  content: string;
}

export const COMPACT_MAX_CHARS = 200_000;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const firstLine = (s: string) => s.trim().split('\n')[0]!.trim();
/** the input field that says what a tool call was about, by how the common tools name it */
const TARGET_KEYS = ['file_path', 'path', 'notebook_path', 'command', 'pattern', 'skill', 'url', 'query', 'prompt', 'description'];

/** "Edit src/app.ts", "Bash bun test", or just the tool's name */
export function actionLine(name: string, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  for (const k of TARGET_KEYS) {
    const v = i[k];
    if (typeof v === 'string' && v.trim()) return `${name} ${clip(firstLine(v), 160)}`;
  }
  return name;
}

export function compactEvents(events: Iterable<RunnerEvent>, opts: { prompt?: string | null; maxChars?: number } = {}): string {
  const turns: CompactTurn[] = [];
  if (opts.prompt?.trim()) turns.push({ role: 'user', content: clip(opts.prompt.trim(), 4_000) });
  for (const ev of events) {
    if (ev.kind === 'text' && ev.text.trim()) turns.push({ role: 'assistant', content: clip(ev.text.trim(), 4_000) });
    else if (ev.kind === 'tool_use') turns.push({ role: 'action', content: actionLine(ev.name, ev.input) });
    else if (ev.kind === 'tool_result' && ev.isError && ev.content.trim()) turns.push({ role: 'tool_error', content: clip(ev.content.trim(), 500) });
    else if (ev.kind === 'result') turns.push({ role: 'result', content: ev.result.isError ? `${ev.result.subtype}${ev.result.errorMessage ? `: ${clip(ev.result.errorMessage, 300)}` : ''}` : ev.result.subtype });
  }
  return limitLines(turns.map((t) => JSON.stringify(t)), opts.maxChars ?? COMPACT_MAX_CHARS).join('\n');
}

/** a stored transcript (the runner's raw stream lines) of a session of the given coding agent */
export function compactTranscript(text: string, provider: AgentProvider, opts: { prompt?: string | null; maxChars?: number } = {}): string {
  const lines = text.split('\n').filter(Boolean);
  const events: RunnerEvent[] = provider === 'agy' ? decodeAgyLines(lines) : lines.flatMap((l) => decodeLine(l));
  return compactEvents(events, opts);
}

/** over the cap, the start and the end are kept (the task and the outcome) and the middle is left out, said so */
function limitLines(lines: string[], max: number): string[] {
  const total = lines.reduce((n, l) => n + l.length + 1, 0);
  if (total <= max) return lines;
  const head: string[] = [];
  let used = 0;
  for (const l of lines) {
    if (used + l.length + 1 > max * 0.6) break;
    head.push(l);
    used += l.length + 1;
  }
  const tail: string[] = [];
  let tailUsed = 0;
  for (let i = lines.length - 1; i >= head.length; i--) {
    const l = lines[i]!;
    if (tailUsed + l.length + 1 > max * 0.35) break;
    tail.unshift(l);
    tailUsed += l.length + 1;
  }
  const dropped = lines.length - head.length - tail.length;
  return [...head, JSON.stringify({ role: 'assistant', content: `[${dropped} turn${dropped === 1 ? '' : 's'} left out of this transcript]` } satisfies CompactTurn), ...tail];
}
