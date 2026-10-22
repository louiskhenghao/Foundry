import { existsSync, readFileSync } from 'node:fs';
import type { AgentProvider } from '@foundry/core';
import { decodeAgyLines, decodeLine, type RunnerEvent } from '@foundry/runner';
import { git } from './git/git.ts';

/** what a session said last, in its own words (no tool output), oldest first, at most `max` characters */
export function transcriptTail(path: string | null | undefined, provider: AgentProvider, max = 3000): string {
  if (!path || !existsSync(path)) return '';
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const events: RunnerEvent[] = provider === 'agy' ? decodeAgyLines(lines) : lines.flatMap((l) => decodeLine(l));
  const said: string[] = [];
  let size = 0;
  for (const ev of events.reverse()) {
    if (ev.kind !== 'text' || !ev.text.trim()) continue;
    said.unshift(ev.text.trim());
    size += ev.text.length;
    if (size >= max) break;
  }
  const text = said.join('\n\n');
  return text.length > max ? `…${text.slice(-max)}` : text;
}

/**
 * The section a new session starts with when the attempt's own session cannot be resumed (another account could not
 * pick it up, ADR-0065): what the earlier session committed in the workspace, what the task changed so far, and what
 * the session said last. The task itself is in the prompt above it.
 */
export async function handoffSection(i: { cwd: string; attemptBaseRef: string | null; taskBaseRef: string | null; transcriptPath: string | null; provider: AgentProvider; why: string }): Promise<string> {
  const out = async (args: string[]) => {
    const r = await git(args, i.cwd).catch(() => null);
    return r && r.code === 0 ? r.stdout.trim() : '';
  };
  const commits = i.attemptBaseRef ? await out(['log', '--oneline', '--no-decorate', `${i.attemptBaseRef}..HEAD`]) : '';
  const changed = i.taskBaseRef ? await out(['diff', '--stat', i.taskBaseRef, 'HEAD']) : '';
  const said = transcriptTail(i.transcriptPath, i.provider);
  return [
    '# Handoff',
    `An earlier session started this attempt and stopped before it finished (${i.why}). It could not be resumed, so you take over in the same workspace: everything it did is here. Read what it changed before you go on; do not redo finished steps.`,
    commits ? `## Its commits\n\`\`\`\n${commits.slice(0, 4000)}\n\`\`\`` : '',
    changed ? `## What the task changed so far\n\`\`\`\n${changed.slice(-4000)}\n\`\`\`` : '',
    said ? `## What it said last\n${said}` : '',
  ].filter(Boolean).join('\n\n');
}
