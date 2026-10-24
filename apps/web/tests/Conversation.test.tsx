import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Attachment } from '@foundry/core/browser';
import type { Conversation, ConversationMessage } from '../src/api.ts';
import { ConversationThread, describeActivity, liveAnswer } from '../src/components/conversation/ConversationThread.tsx';
import type { StreamItem } from '../src/store.ts';

const at = '2026-10-23T10:00:00.000Z';
const person = (id: string, text: string, by: string | null = null, attachments: Attachment[] = []): ConversationMessage => ({ id, role: 'person', text, at, by, askedId: null, status: null, reason: null, costUsd: 0, costAvailable: true, model: null, durationMs: 0, attachments });
const file = (id: string, name: string, mime: string): Attachment => ({ id, kind: 'file', name, mime, size: 1234, path: `attachments/g1/${id}/${name}`, url: null, note: null, addedAt: at, markdown: null });
const answer = (id: string, askedId: string, text: string, extra: Partial<ConversationMessage> = {}): ConversationMessage => ({ id, role: 'explainer', text, at, by: null, askedId, status: 'done', reason: null, costUsd: 0.5, costAvailable: true, model: 'claude-sonnet-4-5', durationMs: 9_000, attachments: [], ...extra });
const conversation = (messages: ConversationMessage[]): Conversation => ({ id: 'c1', goalId: 'g1', title: 'Why does T2 depend on T1?', startedAt: at, updatedAt: at, by: 'ann', sessionId: 's1', costUsd: 0.5, messages });
const item = (event: unknown): StreamItem => ({ goalId: 'g1', taskId: null, attemptId: 'conversation-c1', ts: at, event });
const noop = () => {};

describe('ConversationThread (ADR-0073)', () => {
  test('questions and answers, with who asked, what the answer cost and how it ended', () => {
    const c = conversation([person('m1', 'Why does T2 depend on T1?', 'ann'), answer('m2', 'm1', 'Because **T1** makes the table.'), person('m3', 'And the files?'), answer('m4', 'm3', 'Half an', { status: 'cut', reason: 'the answer ran out of turns' })]);
    const html = renderToStaticMarkup(<ConversationThread conversation={c} live={{ answering: null, queued: [] }} items={[]} onAsk={noop} onStop={noop} />);
    expect(html).toContain('Why does T2 depend on T1?');
    expect(html).toContain('ann · ');
    expect(html).toContain('<strong>T1</strong>');
    expect(html).toContain('sonnet-4-5');
    expect(html).toContain('$0.500');
    expect(html).toContain('cut short: the answer ran out of turns');
    expect(html).toContain('aria-label="Ask"');
    expect(html).toContain('aria-label="Attach files"');
    expect(html).not.toContain(' Stop</button>');
  });

  test('an answer being written shows what the Explainer reads, then its words, with Stop; a question waiting its turn says so', () => {
    const c = conversation([person('m1', 'first?'), person('m2', 'second?')]);
    const reading = [item({ kind: 'init', sessionId: 's1', model: 'fake', tools: [], raw: {} }), item({ kind: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x/.foundry/goal/conversation/src/app.ts' } })];
    let html = renderToStaticMarkup(<ConversationThread conversation={c} live={{ answering: 'm1', queued: ['m2'] }} items={reading} onAsk={noop} onStop={noop} />);
    expect(html).toContain('reading src/app.ts');
    expect(html).toContain('waiting its turn');
    expect(html).toContain(' Stop</button>');
    const writing = [...reading, item({ kind: 'text_delta', text: 'It reads ' }), item({ kind: 'text_delta', text: 'the table.' })];
    html = renderToStaticMarkup(<ConversationThread conversation={c} live={{ answering: 'm1', queued: ['m2'] }} items={writing} onAsk={noop} onStop={noop} />);
    expect(html).toContain('It reads the table.');
    expect(html).toContain('writing…');
    expect(html).not.toContain('reading src/app.ts');
  });

  test('a question shows the pictures it carried, and the other files as chips, served from the goal', () => {
    const c = conversation([person('m1', 'What is wrong in this screen?', null, [file('att1', 'screen.png', 'image/png'), file('att2', 'notes.pdf', 'application/pdf')]), answer('m2', 'm1', 'The label.')]);
    const html = renderToStaticMarkup(<ConversationThread conversation={c} live={undefined} items={[]} onAsk={noop} onStop={noop} />);
    expect(html).toContain('<img src="/api/goals/g1/attachments/att1"');
    expect(html).toContain('notes.pdf');
    expect(html).toContain('href="/api/goals/g1/attachments/att2"');
  });

  test('an earlier Conversation is read, not continued; an empty one invites the first question', () => {
    const c = conversation([person('m1', 'one'), answer('m2', 'm1', 'A1')]);
    expect(renderToStaticMarkup(<ConversationThread conversation={c} live={undefined} items={[]} readOnly onAsk={noop} onStop={noop} />)).toContain('An earlier Conversation');
    const empty = renderToStaticMarkup(<ConversationThread conversation={null} live={undefined} items={[]} onAsk={noop} onStop={noop} />);
    expect(empty).toContain('Ask anything about this goal');
    // three questions to start from, sent as they stand
    expect(empty).toContain('Where in the code did the changes land?');
    expect(empty).toContain('Enter sends · Shift+Enter for a new line');
  });

  test('the live answer is read from the channel: paragraphs, the words since, the latest tool call; a new session starts it over', () => {
    const items = [item({ kind: 'init', sessionId: 's1', model: 'fake', tools: [], raw: {} }), item({ kind: 'text_delta', text: 'old' }), item({ kind: 'result', result: {} }), item({ kind: 'init', sessionId: 's1', model: 'fake', tools: [], raw: {} }), item({ kind: 'tool_use', id: 't', name: 'Grep', input: { pattern: 'TODO' } }), item({ kind: 'text', text: 'First.' }), item({ kind: 'text_delta', text: 'Then' })];
    expect(liveAnswer(items)).toEqual({ text: 'First.\n\nThen', activity: null, started: true });
    expect(liveAnswer(items.slice(0, 5))).toEqual({ text: '', activity: 'searching for TODO', started: true });
    expect(liveAnswer([])).toEqual({ text: '', activity: null, started: false });
    expect(describeActivity({ name: 'Bash', input: { command: 'git log --oneline -n 5' } })).toBe('running git log --oneline -n 5');
    expect(describeActivity({ name: 'mcp__hindsight__recall', input: {} })).toBe('asking hindsight');
    // Codex wraps commands in its login shell; Antigravity names its tools and inputs its own way
    expect(describeActivity({ name: 'Bash', input: { command: "/bin/zsh -lc 'cat README.md src/words.ts'" } })).toBe('running cat README.md src/words.ts');
    expect(describeActivity({ name: 'run_command', input: { CommandLine: 'git log --oneline -3', Cwd: '/x' } })).toBe('running git log --oneline -3');
    expect(describeActivity({ name: 'view_file', input: { AbsolutePath: '/x/repo/src/words.ts' } })).toBe('reading src/words.ts');
    expect(describeActivity({ name: 'grep_search', input: { Query: 'slugify', SearchPath: '/x/repo' } })).toBe('searching for slugify');
    expect(describeActivity({ name: 'list_dir', input: { DirectoryPath: '/x/repo/src' } })).toBe('listing repo/src');
  });
});
