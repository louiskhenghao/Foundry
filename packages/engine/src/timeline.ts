/** A goal's timeline with its Delegated goals, made from what the event store recorded (see core's buildTimeline). */
import type { Goal, GoalTimeline, Task, TimelineInput } from '@foundry/core';
import { TIMELINE_EVENTS, buildTimeline, depths, getGoal, listDelegatedGoals, listTasks } from '@foundry/core';
import type { Engine } from './engine.ts';

/** tasks in plan order: by the stage they are in, then as they were made */
function planOrder(tasks: Task[]): Task[] {
  let depth = new Map<string, number>();
  try {
    depth = depths(tasks);
  } catch {
    // a cycle (an edited plan): made order alone
  }
  return [...tasks].sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0) || a.createdAt.localeCompare(b.createdAt));
}

/** null when the goal does not exist */
export function goalTimeline(engine: Engine, goalId: string, now = new Date().toISOString()): GoalTimeline | null {
  const db = engine.store.db;
  const goal = getGoal(db, goalId);
  if (!goal) return null;
  const input = (g: Goal): TimelineInput => ({ goal: g, tasks: planOrder(listTasks(db, g.id)), events: engine.store.listByGoalOfTypes(g.id, [...TIMELINE_EVENTS]) });
  return buildTimeline(input(goal), listDelegatedGoals(db, goalId).map(input), now);
}
