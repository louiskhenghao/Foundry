import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { MemoryStatus } from '@foundry/engine/memory-types';
import { MemoryLine } from '../src/pages/LearningsPage.tsx';
import { HINDSIGHT_DOCKER, HindsightCard } from '../src/pages/skills/McpPanel.tsx';

const status = (over: Partial<MemoryStatus> = {}): MemoryStatus => ({ configured: true, url: 'http://127.0.0.1:8888', tokenSet: true, reachable: true, version: '1.1.0', error: null, retainTranscripts: true, seedCommits: 300, excludedFolders: [], mcp: { claude: { installed: false, allowed: false }, codex: null }, ...over });
const noop = async () => ({ ok: true, version: '1.1.0', error: null });
const render = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

test('the Hindsight card before a server is set: the address and token to fill in, no connection row', () => {
  const html = render(<HindsightCard provider="claude" status={status({ configured: false, url: null, tokenSet: false, reachable: null, version: null })} running={false} onTest={noop} onSave={async () => {}} onConnect={() => {}} />);
  expect(html).toContain('placeholder="http://127.0.0.1:8888"');
  expect(html).toContain('bearer token, if the server asks for one');
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
});
