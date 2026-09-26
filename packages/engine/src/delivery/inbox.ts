/**
 * A stopped delivery is one Inbox item (trigger `delivery_failed`) carrying the reason — which checks failed, with
 * their descriptions and links — and two answers: Retry delivery, Mark as delivered. A new run of the delivery, or a
 * delivery that finishes some other way (a merge noticed on GitHub, "Mark as delivered"), closes the old item.
 */
import { getGoal, listEscalations } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { raiseEscalation } from '../escalation.ts';

export function raiseDeliveryFailure(engine: Engine, goalId: string, step: string, reason: string): void {
  const goal = getGoal(engine.store.db, goalId);
  if (!goal) return;
  const prs = goal.delivery.prs.filter((p) => p.number != null).map((p) => ({ number: p.number, url: p.url, state: p.state }));
  raiseEscalation(engine, { goal, trigger: 'delivery_failed', message: `Delivery stopped at **${step}**.\n\n${reason}`, payload: { kind: 'delivery', step, prs } });
}

/** close the open delivery Inbox items of a goal, recording how they were settled */
export function closeDeliveryFailures(engine: Engine, goalId: string, action: 'retry_delivery' | 'mark_delivered'): void {
  for (const e of listEscalations(engine.store.db, { goalId, openOnly: true })) {
    if (e.trigger !== 'delivery_failed') continue;
    engine.store.append({ type: 'escalation.answered', goalId, payload: { escalationId: e.id, answer: { action } } });
  }
}
