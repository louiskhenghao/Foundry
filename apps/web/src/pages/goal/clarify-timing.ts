import type { EngineEvent } from '@foundry/core/browser';

export type ClarifyStage = 'investigating' | 'queued' | 'clarifying' | 'planning';

/** events that end the step shown: the next step starts, a round waits for the human, the Brief or its skeleton is out */
const BOUNDARIES = new Set(['clarify.stage', 'interview.round_asked', 'interview.round_answered', 'brief.skeleton_proposed', 'brief.proposed', 'goal.state_changed']);

/**
 * How long each Clarify step has run so far in the current run (seconds, summed over its sessions): from the goal's
 * events since the last `clarify.started`, the open step counted up to `now`.
 */
export function stageDurations(events: Pick<EngineEvent, 'type' | 'ts' | 'payload'>[], now: number): Partial<Record<ClarifyStage, number>> {
  const sorted = [...events].sort((a, b) => a.ts.localeCompare(b.ts));
  const start = sorted.map((e) => e.type).lastIndexOf('clarify.started');
  const run = start < 0 ? sorted : sorted.slice(start);
  const out: Partial<Record<ClarifyStage, number>> = {};
  let open: { stage: ClarifyStage; at: number } | null = null;
  const close = (at: number) => {
    if (!open) return;
    out[open.stage] = (out[open.stage] ?? 0) + Math.max(0, (at - open.at) / 1000);
    open = null;
  };
  for (const e of run) {
    if (!BOUNDARIES.has(e.type)) continue;
    const at = Date.parse(e.ts);
    close(at);
    if (e.type === 'clarify.stage') open = { stage: (e.payload as { stage: ClarifyStage }).stage, at };
  }
  close(now);
  for (const k of Object.keys(out) as ClarifyStage[]) out[k] = Math.round(out[k]!);
  return out;
}
