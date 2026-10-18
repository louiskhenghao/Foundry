import { getBrief, getEscalation, getGoal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { classifyFeedback } from '../feedback.ts';
import type { ActionHost, Drafts } from './actions.ts';

/** The engine calls a chat may make (notify/actions.ts): the ones behind the web UI's buttons, nothing more. */
export function engineHost(engine: Engine, drafts: Drafts): ActionHost {
  const db = engine.store.db;
  return {
    goal: (id) => getGoal(db, id),
    brief: (goalId) => getBrief(db, goalId)?.brief ?? null,
    escalation: (id) => getEscalation(db, id),
    answerEscalation: (id, answer) => engine.answerEscalation(id, answer),
    answerInterview: (goalId, answers, finish) => engine.answerInterview(goalId, answers, finish),
    approveBrief: (goalId, budgets) => engine.approveBrief(goalId, undefined, budgets),
    classifyFeedback: (goalId, text) => {
      const goal = getGoal(db, goalId);
      if (!goal) throw new Error(`goal ${goalId} not found`);
      return classifyFeedback(engine, goal, text);
    },
    resumeNow: (provider) => engine.resumeNow(provider),
    note: (goalId, message) => void engine.store.append({ type: 'engine.note', goalId, payload: { level: 'info', message } }),
    drafts,
  };
}
