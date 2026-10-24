import { describe, expect, test } from 'bun:test';
import { ADJUST_ATTACHMENTS_MAX, ARTIFACTS_HISTORY_DIR, Adjustment, Attachment, DEFAULT_SETTINGS, Goal, IdPrefix, Task, TaskOrigin, assertTaskTransition } from '../index.ts';

/** Adjust the result (ADR-0077): a finished goal carries out the person's words on its result itself */
describe('an Adjustment', () => {
  const adjustment = { id: 'adj_1', n: 1, text: 'make the lid red', mode: 'resume' as const, taskId: 't_1', attachmentIds: ['att_1'], at: '2026-10-25T10:00:00.000Z', by: 'ann' };
  test('is recorded on the goal in order and on the task carrying it out; rows from before read as none', () => {
    expect(Adjustment.parse(adjustment)).toEqual(adjustment);
    expect(Adjustment.safeParse({ ...adjustment, mode: 'chat' }).success).toBe(false);
    expect(Adjustment.safeParse({ ...adjustment, text: '' }).success).toBe(false);
    // the fields are optional in the schema: a goal or task written before the feature parses, and the read path fills [] / null
    expect(Goal.shape.adjustments.isOptional()).toBe(true);
    expect(Task.shape.adjustment.isOptional()).toBe(true);
    expect(TaskOrigin.options).toContain('adjustment');
    expect(IdPrefix.adjust).toBe('adj');
  });
  test('its files are goal attachments marked with it, at most as many as a Conversation question takes', () => {
    const a = Attachment.parse({ id: 'att_1', kind: 'file', name: 'lid.png', mime: 'image/png', size: 10, path: 'attachments/g/att_1/lid.png', url: null, note: null, addedAt: adjustment.at, markdown: null, adjustId: 'adj_1' });
    expect(a.adjustId).toBe('adj_1');
    expect(ADJUST_ATTACHMENTS_MAX).toBe(8);
  });
  test('a finished task may go back to ready for it; the beta switch is off by default; the earlier results sit under .history', () => {
    expect(() => assertTaskTransition('done', 'ready')).not.toThrow();
    expect(() => assertTaskTransition('done', 'running')).toThrow();
    expect(DEFAULT_SETTINGS.beta.adjust).toBe(false);
    expect(ARTIFACTS_HISTORY_DIR).toBe('.history');
  });
});
