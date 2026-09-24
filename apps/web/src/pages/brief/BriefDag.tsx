import type { Brief } from '@foundry/core/browser';
import { depths } from '@foundry/core/browser';
import { useMemo } from 'react';
import { DagCanvas, type DagTask } from '../goal/DagCanvas.tsx';
import { areaOf, areaStyle } from './shared.ts';

/** The Brief's task DAG drawn with the run view's canvas: nodes are Brief tasks, coloured by Area. */
export function BriefDag({ brief, selected, onSelect }: { brief: Brief; selected: string | null; onSelect: (key: string | null) => void }) {
  const tasks = useMemo<DagTask[] | null>(() => {
    let d: Map<string, number>;
    try {
      d = depths(brief.tasks.map((t) => ({ id: t.key, dependsOn: t.dependsOnKeys })));
    } catch {
      return null;
    }
    return brief.tasks.map((t) => ({
      id: t.key,
      goalId: brief.goalId,
      title: t.title || '(untitled)',
      spec: t.spec,
      tdd: t.tdd,
      kind: t.kind,
      difficulty: t.difficulty ?? 'normal',
      milestone: t.milestone ?? null,
      milestoneVisits: 0,
      checkpointOf: null,
      scope: t.scope,
      scenario: t.scenario,
      area: areaOf(brief, t.areaKey)?.name ?? null,
      baseRef: null,
      commitRef: null,
      commitMessage: null,
      dependsOn: t.dependsOnKeys,
      relevantFiles: t.relevantFiles,
      parallelizable: t.parallelizable,
      retryBudget: 1,
      origin: 'brief',
      state: 'pending',
      branch: null,
      worktreePath: null,
      hint: null,
      extraAttempts: 0,
      createdAt: '',
      updatedAt: '',
      depth: d.get(t.key) ?? 0,
      attempts: 0,
      maxAttempts: 0,
      lastCost: null,
      plain: { label: areaOf(brief, t.areaKey)?.name ?? null, color: areaStyle(brief, t.areaKey).dot },
    }));
  }, [brief]);
  if (!tasks) return <div className="text-xs text-rose-300">The task graph has a cycle — fix the "runs after" settings below.</div>;
  return <DagCanvas tasks={tasks} selected={selected} onSelect={onSelect} />;
}
