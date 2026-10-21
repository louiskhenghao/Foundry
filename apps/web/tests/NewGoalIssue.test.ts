import { expect, test } from 'bun:test';
import type { Attachment } from '@foundry/core/browser';
import { applyIssueRead, clearIssue, keptOwnText, type IssueFormState, type IssueRead } from '../src/pages/new-goal-issue.ts';

const att = (id: string): Attachment => ({ id, kind: 'link', name: `acme/app#${id}`, mime: null, size: null, path: null, url: `https://github.com/acme/app/issues/${id}`, note: null, addedAt: '2026-10-20T00:00:00Z', markdown: null });
const read = (n: number, prompt = `Body of ${n}`): IssueRead => ({
  issue: { repo: 'acme/app', number: n, url: `https://github.com/acme/app/issues/${n}`, title: `Issue ${n}`, state: 'open', labels: [], readAt: '2026-10-20T00:00:00Z' },
  title: `Issue ${n}`,
  prompt,
  attachment: att(String(n)),
});
const empty: IssueFormState = { prompt: '', title: '', attachments: [], issue: null };

test('an empty form takes the issue title, body and thread', () => {
  const f = applyIssueRead(empty, read(7));
  expect(f.prompt).toBe('Body of 7');
  expect(f.title).toBe('Issue 7');
  expect(f.attachments.map((a) => a.id)).toEqual(['7']);
  expect(f.issue?.read.issue.number).toBe(7);
  expect(keptOwnText(f)).toBe(false);
});

test('text the person typed is kept; the thread is attached anyway', () => {
  const f = applyIssueRead({ ...empty, prompt: 'my own words', title: 'My title', attachments: [att('x')] }, read(7));
  expect(f.prompt).toBe('my own words');
  expect(f.title).toBe('My title');
  expect(f.attachments.map((a) => a.id)).toEqual(['x', '7']);
  expect(keptOwnText(f)).toBe(true);
});

test('reading another issue replaces what the first one filled in, and swaps the thread', () => {
  const first = applyIssueRead({ ...empty, attachments: [att('x')] }, read(7));
  const second = applyIssueRead(first, read(8));
  expect(second.prompt).toBe('Body of 8');
  expect(second.title).toBe('Issue 8');
  expect(second.attachments.map((a) => a.id)).toEqual(['x', '8']);
});

test('an edit after the fill survives the next read', () => {
  const first = applyIssueRead(empty, read(7));
  const edited = { ...first, prompt: 'Body of 7, plus my notes' };
  const second = applyIssueRead(edited, read(8));
  expect(second.prompt).toBe('Body of 7, plus my notes');
  expect(second.title).toBe('Issue 8');
});

test('unlinking drops the thread and keeps the words', () => {
  const f = clearIssue(applyIssueRead({ ...empty, attachments: [att('x')] }, read(7)));
  expect(f.issue).toBeNull();
  expect(f.prompt).toBe('Body of 7');
  expect(f.attachments.map((a) => a.id)).toEqual(['x']);
  expect(clearIssue(empty)).toBe(empty);
});
