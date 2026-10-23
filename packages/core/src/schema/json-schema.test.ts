import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { PlanOutput } from './brief.ts';
import { jsonSchemaFor } from './json-schema.ts';
import { LikenessVerdict } from './subject.ts';

/** every object schema under `node` that closes itself to properties it does not name */
function closedObjects(node: unknown, path = 'root'): string[] {
  if (!node || typeof node !== 'object') return [];
  const n = node as Record<string, unknown>;
  const here = n.additionalProperties === false ? [path] : [];
  return [...here, ...Object.entries(n).flatMap(([k, v]) => (k === 'properties' || k === 'items' || k === 'anyOf' || typeof v === 'object' ? closedObjects(v, `${path}/${k}`) : []))];
}

describe("a role's output schema", () => {
  test('tolerates properties it does not name, at every level', () => {
    const schema = jsonSchemaFor(z.object({ brief: z.object({ title: z.string(), checks: z.array(z.object({ cmd: z.string() })) }).nullable(), questions: z.array(z.string()) }));
    expect(closedObjects(schema)).toEqual([]);
    expect(closedObjects(jsonSchemaFor(PlanOutput))).toEqual([]);
  });

  test('what the planner echoes from the skeleton is dropped, not refused', () => {
    const plan = { tasks: [{ key: 'T1', title: 't', spec: 's', kind: 'feature', scenario: 'general', areaKey: 'A1', difficulty: 'standard', dependsOnKeys: [], parallelizable: false, relevantFiles: [] }], checks: [], costEstimateUsd: 1, timeEstimateMin: 1 };
    const parsed = PlanOutput.safeParse({ ...plan, styleOptions: [], subjects: null, run: null, apps: null, openQuestions: [] });
    expect(parsed.success).toBe(true);
    expect(Object.keys(parsed.data!)).toEqual(['tasks', 'checks', 'costEstimateUsd', 'timeEstimateMin']);
  });

  test('a likeness verdict names no shots when none were compared', () => {
    const parsed = LikenessVerdict.safeParse({ subjects: [{ key: 'P1', shown: false, score: 0, matches: [], differences: [] }], summary: 'nothing to compare' });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.subjects[0]!.shots).toEqual([]);
  });
});
