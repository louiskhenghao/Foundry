import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { EngineEvent } from '@foundry/core/browser';
import type { MemoryGoalView, MemoryStatus } from '@foundry/engine/memory-types';
import { describe } from '../src/pages/goal/describe.ts';
import { Remembered } from '../src/pages/goal/OverviewTab.tsx';
import { MemoryLine } from '../src/pages/LearningsPage.tsx';
import { HINDSIGHT_DOCKER, HindsightCard } from '../src/pages/skills/McpPanel.tsx';

const status = (over: Partial<MemoryStatus> = {}): MemoryStatus => ({ configured: true, url: 'http://127.0.0.1:8888', tokenSet: true, reachable: true, version: '1.1.0', error: null, retainTranscripts: true, reflectSec: 20, seedCommits: 300, excludedFolders: [], mcp: { claude: { installed: false, allowed: false }, codex: null }, ...over });
const noop = async () => ({ ok: true, version: '1.1.0', error: null });
const render = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

test('the Hindsight card before a server is set: the address and token to fill in, no connection row', () => {
  const html = render(<HindsightCard provider="claude" status={status({ configured: false, url: null, tokenSet: false, reachable: null, version: null })} running={false} onTest={noop} onSave={async () => {}} onConnect={() => {}} />);
  expect(html).toContain('placeholder="http://127.0.0.1:8888"');
  expect(html).toContain('bearer token, if the server asks for one');
  expect(html).toContain('Wait for an answer');
  expect(html).toContain('value="20"');
  expect(html).toContain('value="300"');
  expect(html).toContain('claude-code');
  expect(html).toContain('>off<');
  expect(html).not.toContain('Connect Claude Code');
  expect(html).not.toContain('Turn off');
  // the way to start one is at hand, with its command to copy
  expect(html).toContain('Start a server on this computer');
  expect(HINDSIGHT_DOCKER).toContain('ghcr.io/vectorize-io/hindsight:latest');
  expect(HINDSIGHT_DOCKER).toContain('/home/hindsight/.pg0');
});

test('a server that answers: its version, the kept token, and the coding agent to connect', () => {
  const html = render(<HindsightCard provider="claude" status={status()} running={false} onTest={noop} onSave={async () => {}} onConnect={() => {}} />);
  expect(html).toContain('connected · 1.1.0');
  expect(html).toContain('value="http://127.0.0.1:8888"');
  expect(html).toContain('token kept — leave empty to keep it');
  expect(html).toContain('not connected');
  expect(html).toContain('Connect Claude Code');
  expect(html).toContain('Turn off');
  expect(html).toContain('also works in your own Claude Code sessions');
});

test('for Codex, a connected server says how the token reaches it; one that does not answer says why', () => {
  const connected = render(<HindsightCard provider="codex" status={status({ mcp: { claude: null, codex: { installed: true, allowed: true } } })} running={false} onTest={noop} onSave={async () => {}} onConnect={() => {}} />);
  expect(connected).toContain('connected · allowed in goals');
  expect(connected).toContain('>Disconnect<');
  expect(connected).toContain('HINDSIGHT_API_TOKEN');
  const down = render(<HindsightCard provider="codex" status={status({ reachable: false, version: null, error: 'connection refused' })} running={false} onTest={noop} onSave={async () => {}} onConnect={() => {}} />);
  expect(down).toContain('not reachable');
  expect(down).toContain('connection refused');
});

test("the goal page's Remembered panel: how many asks were answered, what was written back, each stage's words when opened", () => {
  const view: MemoryGoalView = {
    enabled: true,
    bank: 'coding-agent::app',
    written: 3,
    failed: 1,
    recalls: [
      { at: '2026-10-23T10:00:00Z', stage: 'clarify', query: 'q1', text: 'Tests run with bun test.', kind: 'reflect', ms: 1200, error: null, taskId: null, attemptId: null },
      { at: '2026-10-23T10:05:00Z', stage: 'attempt', query: 'q2', text: null, kind: 'recall', ms: 20000, error: 'The operation timed out.', taskId: 't1', attemptId: 'a1' },
    ],
  };
  const html = render(<Remembered view={view} tasks={[{ id: 't1', title: 'Add the toggle' }]} />);
  expect(html).toContain('Remembered');
  expect(html).toContain('1 of 2 asks answered, 1 unanswered · wrote back 3 (1 failed)');
  expect(html).toContain('title="the bank coding-agent::app"');
  // folded: the words wait behind the button
  expect(html).not.toContain('Tests run with bun test.');
  expect(render(<Remembered view={{ ...view, recalls: [] }} tasks={[]} />)).toContain('nothing asked yet · wrote back 3');
});

test('the Activity rows for what Memory recalled and wrote', () => {
  const ev = (type: string, payload: unknown) => ({ id: 'e', ts: '2026-10-23T10:00:00Z', goalId: 'g1', type, payload }) as unknown as EngineEvent;
  expect(describe(ev('memory.recalled', { stage: 'review_task', text: 'Earlier reviews refused missing tests.', kind: 'reflect', ms: 900, error: null }))).toMatchObject({ text: 'Memory recalled for the task review (900 ms)', tone: 'muted', full: 'Earlier reviews refused missing tests.' });
  expect(describe(ev('memory.recalled', { stage: 'attempt', text: '- a fact', kind: 'recall', ms: 20100, error: 'no answer in time' }))).toMatchObject({ text: 'Memory recalled for the attempt (20100 ms; the memories themselves, the answer did not come in time)', tone: 'muted' });
  expect(describe(ev('memory.recalled', { stage: 'attempt', text: null, ms: 20000, error: 'timed out' }))).toMatchObject({ text: 'Memory did not answer the attempt: timed out', tone: 'warn' });
  expect(describe(ev('memory.recalled', { stage: 'clarify', text: null, ms: 300, error: null }))).toMatchObject({ text: 'Memory had nothing for the Clarifier', tone: 'muted' });
  expect(describe(ev('memory.retained', { source: 'record', count: 1, error: null }))).toMatchObject({ text: 'Memory: wrote the record', tone: 'muted' });
  expect(describe(ev('memory.retained', { source: 'transcript', count: 0, error: 'boom' }))).toMatchObject({ text: 'Memory could not write the transcript: boom', tone: 'warn' });
});

test("a folder's Memory line: its bank and the switch, or that it is no repository", () => {
  const on = render(<MemoryLine repoPath="/work/app" initial={{ repoPath: '/work/app', bank: 'coding-agent::app', enabled: true, excluded: false }} />);
  expect(on).toContain('coding-agent::app');
  expect(on).toMatch(/<input type="checkbox" checked=""/);
  expect(on).not.toContain('no server set');
  const out = render(<MemoryLine repoPath="/work/app" initial={{ repoPath: '/work/app', bank: 'coding-agent::app', enabled: false, excluded: true }} />);
  expect(out).toMatch(/<input type="checkbox"(?! checked)/);
  const unset = render(<MemoryLine repoPath="/work/app" initial={{ repoPath: '/work/app', bank: 'coding-agent::app', enabled: false, excluded: false }} />);
  expect(unset).toContain('no server set');
  const plain = render(<MemoryLine repoPath="/work/notes" initial={{ repoPath: '/work/notes', bank: null, enabled: false, excluded: false }} />);
  expect(plain).toContain('not a git repository');
  expect(plain).not.toContain('checkbox');
  // the everywhere notebook's card: the person's own bank, with no switch
  const yours = render(<MemoryLine repoPath="*" everywhere initial={{ repoPath: '*', bank: 'foundry::person', enabled: true, excluded: false }} />);
  expect(yours).toContain('foundry::person');
  expect(yours).toContain('your decisions and answers from every folder');
  expect(yours).not.toContain('checkbox');
  expect(render(<MemoryLine repoPath="*" everywhere initial={{ repoPath: '*', bank: 'foundry::person', enabled: false, excluded: false }} />)).toContain('(no server set)');
});
