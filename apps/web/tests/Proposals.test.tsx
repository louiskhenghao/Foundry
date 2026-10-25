import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { Proposal } from '@foundry/core/browser';
import type { Conversation, ConversationMessage } from '../src/api.ts';
import { ConversationThread, liveAnswer } from '../src/components/conversation/ConversationThread.tsx';
import type { StreamItem } from '../src/store.ts';

const at = '2026-10-24T10:00:00.000Z';
const person = (id: string, text: string): ConversationMessage => ({ id, role: 'person', text, at, by: null, askedId: null, status: null, reason: null, costUsd: 0, costAvailable: true, model: null, durationMs: 0, attachments: [], proposals: [] });
const answer = (id: string, askedId: string, text: string, proposals: Proposal[]): ConversationMessage => ({ id, role: 'explainer', text, at, by: null, askedId, status: 'done', reason: null, costUsd: 0.2, costAvailable: true, model: 'claude-sonnet-5-5', durationMs: 5_000, attachments: [], proposals });
const conversation = (messages: ConversationMessage[]): Conversation => ({ id: 'c1', goalId: 'g1', title: 'add a button', startedAt: at, updatedAt: at, by: null, sessionId: 's1', costUsd: 0.2, messages });
const noop = () => {};
const block = '```foundry-proposal\n{"type":"task","title":"Add the export button","task":{"title":"add the export button","spec":"A Download CSV button."}}\n```';
const proposal: Proposal = { id: 'prop_1', type: 'task', title: 'Add the export button', summary: 'A button on the orders page, after the endpoint.', task: { title: 'add the export button', spec: 'A Download CSV button.', kind: 'feature', scenario: 'frontend', difficulty: 'standard', dependsOn: ['add the export endpoint'], relevantFiles: [], checks: [] }, applied: null };

describe('proposals under an answer (ADR-0075)', () => {
  test('the card shows the kind, title and summary with Apply, and the block itself is not shown as words', () => {
    const c = conversation([person('m1', 'add a download button'), answer('m2', 'm1', `Yes, a task of its own.\n\n${block}`, [proposal])]);
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ConversationThread conversation={c} live={undefined} items={[]} onAsk={noop} onStop={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain('Yes, a task of its own.');
    expect(html).not.toContain('foundry-proposal');
    expect(html).toContain('Add the export button');
    expect(html).toContain('new task');
    expect(html).toContain('after add the export endpoint');
    expect(html).toContain('Add the task');
    expect(html).toContain('Dismiss');
  });
  test('an applied card says what came of it instead of offering Apply', () => {
    const c = conversation([person('m1', 'add it'), answer('m2', 'm1', 'Done.', [{ ...proposal, applied: { at, by: 'ann', result: 'task t_7: add the export button' } }])]);
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ConversationThread conversation={c} live={undefined} items={[]} onAsk={noop} onStop={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain('applied');
    expect(html).toContain('task t_7: add the export button');
    expect(html).toContain('by ann');
    expect(html).not.toContain('Add the task');
  });
  test('a proposal block being written stays out of the live words', () => {
    const item = (event: unknown): StreamItem => ({ goalId: 'g1', taskId: null, attemptId: 'conversation-c1', ts: at, event });
    const items = [item({ kind: 'init', sessionId: 's1', model: 'fake', tools: [], raw: {} }), item({ kind: 'text_delta', text: 'Here is a task.\n\n```foundry-proposal\n{"type":"ta' })];
    expect(liveAnswer(items).text).toBe('Here is a task.');
  });
});
