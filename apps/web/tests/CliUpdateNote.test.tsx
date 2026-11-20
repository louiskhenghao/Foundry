import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentCliStatus } from '../src/api.ts';
import { CliUpdateNote } from '../src/pages/settings/PresetParts.tsx';

const status = (over: Partial<AgentCliStatus> = {}): AgentCliStatus => ({ provider: 'claude', id: 'claude-code', label: 'Claude Code', installed: true, version: '2.1.312', newest: '2.1.329', outdated: true, command: "'/Users/me/.local/bin/claude' install latest", ...over });
const note = (s: AgentCliStatus | null) => renderToStaticMarkup(<CliUpdateNote provider={s?.provider ?? 'claude'} onUpdated={() => {}} initial={s} />);

test('an older CLI under Sync models: both versions, why it matters, and its Update with the command it runs', () => {
  const html = note(status());
  expect(html).toContain('2.1.312');
  expect(html).toContain('2.1.329');
  expect(html).toContain('Sync models cannot find them until it is updated');
  expect(html).toContain('Update Claude Code');
  expect(html).toContain('title="&#x27;/Users/me/.local/bin/claude&#x27; install latest"');
  expect(note(status({ provider: 'codex', id: 'codex-cli', label: 'Codex CLI', version: '0.160.0', newest: '0.171.0' }))).toContain('Update Codex CLI');
});

test('up to date, the newest release unknown, or not installed: nothing shows', () => {
  expect(note(status({ outdated: false, newest: '2.1.312' }))).toBe('');
  expect(note(status({ outdated: false, newest: null }))).toBe('');
  expect(note(status({ installed: false, version: null, outdated: false }))).toBe('');
  expect(note(null)).toBe('');
});
