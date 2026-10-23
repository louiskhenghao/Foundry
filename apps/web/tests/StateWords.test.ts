import { describe, expect, test } from 'bun:test';
import { stateLabel } from '../src/ui.tsx';

describe('a goal state in words', () => {
  test('is said as a state, never as what to do', () => {
    expect(['draft', 'clarifying', 'awaiting_brief_approval', 'running', 'goal_review', 'blocked', 'awaiting_feedback', 'done', 'over_delivered', 'failed', 'cancelled'].map(stateLabel)).toEqual(['draft', 'clarifying', 'awaiting approval', 'running', 'reviewing', 'blocked', 'awaiting feedback', 'done', 'over-delivered', 'failed', 'cancelled']);
  });
});
