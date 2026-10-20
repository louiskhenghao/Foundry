import { expect, test } from 'bun:test';
import { stageDurations } from '../src/pages/goal/clarify-timing.ts';

test('stage durations are summed per stage over the current Clarify run, the open stage up to now', () => {
  const at = (s: number) => new Date(1_700_000_000_000 + s * 1000).toISOString();
  const e = (type: string, ts: string, payload: unknown = {}) => ({ id: ts, ts, goalId: 'g', type, payload }) as any;
  const events = [
    e('clarify.started', at(-50)),
    e('clarify.stage', at(-40), { stage: 'clarifying' }), // an earlier run, discarded by a re-run
    e('clarify.started', at(0)),
    e('clarify.stage', at(1), { stage: 'queued' }),
    e('clarify.stage', at(11), { stage: 'clarifying' }),
    e('interview.round_asked', at(41)),
    e('interview.round_answered', at(90)),
    e('clarify.stage', at(100), { stage: 'clarifying' }),
    e('brief.skeleton_proposed', at(160)),
    e('clarify.stage', at(161), { stage: 'planning' }),
  ];
  expect(stageDurations(events, Date.parse(at(200)))).toEqual({ queued: 10, clarifying: 90, planning: 39 });
  expect(stageDurations([], 0)).toEqual({});
});
