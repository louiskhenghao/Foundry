import { expect, test } from 'bun:test';
import type { Brief } from '@foundry/core/browser';
import { inferCompletionDefaults } from '../src/pages/brief/CompletionCard.tsx';

const brief = (over: Partial<Brief> = {}): Brief =>
  ({ goalId: 'g', title: 't', understanding: 'u', areas: [], assumptions: [], questions: [], styleOptions: [], costEstimateUsd: 1, timeEstimateMin: 10, tasks: [{ key: 'T1', title: 'add', spec: 's', kind: 'feature', scope: null, scenario: 'frontend', areaKey: null, tdd: 'inherit', dependsOnKeys: [], parallelizable: false, relevantFiles: [] }], checks: [], run: null, apps: null, ...over }) as unknown as Brief;

test('the browser QA is on by default only when Settings say so and the Brief names an app to run (ADR-0057)', () => {
  expect(inferCompletionDefaults(brief(), false, true).qa).toBe(false);
  expect(inferCompletionDefaults(brief({ run: { install: null, command: 'bun dev', url: 'http://localhost:{port}', platform: 'web' } as never }), false, true).qa).toBe(true);
  expect(inferCompletionDefaults(brief({ apps: [{ key: 'web', name: 'web', dir: '', install: null, command: 'bun dev', url: 'http://localhost:{port}', platform: 'web' } as never] }), false, false).qa).toBe(false);
  expect(inferCompletionDefaults(brief({ run: { install: null, command: 'bun dev', url: 'http://localhost:{port}', platform: 'web' } as never }), true, true)).toMatchObject({ graphRefresh: true, audit: true, qa: true });
});
