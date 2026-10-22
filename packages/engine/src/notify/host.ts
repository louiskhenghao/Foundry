import { join } from 'node:path';
import { getBrief, getEscalation, getGoal, isPooled } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { classifyFeedback } from '../feedback.ts';
import { type ActionHost, type Drafts, JsonDrafts } from './actions.ts';

/** The engine calls a chat may make (notify/actions.ts): the ones behind the web UI's buttons, nothing more. */
export function engineHost(engine: Engine, drafts: Drafts): ActionHost {
  const db = engine.store.db;
  return {
    goal: (id) => getGoal(db, id),
    brief: (goalId) => getBrief(db, goalId)?.brief ?? null,
    escalation: (id) => getEscalation(db, id),
    answerEscalation: (id, answer) => engine.answerEscalation(id, answer),
    answerInterview: (goalId, answers, finish, note) => engine.answerInterview(goalId, answers, finish, note),
    approveBrief: (goalId, budgets) => engine.approveBrief(goalId, undefined, budgets),
    classifyFeedback: (goalId, text) => {
      const goal = getGoal(db, goalId);
      if (!goal) throw new Error(`goal ${goalId} not found`);
      return classifyFeedback(engine, goal, text);
    },
    resumeNow: (provider) => engine.resumeNow(provider),
    switchToNext: (provider) => (isPooled(provider) ? engine.switchToNext(provider) : null),
    nextAccount: (provider) => {
      const next = isPooled(provider) ? engine.accountPool.next(provider) : null;
      return next && isPooled(provider) ? engine.accountPool.label(provider, next.id) : null;
    },
    calibration: (goal) => engine.calibrationFor(goal),
    note: (goalId, message) => void engine.store.append({ type: 'engine.note', goalId, payload: { level: 'info', message } }),
    drafts,
  };
}

const hosts = new WeakMap<Engine, ActionHost>();
/** one host per engine, its drafts shared by every chat: a round can be answered partly in one channel and sent from another */
export function chatHost(engine: Engine): ActionHost {
  let h = hosts.get(engine);
  if (!h) hosts.set(engine, (h = engineHost(engine, new JsonDrafts(join(engine.config.dataDir, 'notify', 'drafts.json')))));
  return h;
}
